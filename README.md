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

```ts
import {ProductImportPlugin} from "vendure-plugin-import-products";

ProductImportPlugin.init({
    url: `https://tfcmayasoftdata.up.railway.app/allproducts`,
    everyThisDay: 3
})
```
This means the products will be imported from the specified url every third day. Make sure to run database migrations after including this in your `vendure-config.ts`



