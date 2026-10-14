import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {workspaceAuthorizationId} from './registry.js';
import {installedPackageManager} from './packageManager.js';
import type {WorkspaceRegistry} from './registry.js';import type {EnvironmentVault} from '../environment/vault.js';import {HookRepository} from './hookRepository.js';
import type {HookOperation} from './operations.js';import {runBoundedProcess,type ProcessResult} from './process.js';import {dynamicWorkerId,DYNAMIC_HEARTBEAT_MS} from '../recovery.js';
const controllers=new Map<string,AbortController>();export const cancelHook=(id:string)=>controllers.get(id)?.abort();
export function hookReceiptPath(root:string,projectId:string,id:string){return path.join(root,crypto.createHash('sha256').update(JSON.stringify([projectId,id])).digest('hex')+'.json');}
export async function executeHook(input:{ownerId:string;operation:HookOperation;repository:HookRepository;registry:WorkspaceRegistry;vault:EnvironmentVault;receiptRoot:string;timeoutMs?:number}){
 const {operation:op,repository}=input;const token=crypto.randomUUID();let timer:ReturnType<typeof setInterval>|undefined;let heartbeatPending=false;const controller=new AbortController();controllers.set(op.id,controller);
 try{
  if(!await repository.claim(op.projectId,op.id,dynamicWorkerId,token))return;
  timer=setInterval(()=>{if(heartbeatPending)return;heartbeatPending=true;void repository.heartbeat(op.projectId,op.id,dynamicWorkerId,token).then(alive=>{if(!alive)controller.abort();}).catch(()=>controller.abort()).finally(()=>{heartbeatPending=false;});},DYNAMIC_HEARTBEAT_MS);timer.unref();
  let result:ProcessResult;
  try{
   const {authorization,script}=input.registry.verify(input.ownerId,op.projectId,op.environmentId,op.kind);
   if(workspaceAuthorizationId(authorization)!==op.command.authorizationId||authorization.packageManager!==op.command.program||authorization.fingerprint!==op.command.fingerprint||script!==op.command.script)throw new Error('Authorization changed before worker claim.');
   const executable=installedPackageManager(authorization.packageManager);
   fs.mkdirSync(input.receiptRoot,{recursive:true,mode:0o700});
   const outputFile=hookReceiptPath(input.receiptRoot,op.projectId,op.id);
   result=await runBoundedProcess({executable,args:['run',script],cwd:authorization.directory,home:path.join(input.receiptRoot,'homes',op.id),runtimeBinDirectory:authorization.runtimeBinDirectory,variables:input.vault.read(input.ownerId,op.projectId,op.environmentId),timeoutMs:input.timeoutMs??60_000,signal:controller.signal,onOutput:output=>{const temporary=outputFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify({operationId:op.id,projectId:op.projectId,partial:true,output,sha256:crypto.createHash('sha256').update(output).digest('hex')}),{mode:0o600});fs.renameSync(temporary,outputFile);}});
  }catch{result={outcome:'runner_error',exitCode:null,signal:null,output:'Repository authorization/runtime unavailable. Inspect the workspace and authorize its current scripts.',truncated:false,durationMs:0};}
  fs.mkdirSync(input.receiptRoot,{recursive:true,mode:0o700});const file=hookReceiptPath(input.receiptRoot,op.projectId,op.id);const receipt={operationId:op.id,projectId:op.projectId,result,sha256:crypto.createHash('sha256').update(result.output).digest('hex')};const temporary=file+'.final-'+crypto.randomUUID();fs.writeFileSync(temporary,JSON.stringify(receipt),{mode:0o600});fs.renameSync(temporary,file);
  await repository.finish(op.projectId,op.id,token,result);
 }finally{if(timer)clearInterval(timer);controllers.delete(op.id);}
}

/** Only a matching stopped source may trigger an explicitly configured cleanup. */
export async function attemptAutomaticCleanup(input:{ownerId:string;projectId:string;profileId:string;sourceId:string;sourceKind:'browser'|'setup';repository:HookRepository;registry:WorkspaceRegistry;vault:EnvironmentVault;receiptRoot:string;environmentRepository:import('../environment/repository.js').EnvironmentRepository}){
 try{
  const config=input.registry.read(input.ownerId,input.projectId,input.profileId);if(!config?.automaticCleanup||!config.scripts.cleanup)return;
  const data=await input.environmentRepository.data(input.projectId,input.profileId);
  if(data.state!=='cleanup_required'||(input.sourceKind==='browser'?data.runId!==input.sourceId:data.operationId!==input.sourceId))return;
  const {authorization,inspection,script}=input.registry.verify(input.ownerId,input.projectId,input.profileId,'cleanup');
  const started=await input.repository.start(input.projectId,input.profileId,'cleanup','automatic-'+input.sourceKind+'-'+input.sourceId,{program:authorization.packageManager,script,fingerprint:authorization.fingerprint,authorizationId:workspaceAuthorizationId(authorization),gitCommit:inspection.gitCommit});
  if(!started.reused)await executeHook({ownerId:input.ownerId,operation:started.operation,repository:input.repository,registry:input.registry,vault:input.vault,receiptRoot:input.receiptRoot});
 }catch{await input.environmentRepository.recordData(input.projectId,input.profileId,'cleanup','failed','Configured cleanup could not complete. Inspect local authorization/runtime and recover the data baseline.').catch(()=>{});}
}
