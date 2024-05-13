import { LanguageCode, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ProductImportService } from './product-import.service';
import { PLUGIN_INIT_OPTIONS } from './constants';

export interface ProductImportPluginOptions {
    url: string;
    everyThisDay:number
  }
  

@VendurePlugin({
    imports: [PluginCommonModule, ScheduleModule.forRoot(), HttpModule],
    providers: [
        ProductImportService, {
        provide: PLUGIN_INIT_OPTIONS,
        useFactory: () => ProductImportPlugin.options,
      },],
    configuration:(config)=>{
        config.customFields.Product.push({
            name: 'webhookId',
            type: 'string',
            public: false,
            readonly: true,
            label: [{
                languageCode: LanguageCode.en,
                value: 'Webhook Product ID'
            }]
        })
        config.customFields.Product.push({
            name: 'unit',
            type: 'string',
            defaultValue: '',
            readonly: true,
            label: [{
                languageCode: LanguageCode.en,
                value: 'Unit'
            }]
        })
        config.customFields.Product.push({
          name: 'Measurement',
          type: 'string',
          defaultValue: '',
          readonly: true,
          label: [{
              languageCode: LanguageCode.en,
              value: 'Measurement'
          }]
      })
        return config
    }
})
export class ProductImportPlugin{
    static options: ProductImportPluginOptions;

    static init(
        options: ProductImportPluginOptions
      ): Type<ProductImportPlugin> {
        this.options = options;
        return ProductImportPlugin;
      }
}