import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {encryptSecret,decryptSecret} from '../../tokenVault.js';
import {DynamicContractError} from '../types.js';
import {MAX_UPLOAD_BYTES,type LocalUploadFixture,type UploadGrant,type UploadPayload} from '../browser/fileTypes.js';
type RecordFile=LocalUploadFixture&{scope:string[];base64:string};
const idValid=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
/** Immutable bytes, encrypted and scoped to the executing account/device. */
export class UploadVault {
 constructor(private root:string,private now=()=>Date.now()){}
 private directory(owner:string,project:string,profile:string){return path.join(this.root,crypto.createHash('sha256').update(JSON.stringify([owner,project,profile])).digest('hex'));}
 private file(owner:string,project:string,profile:string,id:string){if(!idValid(id))throw new DynamicContractError(400,'Invalid local upload reference.');return path.join(this.directory(owner,project,profile),id+'.json');}
 private read(owner:string,project:string,profile:string,id:string):RecordFile{
  const file=this.file(owner,project,profile,id);if(!fs.existsSync(file))throw new DynamicContractError(409,'Approved upload is missing on this device. Select the file and update its permission.');
  try{const record=JSON.parse(decryptSecret(fs.readFileSync(file,'utf8'))) as RecordFile;if(JSON.stringify(record.scope)!==JSON.stringify([owner,project,profile])||record.id!==id)throw Error();return record;}catch{throw new DynamicContractError(503,'Local upload cannot be unlocked. Select it again.');}
 }
 list(owner:string,project:string,profile:string):LocalUploadFixture[]{const dir=this.directory(owner,project,profile);if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(name=>idValid(name.slice(0,-5))&&name.endsWith('.json')).map(name=>{const record=this.read(owner,project,profile,name.slice(0,-5));return {id:record.id,sha256:record.sha256,bytes:record.bytes,mimeType:record.mimeType,name:record.name,expiresAt:record.expiresAt,availability:Date.parse(record.expiresAt)>this.now()?'available':'expired'};});}
 save(owner:string,project:string,profile:string,input:unknown):LocalUploadFixture{
  const fail=():never=>{throw new DynamicContractError(400,'Select a public test-data file up to 1 MiB with a simple filename and MIME type.');};
  if(!input||typeof input!=='object'||Array.isArray(input))fail();const body=input as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['name','mimeType','base64','publicTestData'].includes(key))||body.publicTestData!==true||typeof body.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_. -]{0,100}$/.test(body.name)||typeof body.mimeType!=='string'||!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(body.mimeType)||body.mimeType.length>100||typeof body.base64!=='string'||body.base64.length>Math.ceil(MAX_UPLOAD_BYTES/3)*4)fail();
  const bytes=Buffer.from(body.base64 as string,'base64');if(!bytes.length||bytes.length>MAX_UPLOAD_BYTES||bytes.toString('base64')!==body.base64)fail();
  if(this.list(owner,project,profile).length>=10)throw new DynamicContractError(409,'Remove an unused local upload before adding another (maximum 10).');
  const descriptor:LocalUploadFixture={id:crypto.randomUUID(),name:body.name as string,mimeType:body.mimeType as string,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),expiresAt:new Date(this.now()+7*86400000).toISOString(),availability:'available'};
  const record:RecordFile={...descriptor,scope:[owner,project,profile],base64:body.base64 as string};const dir=this.directory(owner,project,profile);fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=this.file(owner,project,profile,record.id);fs.writeFileSync(file,encryptSecret(JSON.stringify(record)),{mode:0o600,flag:'wx'});return descriptor;
 }
 resolve(owner:string,project:string,profile:string,grant:UploadGrant):UploadPayload{
  const record=this.read(owner,project,profile,grant.id);const buffer=Buffer.from(record.base64,'base64');
  if(!Number.isFinite(Date.parse(record.expiresAt))||Date.parse(record.expiresAt)<=this.now()||record.bytes!==grant.bytes||buffer.length!==grant.bytes||buffer.length>MAX_UPLOAD_BYTES||record.mimeType!==grant.mimeType||record.sha256!==grant.sha256||crypto.createHash('sha256').update(buffer).digest('hex')!==grant.sha256)throw new DynamicContractError(409,'Approved upload expired or does not match its frozen fingerprint. Select it and update the permission.');
  return {name:record.name,mimeType:record.mimeType,buffer};
 }
 forget(owner:string,project:string,profile:string,id:string){const file=this.file(owner,project,profile,id);if(fs.existsSync(file))fs.unlinkSync(file);return {id,availability:'missing'};}
}
