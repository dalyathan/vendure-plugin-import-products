# Vendure Import Products Plugin

- This plugin imports the products from the specified url every specified day.

- The products are expected to be in the following format
```ts
  {
    "Items": [
        {
            "name": string,
            "id": string,
            "price": string,
            "unit": string,
            "group": string,
            "sku": string,
            "Collection": string,
            "parentfacet": string,
            "childfacet": string
        },
    ]
  }
```

## Getting Started
1. Run 
```bash
  npm i @nestjs/axios @nestjs/schedule axios ts-node
```

2. And then add this to your  `vendure-config.ts`.
```ts
import {ProductImportPlugin} from "vendure-plugin-import-products";

ProductImportPlugin.init({
    url: `https://tfcmayasoftdata.up.railway.app/allproducts`,
    everyThisDay: 3
})
```
This means the products will be imported from the specified url every third day. 

3. Make sure to run database migrations after updating your `vendure-config.ts`



