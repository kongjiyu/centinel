import { containsLocalValue } from './secrets.js';
import type { EnvironmentRepository } from './repository.js';
import type { EnvironmentVault } from './vault.js';
import { checkEnvironment } from './preflight.js';
import { DynamicContractError } from '../types.js';
export async function handleEnvironmentRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;repository:EnvironmentRepository;vault:EnvironmentVault;requireMember(projectId:string):Promise<void>;providerReady(projectId:string):Promise<boolean>}) {
  const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments(?:\/([^/]+))?(?:\/(values|preflight))?$/);
  if(!match)return null;
  const [,projectId,id,action]=match; await deps.requireMember(projectId);
  try {
    if(!id&&request.method==='GET')return {status:200,body:await deps.repository.list(projectId)};
    if(!action&&request.method==='POST'){
      const body=await request.readBody();
      if(id) await deps.repository.get(projectId,id);
      const profiles=await deps.repository.list(projectId);
      if(containsLocalValue(body,profiles.flatMap(profile=>Object.values(deps.vault.read(deps.ownerId,projectId,profile.id))))) throw new DynamicContractError(400,'Keep local values out of shared profile fields.');
      return {status:201,body:await deps.repository.save(projectId,body,id)};
    }
    if(id){
      const profile=await deps.repository.get(projectId,id);
      if(action==='values'&&request.method==='POST'){
        const values=(await request.readBody()).values;
        if(values&&typeof values==='object'&&containsLocalValue(profile,Object.values(values).filter((value):value is string=>typeof value==='string'))) throw new DynamicContractError(400,'Local values must not already appear in shared profile fields.');
        return {status:200,body:deps.vault.write(deps.ownerId,projectId,id,values)};
      }
      if(action==='values'&&request.method==='GET')return {status:200,body:{variableNames:deps.vault.names(deps.ownerId,projectId,id)}};
      if(action==='preflight'&&request.method==='POST')return {status:200,body:await checkEnvironment(profile,deps.vault.names(deps.ownerId,projectId,id),await deps.providerReady(projectId))};
    }
    return {status:405,body:{error:'Unsupported environment operation.'}};
  }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};throw error;}
}
