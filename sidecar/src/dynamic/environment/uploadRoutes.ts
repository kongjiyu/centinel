import type {UploadVault} from './uploadVault.js';import type {EnvironmentRepository} from './repository.js';import {DynamicContractError} from '../types.js';
import {containsLocalValue} from './secrets.js';
export async function handleUploadRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;vault:UploadVault;repository:EnvironmentRepository;requireMember(projectId:string):Promise<void>;secretValues?(project:string):Promise<string[]>}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments\/([^/]+)\/uploads(?:\/([^/]+))?$/);if(!match)return null;const [,project,profile,id]=match;
 await deps.requireMember(project);await deps.repository.get(project,profile);
 try{
  if(id==='permissions'&&request.method==='POST'){
   const body=await request.readBody();if(!Number.isInteger(body.version))throw new DynamicContractError(400,'Refresh the saved environment before changing upload permissions.');
   return {status:200,body:await deps.repository.saveUploadPermissions(project,profile,body.version as number,body.uploads)};
  }
  if(!id&&request.method==='GET')return {status:200,body:deps.vault.list(deps.ownerId,project,profile)};
  if(!id&&request.method==='POST'){
   const body=await request.readBody();
   if(typeof body.base64==='string'&&body.base64.length<=1_400_000&&containsLocalValue({name:body.name,contents:Buffer.from(body.base64,'base64').toString('utf8')},await deps.secretValues?.(project)??[]))throw new DynamicContractError(400,'A known private environment value appears in this file. Choose public synthetic test data.');
   return {status:201,body:deps.vault.save(deps.ownerId,project,profile,body)};
  }
  if(id&&request.method==='DELETE')return {status:200,body:deps.vault.forget(deps.ownerId,project,profile,id)};
  return {status:405,body:{error:'Unsupported local upload operation.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};if(error instanceof SyntaxError)return {status:400,body:{error:'Provide a valid local upload request.'}};throw error;}
}
