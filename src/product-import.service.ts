import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { Channel, ChannelService, Collection, CollectionService, ConfigArgService, ConfigService, EventBus, 
    FacetService, FacetValue, FacetValueService, 
    ID, JobQueue, JobQueueService, LanguageCode, Logger, Product, ProductService, ProductTranslation, ProductVariant, 
    ProductVariantEvent, ProductVariantPrice, ProductVariantService, ProductVariantTranslation, RequestContext, 
    SearchService, TaxCategoryService, TransactionalConnection, TranslatableSaver, UserInputError, variantIdCollectionFilter } from '@vendure/core';
import { getSuperadminContext } from './get-superadmin-context';
import { RemoteProduct } from './types';
import {In} from 'typeorm';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {CreateCollectionInput, ConfigurableOperationInput, CreateFacetInput, 
    CreateFacetValueInput, CreateProductInput, CreateProductVariantInput} from '@vendure/common/lib/generated-types'
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PLUGIN_INIT_OPTIONS } from './constants';
import { ProductImportPluginOptions } from './plugin';


export const NEW_VARIANT_STOCK_VALUE=9999;

@Injectable()
export class ProductImportService implements OnModuleInit{
    private jobQueue!: JobQueue;

    constructor(private httpService: HttpService, 
        private channelService: ChannelService,
        private productVariantService: ProductVariantService,
        private configArgService: ConfigArgService,
        private facetService: FacetService,
        private facetValueService: FacetValueService,
        private translatableSaver: TranslatableSaver,
        private searchService: SearchService,
        private productService: ProductService,
        private taxCategoryService: TaxCategoryService,
        private connection: TransactionalConnection, 
        private eventBus: EventBus,
        private collectionService: CollectionService, 
        private schedulerRegistry: SchedulerRegistry,
        private jobQueueService: JobQueueService,
        @Inject(PLUGIN_INIT_OPTIONS) private readonly options: ProductImportPluginOptions,
        private configService: ConfigService){

    }

    async onModuleInit() {
        this.jobQueue = await this.jobQueueService.createQueue({
            name: 'import-products',
            process: async job => {
               await this.importProducts()
            },
        });
        if(this.options?.everyThisDay === undefined){
            throw new UserInputError(`You need to configure ProductImportPluginOptions.everyThisOtherDay`)
        }
        CronExpression.EVERY_5_MINUTES
        const job = new CronJob("0 */2 * * * *", async () => {
            this.jobQueue.add({},{retries: 2})
        });
        // const job = new CronJob(`0 0 */${this.options.everyThisOtherDay} * *`, async () => {
        //     this.jobQueue.add({},{retries: 2})
        // });
        this.schedulerRegistry.addCronJob('name', job);
        job.start();
    }

    async importProducts(){
        if(this.options?.url === undefined){
            throw new UserInputError(`You need to configure "ProductImportPluginOptions.url"`)
        }
        const response = await this.httpService
            .get(this.options.url)
            .toPromise();
        const products = response?.data.Items as RemoteProduct[];
        Logger.info(`Started importing ${products.length} Products`)
        const webHookIds= products.map((p)=> p.id)
        const defaultChannel= await this.channelService.getDefaultChannel()
        const ctx= await getSuperadminContext(defaultChannel,this.connection,this.configService)        

        //we first get the products
        const vendureProducts= await this.getExistingRemoteProducts(ctx, webHookIds)

        //for those which exist we go thru each and update each 
        const productRepo= this.connection.getRepository(ctx, Product);

        const newRemoteProducts: RemoteProduct[]=[]
        for(let remoteProduct of products){
            const vendureProduct= vendureProducts.find((vP)=> vP.customFields.webhookId === remoteProduct.id);
            if(vendureProduct){
                //we first update the product name
                await this.updateProduct(ctx,vendureProduct,defaultChannel.defaultLanguageCode,remoteProduct)
                //then the default variant's name and price
                const defaultVariant= await this.updateDefaultVariant(ctx, vendureProduct, defaultChannel, remoteProduct);
                await this.updateProductCollection(ctx, defaultVariant, remoteProduct.Collection, defaultChannel.defaultLanguageCode);
                await this.updateProductFacet(ctx, vendureProduct, remoteProduct, defaultChannel.defaultLanguageCode)
            }else{
                newRemoteProducts.push(remoteProduct)
            }
        }

        await productRepo.save(vendureProducts);
         //for those which dont we create a new Product
        for(let newProduct of newRemoteProducts){
            const product= await this.createProduct(ctx, newProduct, defaultChannel.defaultLanguageCode)
            const defaultVariant= product?.variants[0];
            if(!product || !defaultVariant){
                throw new UserInputError("Couldn't create a Product")
            }
            await this.updateProductCollection(ctx, defaultVariant,newProduct.Collection,defaultChannel.defaultLanguageCode);
            await this.updateProductFacet(ctx, product, newProduct,defaultChannel.defaultLanguageCode)
        }
        await this.searchService.reindex(ctx)
        this.eventBus.publish(new ProductVariantEvent(ctx, [], 'created'));
        Logger.info(`Done importing ${products.length} Products`)
    }

