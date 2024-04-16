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
ProductImportPlugin.init({
    url: `https://tfcmayasoftdata.up.railway.app/allproducts`,
    everyThisDay: 3
})
```
This mean the products will be imported from the specied urlevery third day



