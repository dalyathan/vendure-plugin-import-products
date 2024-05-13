// types.ts

// Note: we are using deep a import here, rather than importing from `@vendure/core` due to
// a possible bug in TypeScript (https://github.com/microsoft/TypeScript/issues/46617) which
// causes issues when multiple plugins extend the same custom fields interface.
import { CustomProductFields } from '@vendure/core/dist/entity/custom-entity-fields';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        webhookId: string;
        unit: string
        Measurement: string
    }
}

export type RemoteProduct={
    name: string
    id: string
    price: string
    group: string
    sku: string
    Collection: string
    parentfacet: string
    childfacet: string
    unit: string
    measurement: string
}