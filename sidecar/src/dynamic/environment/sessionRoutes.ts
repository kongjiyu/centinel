import type {SessionCaptureRepository} from './captureRepository.js';
import {DynamicContractError} from '../types.js';import type {EnvironmentRepository} from './repository.js';import type {EnvironmentSessionBroker} from './sessionBroker.js';import {EnvironmentSessionVault,validateSessionState,sessionStateSensitiveValues} from './sessionVault.js';import {containsLocalValue} from './secrets.js';
export async function handleSessionRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;repository:EnvironmentRepository;vault:EnvironmentSessionVault;broker:EnvironmentSessionBroker;requireMember(projectId:string):Promise<void>;captures:SessionCaptureRepository}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments\/([^/]+)\/session$/);if(!match)return null;const [,projectId,id]=match;await deps.requireMember(projectId);
 try{const profile=await deps.repository.get(projectId,id);const reference=profile.sessionReference;
  if(request.method==='GET')return {status:200,body:{session:reference?deps.vault.status(deps.ownerId,projectId,id,reference,profile.allowedOrigins):{availability:'not_configured'},capture:deps.broker.status(deps.ownerId,projectId,id)}};
  if(request.method==='POST'){
   const body=await request.readBody();if(!reference||!profile.sessionReadySelector)throw new DynamicContractError(400,'Save a session reference and signed-in readiness selector first.');
   if(body.operation==='close'&&typeof body.captureId==='string')return {status:200,body:await deps.broker.close(deps.ownerId,projectId,id,body.captureId)};
   if(body.operation==='open')return {status:200,body:await deps.broker.open(deps.ownerId,projectId,profile,deps.captures)};
   if(body.operation==='save'&&typeof body.captureId==='string')return {status:200,body:await deps.broker.save(deps.ownerId,projectId,profile,body.captureId,body.expiresAt)};
   await deps.captures.requireIdle(projectId);const data=await deps.repository.data(projectId,id);if(['in_use','preparing','cleaning'].includes(data.state))throw new DynamicContractError(409,'Stop active environment work before capturing or changing its session.');
   if(body.operation==='forget')return {status:200,body:deps.vault.forget(deps.ownerId,projectId,id,reference)};
   if(body.operation==='import'){
    const capture=deps.broker.status(deps.ownerId,projectId,id);if(capture&&capture.state!=='closed')throw new DynamicContractError(409,'Close the sign-in browser before importing a saved session.');
    // Validation/encryption happens before returning status; never return raw state.
    const state=validateSessionState(body.storageState,profile.allowedOrigins);
    if(containsLocalValue(profile,sessionStateSensitiveValues(state)))throw new DynamicContractError(400,'Keep session values out of shared environment fields.');
    return {status:200,body:deps.vault.write(deps.ownerId,projectId,id,reference,state,body.expiresAt,profile.allowedOrigins)};
   }
  }
  return {status:405,body:{error:'Unsupported session operation.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};throw error;}
}
