import fs from 'node:fs';import type {HookRepository} from './hookRepository.js';import type {WorkspaceRegistry} from './registry.js';import type {HookKind,HookOperation} from './operations.js';
import {workspaceAuthorizationId} from './registry.js';
import {DynamicContractError} from '../types.js';import {cancelHook,hookReceiptPath} from './hookExecutor.js';
export async function handleHookRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;repository:HookRepository;registry:WorkspaceRegistry;receiptRoot:string;requireMember(projectId:string):Promise<void>;requireEnvironment(projectId:string,id:string):Promise<unknown>;execute(operation:HookOperation):Promise<void>}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments\/([^/]+)\/hooks(?:\/([^/]+))?(?:\/(cancel|output))?$/);if(!match)return null;const [,projectId,profileId,id,action]=match;
 await deps.requireMember(projectId);await deps.requireEnvironment(projectId,profileId);
 try{
  if(!id&&request.method==='GET')return {status:200,body:await deps.repository.list(projectId,profileId)};
  if(!id&&request.method==='POST'){
   const body=await request.readBody();if(!['setup','cleanup'].includes(body.kind as string)||typeof body.idempotencyKey!=='string'||!body.idempotencyKey.trim()||body.idempotencyKey.length>128)throw new DynamicContractError(400,'Select a setup/cleanup hook and bounded request key.');
   const key=body.idempotencyKey.trim();const old=await deps.repository.byKey(projectId,key);
   if(old){if(old.createdBy!==deps.ownerId||old.environmentId!==profileId||old.kind!==body.kind)throw new DynamicContractError(409,'Hook idempotency conflict.');return {status:200,body:old};}
   const {authorization,inspection,script}=deps.registry.verify(deps.ownerId,projectId,profileId,body.kind as HookKind);
   const result=await deps.repository.start(projectId,profileId,body.kind as HookKind,key,{program:authorization.packageManager,script,fingerprint:authorization.fingerprint,authorizationId:workspaceAuthorizationId(authorization),gitCommit:inspection.gitCommit});
   if(!result.reused)void deps.execute(result.operation).catch(()=>{});
   return {status:result.reused?200:201,body:result.operation};
  }
  if(id){
   const operation=await deps.repository.get(projectId,id);if(operation.environmentId!==profileId)throw new DynamicContractError(404,'Data operation not found in this environment.');
   if(action==='cancel'&&request.method==='POST'){const cancelled=await deps.repository.cancel(projectId,id);cancelHook(id);return {status:200,body:cancelled};}
   if(action==='output'&&request.method==='GET'){const file=hookReceiptPath(deps.receiptRoot,projectId,id);return {status:200,body:fs.existsSync(file)?{availability:'local',...JSON.parse(fs.readFileSync(file,'utf8'))}:{availability:'unavailable',reason:'Complete output is local to the executing device.'}};}
   if(!action&&request.method==='GET'){await deps.repository.recover(projectId);return {status:200,body:await deps.repository.get(projectId,id)};}
  }
  return {status:405,body:{error:'Unsupported hook operation.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};throw error;}
}