    async getExistingRemoteProducts(ctx: RequestContext, webHookIds: string[]){
        const productsRepo= this.connection.getRepository(ctx, Product);
       return await productsRepo.createQueryBuilder('product')
                .select('productTranslations.id')
                .addSelect('productTranslations.name')
                .addSelect('productTranslations.languageCode')
            .addSelect('variantTranslations.id')
            .addSelect('variantTranslations.name')
            .addSelect('variantTranslations.languageCode')
                .addSelect('product.id')
                .addSelect('product.customFields.webhookId')
                .addSelect('product.customFields.unit')
            .addSelect('productVariantPrices.id')
            .addSelect('productVariantPrices.price')
            .addSelect('productVariantPrices.channelId')
                .addSelect('variant.id')
                .addSelect('variant.sku')
            .addSelect('collection.id')
            .addSelect('collection.filters')
                .addSelect('facetValueTranslations.id')
                .addSelect('facetValueTranslations.name')
                .addSelect('facetValueTranslations.languageCode')
            .addSelect('facetTranslations.id')
            .addSelect('facetTranslations.name')
            .addSelect('facetTranslations.languageCode')
                .addSelect('collectionTranslation.id')
                .addSelect('collectionTranslation.name')
                .addSelect('collectionTranslation.languageCode')
        .leftJoin('product.variants', 'variant') 
        .leftJoin('product.translations','productTranslations')
        .leftJoin('product.facetValues','facetValue')
        .leftJoin('facetValue.translations','facetValueTranslations')
        .leftJoin('facetValue.facet','facet')
        .leftJoin('facet.translations','facetTranslations')
        .leftJoin('variant.productVariantPrices','productVariantPrices')
        .leftJoin('variant.collections','collection')
        .leftJoin('variant.translations','variantTranslations')
        .leftJoin('collection.translations','collectionTranslation')
        .setFindOptions({where: {customFields: {webhookId: In(webHookIds)}}})
        .getMany()
    }

    async updateProduct(ctx: RequestContext, vendureProduct: Product, languageCode: LanguageCode, remoteProduct: RemoteProduct ){
        let translation= vendureProduct.translations.find((tr)=> languageCode === tr.languageCode)
        const productTranslationRepo= this.connection.getRepository(ctx, ProductTranslation);
        vendureProduct.customFields.unit= remoteProduct.unit
        if(translation){
            translation.name= remoteProduct.name
            translation.slug= normalizeString(`${remoteProduct.name}`, '-')
        }else{
            translation= new ProductTranslation()
            translation.languageCode= languageCode;
            translation.base= vendureProduct;
            translation.name= remoteProduct.name
            translation.slug= normalizeString(`${remoteProduct.name}`, '-')
            vendureProduct.translations.push(translation)
        }
        await productTranslationRepo.save(translation)
    }

    async updateProductVariantName(ctx: RequestContext, defaultVariant: ProductVariant, languageCode: LanguageCode, remoteProductName: string ){
        let translation= defaultVariant.translations.find((tr)=> languageCode === tr.languageCode)
        const productTranslationRepo= this.connection.getRepository(ctx, ProductVariantTranslation);
        if(translation){
            translation.name= remoteProductName
        }else{
            translation= new ProductVariantTranslation()
            translation.languageCode= languageCode;
            translation.base= defaultVariant;
            translation.name= remoteProductName
            defaultVariant.translations.push(translation)
        }
        await productTranslationRepo.save(translation)
    }

    async createProduct(ctx: RequestContext,newProduct: RemoteProduct, languageCode: LanguageCode){
        //if a product doesn't exist, so wont its variant
        const createProductInput: CreateProductInput={
            translations: [{
                languageCode,
                description: '',
                name: newProduct.name,
                slug: normalizeString(`${newProduct.name}`, '-')
            }],
            customFields:{
                webhookId: newProduct.id,
                unit: newProduct.unit
            }
        }
        const product = await this.translatableSaver.create({
            ctx,
            input: createProductInput,
            entityType: Product,
            translationType: ProductTranslation,
            beforeSave: async p => {
                await this.channelService.assignToCurrentChannel(p, ctx);
            },
        });
        await this.createProductVariant(ctx, product.id, newProduct,languageCode)
        return this.productService.findOne(ctx, product.id, ['featuredAsset', 'assets', 'channels', 'facetValues', 'facetValues.facet', 'variants'])
    }

