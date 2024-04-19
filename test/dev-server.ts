import {
    createTestEnvironment,
    registerInitializer,
    SqljsInitializer,
    testConfig,
  } from '@vendure/testing';
  import {
    DefaultLogger,
    DefaultSearchPlugin,
    LogLevel,
    mergeConfig,
    JobQueueService,
    AutoIncrementIdStrategy,
    DefaultJobQueuePlugin,
    dummyPaymentHandler,
  } from '@vendure/core';
  import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
  import { AssetServerPlugin } from '@vendure/asset-server-plugin';
  import path from 'path';
  import { initialData } from '../test/initial-data';
import { compileUiExtensions } from '@vendure/ui-devkit/compiler';
import { defaultEmailHandlers, EmailPlugin } from '@vendure/email-plugin';
import { testPaymentMethodHandler } from './test-payment-method';
import { ProductImportPlugin } from '../dist/plugin';

  
  require('dotenv').config();
  
  (async () => {
    registerInitializer('sqljs', new SqljsInitializer('__data__'));
    const devConfig = mergeConfig(testConfig, {
      logger: new DefaultLogger({ level: LogLevel.Debug }),
      plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
        }),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        EmailPlugin.init({
            devMode: true,
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers: [...defaultEmailHandlers],
            templatePath: path.join(__dirname, 'static/email/templates'),
            globalTemplateVars: {
                // The following variables will change depending on your storefront implementation.
                // Here we are assuming a storefront running at http://localhost:8080.
                fromAddress: '"example" <noreply@example.com>',
                verifyEmailAddressUrl: 'http://localhost:8080/verify',
                passwordResetUrl: 'http://localhost:8080/password-reset',
                changeEmailAddressUrl: 'http://localhost:8080/verify-email-address-change'
            },
        }),
        AdminUiPlugin.init({
          port: 5001,
          route: 'admin',
          adminUiConfig: {
            hideVendureBranding: true,
            hideVersion: true,
          },
          
          app: compileUiExtensions({
            outputPath: path.join(__dirname, "__admin-ui"),
            extensions: [
                
            ],
            devMode: true
          })
        }),
        ProductImportPlugin.init({
          url: `https://tfcmayasoftdata.up.railway.app/allproducts`,
          everyThisDay: 3
        })
      ],
      apiOptions: {
        shopApiPlayground: true,
        adminApiPlayground: true,
      },
      entityOptions:{
        entityIdStrategy: new AutoIncrementIdStrategy(),
      },
      paymentOptions:{
        paymentMethodHandlers: [testPaymentMethodHandler, dummyPaymentHandler]
      }
    });
    const { server } = createTestEnvironment(devConfig);
    await server.init({
      initialData,
      productsCsvPath: './test/products-import.csv',
      customerCount: 5,
    });
    const jobQueueService= server.app.get(JobQueueService);
    await jobQueueService.start()

  })();