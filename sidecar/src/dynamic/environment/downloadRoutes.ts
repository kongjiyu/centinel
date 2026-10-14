import {DynamicContractError} from '../types.js';import type {DynamicService} from '../service.js';import type {EnvironmentRepository} from './repository.js';import type {DownloadVault} from './downloadVault.js';
export async function handleDownloadRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;vault:DownloadVault;environments:EnvironmentRepository;service:DynamicService;requireMember(project:string):Promise<void>;privateValues?(project:string):Promise<string[]>}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/(environments\/([^/]+)\/downloads|runs\/([^/]+)\/downloads(?:\/([^/]+))?)$/);if(!match)return null;const [,project,,profile,run,id]=match;await deps.requireMember(project);
 try{
  if(profile){await deps.environments.get(project,profile);if(request.method!=='POST')return {status:405,body:{error:'Unsupported download-permission operation.'}};const body=await request.readBody();return {status:200,body:await deps.environments.saveDownloadPermissions(project,profile,body.version as number,body.downloads,await deps.privateValues?.(project)??[])};}
  await deps.service.requireRun(project,run);
  if(request.method==='GET')return {status:200,body:id?deps.vault.get(deps.ownerId,project,run,id):deps.vault.list(deps.ownerId,project,run)};
  if(id&&request.method==='DELETE')return {status:200,body:deps.vault.forget(deps.ownerId,project,run,id)};
  return {status:405,body:{error:'Unsupported downloaded-file operation.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};if(error instanceof SyntaxError)return {status:400,body:{error:'Provide a valid download request.'}};throw error;}
}