    async updateDefaultVariant(ctx: RequestContext, vendureProduct: Product, defaultChannel: Channel, remoteProduct: RemoteProduct):Promise<ProductVariant>{
        let defautVariant= vendureProduct.variants.find((variant)=> variant.sku === remoteProduct.sku);
        let defautVariantPriceInDefaultChannel= defautVariant?.productVariantPrices.find((variantPrice)=> defaultChannel.id === variantPrice.channelId)
        const productVariantRepo= this.connection.getRepository(ctx, ProductVariant);
        const productVariantPriceRepo= this.connection.getRepository(ctx, ProductVariantPrice);
        if(defautVariant && defautVariantPriceInDefaultChannel){
          
            defautVariantPriceInDefaultChannel.price= parseFloat(remoteProduct.price)*100;
            await Promise.all([
                this.updateProductVariantName(ctx, defautVariant, defaultChannel.defaultLanguageCode,remoteProduct.name),
                productVariantPriceRepo.save(defautVariantPriceInDefaultChannel),
                productVariantRepo.save(defautVariant)
            ])
        }
        else if(defautVariant){
            defautVariantPriceInDefaultChannel= new ProductVariantPrice();
            defautVariantPriceInDefaultChannel.channelId= defaultChannel.id;
            defautVariantPriceInDefaultChannel.currencyCode= defaultChannel.defaultCurrencyCode;
            defautVariantPriceInDefaultChannel.price= parseFloat(remoteProduct.price)*100;;
            defautVariantPriceInDefaultChannel.variant= defautVariant;
            if(defautVariant?.productVariantPrices?.length){
                defautVariant.productVariantPrices.push(defautVariantPriceInDefaultChannel)
            }else{
                defautVariant.productVariantPrices=[defautVariantPriceInDefaultChannel]
            }
            await Promise.all([
                productVariantPriceRepo.save(defautVariantPriceInDefaultChannel),
                productVariantRepo.save(defautVariant),
                this.updateProductVariantName(ctx, defautVariant, defaultChannel.defaultLanguageCode,remoteProduct.name)
            ])
        }
        else{
            // we need to create a default variant
            defautVariant= await this.createProductVariant(ctx, vendureProduct.id,remoteProduct,defaultChannel.defaultLanguageCode)
            vendureProduct.variants.push(defautVariant)
        }
        return defautVariant;
    }

    async createProductVariant(ctx: RequestContext, productId: ID,remoteProduct: RemoteProduct, languageCode: LanguageCode){
        const taxCategories = await this.taxCategoryService.findAll(ctx);
        const  taxCategory = taxCategories.items.find(t => t.isDefault === true) ?? taxCategories.items[0];
        const createProductVariantInput: CreateProductVariantInput={
            productId: productId,
            sku: remoteProduct.sku,
            taxCategoryId: taxCategory.id,
            translations: [{
                languageCode,
                name: remoteProduct.name,
            }],
            price: parseFloat(remoteProduct.price)*100,
            stockOnHand: NEW_VARIANT_STOCK_VALUE
        }
        const inputWithoutPrice = {
            ...createProductVariantInput,
        };
        delete inputWithoutPrice.price;
        const createdVariant = await this.translatableSaver.create({
            ctx,
            input: inputWithoutPrice,
            entityType: ProductVariant,
            translationType: ProductVariantTranslation,
            beforeSave: async variant => {
                variant.product = { id: createProductVariantInput.productId } as any;
                variant.taxCategory = { id: createProductVariantInput.taxCategoryId } as any;
                await this.channelService.assignToCurrentChannel(variant, ctx);
            },
            typeOrmSubscriberData: {
                channelId: ctx.channelId,
                taxCategoryId: createProductVariantInput.taxCategoryId,
            },
        });
        await this.productVariantService.createOrUpdateProductVariantPrice(ctx, createdVariant.id, createProductVariantInput.price!, ctx.channelId);
        return createdVariant
    }

