export const MAX_UPLOAD_BYTES=1_048_576;
export type UploadFixture={id:string;sha256:string;bytes:number;mimeType:string};
export type LocalUploadFixture=UploadFixture&{name:string;expiresAt:string;availability:'available'|'expired'};
export type UploadGrant=UploadFixture&{selector:string};
export type UploadPayload={name:string;mimeType:string;buffer:Buffer};
