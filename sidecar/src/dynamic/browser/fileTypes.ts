export const MAX_UPLOAD_BYTES=1_048_576;
export type UploadFixture={id:string;sha256:string;bytes:number;mimeType:string};
export type LocalUploadFixture=UploadFixture&{name:string;expiresAt:string;availability:'available'|'expired'};
export type UploadGrant=UploadFixture&{selector:string};
export type UploadPayload={name:string;mimeType:string;buffer:Buffer};
export const MAX_DOWNLOAD_BYTES=1_048_576;
export type DownloadGrant={selector:string;url:string;maxBytes:number;mimeType:string;publicTestData:true};
export type DownloadReceipt={kind:'download';id:string;permissionUrl:string;sha256:string;bytes:number;mimeType:string};
export function publicDownloadUrl(value:unknown):value is string{if(typeof value!=='string'||value.length>2000)return false;try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.href===value;}catch{return false;}}
