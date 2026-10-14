import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import type {BrowserContext} from 'playwright';
import {encryptSecret,decryptSecret} from '../../tokenVault.js';import {DynamicContractError} from '../types.js';
export type BrowserSessionState=Awaited<ReturnType<BrowserContext['storageState']>>;
export type LocalSessionRecord={version:string;scope:{owner:string;project:string;profile:string};reference:string;expiresAt:string;origins:string[];state:BrowserSessionState};
const referenceName=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
export function validateSessionState(value:unknown,allowed:readonly string[]):BrowserSessionState{
 const fail=():never=>{throw new DynamicContractError(400,'Provide bounded browser cookies/localStorage for the approved environment origins.');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const input=value as BrowserSessionState;
 if(Object.keys(input).some(key=>!['cookies','origins'].includes(key))||!Array.isArray(input.cookies)||input.cookies.length>100||!Array.isArray(input.origins)||input.origins.length>10||JSON.stringify(value).length>1_000_000)fail();
 for(const cookie of input.cookies){
  if(!cookie||Object.keys(cookie).some(key=>!['name','value','domain','path','expires','httpOnly','secure','sameSite'].includes(key))||typeof cookie.name!=='string'||!cookie.name||cookie.name.length>200||typeof cookie.value!=='string'||cookie.value.length>8000||typeof cookie.domain!=='string'||!cookie.domain||typeof cookie.path!=='string'||!cookie.path.startsWith('/')||cookie.path.length>2000||!Number.isFinite(cookie.expires)||cookie.expires< -1||typeof cookie.httpOnly!=='boolean'||typeof cookie.secure!=='boolean'||!['Strict','Lax','None'].includes(cookie.sameSite))fail();
  const domain=cookie.domain.replace(/^\./,'').toLowerCase();
  if(!allowed.some(origin=>{const host=new URL(origin).hostname.toLowerCase();return host===domain||(cookie.domain.startsWith('.')&&domain.includes('.')&&host.endsWith('.'+domain));}))fail();
 }
 for(const origin of input.origins){if(!origin||typeof origin.origin!=='string'||!allowed.includes(origin.origin)||!Array.isArray(origin.localStorage)||origin.localStorage.length>100||Object.keys(origin).some(key=>!['origin','localStorage'].includes(key)))fail();for(const item of origin.localStorage)if(!item||typeof item.name!=='string'||!item.name||item.name.length>200||typeof item.value!=='string'||item.value.length>8000)fail();}
 return structuredClone({cookies:input.cookies.map(cookie=>({name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,expires:cookie.expires,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite})),origins:input.origins.map(origin=>({origin:origin.origin,localStorage:origin.localStorage.map(item=>({name:item.name,value:item.value}))}))});
}
/** Encrypted device-local session references; no raw browser values in shared DTOs. */
export class EnvironmentSessionVault{
 constructor(private readonly root:string,private readonly now:()=>number=Date.now){}
 private file(owner:string,project:string,profile:string,reference:string){if(!referenceName(reference))throw new DynamicContractError(400,'Use a bounded session reference name.');return path.join(this.root,crypto.createHash('sha256').update(JSON.stringify([owner,project,profile,reference])).digest('hex')+'.json');}
 write(owner:string,project:string,profile:string,reference:string,value:unknown,expiresAt:unknown,allowed:readonly string[]){
  const file=this.file(owner,project,profile,reference);const expiry=typeof expiresAt==='string'?Date.parse(expiresAt):NaN;
  if(!Number.isFinite(expiry)||expiry<=this.now()||expiry>this.now()+7*24*60*60*1000)throw new DynamicContractError(400,'Choose a session expiry within the next seven days.');
  if(!allowed.length||allowed.some(origin=>{try{return !['http:','https:'].includes(new URL(origin).protocol)||new URL(origin).origin!==origin;}catch{return true;}}))throw new DynamicContractError(400,'Approved environment origins required.');
  const state=validateSessionState(value,allowed);const record:LocalSessionRecord={version:crypto.randomUUID(),scope:{owner,project,profile},reference,expiresAt:new Date(expiry).toISOString(),origins:[...allowed],state};
  fs.mkdirSync(this.root,{recursive:true,mode:0o700});const temporary=file+'.'+crypto.randomUUID();fs.writeFileSync(temporary,encryptSecret(JSON.stringify(record)),{mode:0o600});fs.renameSync(temporary,file);
  return {reference,availability:'available' as const,expiresAt:record.expiresAt,version:record.version};
 }
 read(owner:string,project:string,profile:string,reference:string,allowed:readonly string[]):LocalSessionRecord|null{
  const file=this.file(owner,project,profile,reference);if(!fs.existsSync(file))return null;let record:LocalSessionRecord;
  try{record=JSON.parse(decryptSecret(fs.readFileSync(file,'utf8')));}catch{throw new DynamicContractError(503,'Local session cannot be unlocked. Sign in and capture it again on this device.');}
  if(record.scope?.owner!==owner||record.scope.project!==project||record.scope.profile!==profile)throw new DynamicContractError(409,'Local session belongs to another account or environment scope. Capture it again.');
  if(record.reference!==reference||!Number.isFinite(Date.parse(record.expiresAt))||Date.parse(record.expiresAt)<=this.now())throw new DynamicContractError(409,'Local session expired. Sign in and capture it again.');
  if(!Array.isArray(record.origins)||record.origins.some(origin=>!allowed.includes(origin)))throw new DynamicContractError(409,'Session origins changed. Capture a session for the current environment.');
  try{record.state=validateSessionState(record.state,allowed);}catch{throw new DynamicContractError(409,'Local session no longer matches this environment. Capture it again.');}
  return record;
 }
 forget(owner:string,project:string,profile:string,reference:string){const file=this.file(owner,project,profile,reference);if(fs.existsSync(file))fs.unlinkSync(file);return {reference,availability:'missing' as const};}
 knownValues(owner:string,project:string,profile:string,reference:string){const file=this.file(owner,project,profile,reference);if(!fs.existsSync(file))return [];try{const record=JSON.parse(decryptSecret(fs.readFileSync(file,'utf8'))) as LocalSessionRecord;if(record.scope?.owner!==owner||record.scope.project!==project||record.scope.profile!==profile)throw Error();validateSessionState(record.state,record.origins);return sessionSensitiveValues(record);}catch{throw new DynamicContractError(503,'Local session values cannot be unlocked. Capture the session again.');}}
 status(owner:string,project:string,profile:string,reference:string,allowed:readonly string[]){try{const record=this.read(owner,project,profile,reference,allowed);return record?{reference,availability:'available' as const,expiresAt:record.expiresAt,version:record.version}:{reference,availability:'missing' as const};}catch(error){return {reference,availability:'unavailable' as const,reason:error instanceof DynamicContractError?error.message:'Session unavailable.'};}}
}
export const sessionStateSensitiveValues=(state:BrowserSessionState)=>[...state.cookies.map(cookie=>cookie.value),...state.origins.flatMap(origin=>origin.localStorage.map(item=>item.value))].filter(Boolean);
export const sessionSensitiveValues=(record:LocalSessionRecord)=>sessionStateSensitiveValues(record.state);