    async updateProductCollection(ctx: RequestContext, defautVariant: ProductVariant, remoteProductCollection: string, languageCode: LanguageCode){
        let collection: Collection|null|undefined = defautVariant.collections?.find((c)=> !!c.translations.find((collectionTranslation)=> collectionTranslation.name === remoteProductCollection && collectionTranslation.languageCode === languageCode));
        const collectionFilterInput: ConfigurableOperationInput= {code: "variant-id-filter", arguments: [{name: "variantIds", value: `[\"${defautVariant.id}\"]`}, {name: "combineWithAnd", value: "false"}]}
        const newCollectionFilter= this.configArgService.parseInput('CollectionFilter',collectionFilterInput)
        const productVariantRepo=  this.connection.getRepository(ctx, ProductVariant);
        if(!collection){
            // in this case the collection exists but the variant is not assigned to it
            const colllectionRepo= this.connection.getRepository(ctx, Collection);
            collection= await colllectionRepo.createQueryBuilder('collection')
            .leftJoin('collection.translations', 'collectionTranslatons')
            .setFindOptions({where:{translations:{name: remoteProductCollection, languageCode}}})
            .getOne()
            let savedCollection;
            if(collection?.filters?.length){
                const variantIdFilter= collection.filters.find((filterDef)=> filterDef.code === variantIdCollectionFilter.code);
                if(variantIdFilter){
                    const variantIdsList:ID[]= JSON.parse(variantIdFilter.args[0].value);
                    variantIdsList.push(defautVariant.id.toString())
                    variantIdFilter.args[0].value= JSON.stringify(variantIdsList)
                }else{
                    collection.filters.push(newCollectionFilter)
                }
                savedCollection= await colllectionRepo.save(collection);
            }
            if(collection && !collection.filters?.length){
                collection.filters=[newCollectionFilter]
                savedCollection= await colllectionRepo.save(collection);
            }
            if(savedCollection && defautVariant.collections?.length){
                defautVariant.collections.push(savedCollection)
            }
            if(savedCollection && !defautVariant.collections?.length){
                defautVariant.collections=[savedCollection]
            }
        }
        if(!collection){
            //in this case the collection doesn't exist
            const input: CreateCollectionInput= {
                filters: [collectionFilterInput],
                translations: [{
                    description: '',
                    languageCode: languageCode,
                    name: remoteProductCollection,
                    slug:  normalizeString(`${remoteProductCollection}`, '-')
                }]
            }
            collection = await this.collectionService.create(ctx, input);
            if(defautVariant.collections?.length){
                defautVariant.collections.push(collection)
            }
            else{
                defautVariant.collections=[collection]
            }
        }
        defautVariant= await productVariantRepo.save(defautVariant)
    }

    async updateProductFacet(ctx: RequestContext, vendureProduct: Product, remoteProduct: RemoteProduct, languageCode: LanguageCode){
        let facetValue: FacetValue|null|undefined = vendureProduct.facetValues?.find((facetValue)=> !!facetValue.translations.find((facetValueTranslation)=> facetValueTranslation.name === remoteProduct.childfacet && facetValueTranslation.languageCode === languageCode));
        let facetExists= facetValue?.facet.translations.some((facetTranslation)=> facetTranslation.name === remoteProduct.parentfacet && facetTranslation.languageCode === languageCode)
        const productRepo= this.connection.getRepository(ctx, Product);
        if(facetValue && !facetExists){
            const input: CreateFacetInput= {
                code: normalizeString(`${remoteProduct.parentfacet}`, '-'),
                isPrivate: false,
                translations: [{
                    languageCode: languageCode,
                    name: remoteProduct.parentfacet
                }]
            }
            const facet= await this.facetService.create(ctx, input)
            facetValue.facet= facet;
        }else{
            //neither the facet value nor the facet exist
            const input: CreateFacetInput= {
                code: normalizeString(`${remoteProduct.parentfacet}`, '-'),
                isPrivate: false,
                translations: [{
                    languageCode: languageCode,
                    name: remoteProduct.parentfacet
                }]
            }
            const facet= await this.facetService.create(ctx, input)
            const createFacetValueInput: CreateFacetValueInput={
                code: normalizeString(`${remoteProduct.childfacet}`, '-'),
                facetId: facet.id,
                translations: [{
                    languageCode: languageCode,
                    name: remoteProduct.childfacet
                }]
            }
            facetValue= await this.facetValueService.create(ctx, facet, createFacetValueInput)
            if(vendureProduct.facetValues?.length){
                vendureProduct.facetValues.push(facetValue);
            }else{
                vendureProduct.facetValues=[facetValue];
            }
        }

        await productRepo.save(vendureProduct);
    }
   
}