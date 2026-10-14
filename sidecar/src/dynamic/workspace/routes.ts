import type {WorkspaceRegistry} from './registry.js';import {inspectWorkspace} from './registry.js';
import {redactOutput} from './redaction.js';
import {DynamicContractError} from '../types.js';
export async function handleWorkspaceRoute(request:{method:string;pathname:string;readBody():Promise<Record<string,unknown>>},deps:{ownerId:string;registry:WorkspaceRegistry;requireMember(projectId:string):Promise<void>;requireEnvironment(projectId:string,id:string):Promise<unknown>;secretValues(projectId:string,id:string):string[]|Promise<string[]>}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments\/([^/]+)\/workspace$/);if(!match)return null;const [,projectId,id]=match;
 await deps.requireMember(projectId);await deps.requireEnvironment(projectId,id);
 try{
  if(request.method==='GET')return {status:200,body:{authorization:deps.registry.read(deps.ownerId,projectId,id)}};
  if(request.method==='POST'){
   const body=await request.readBody();if(body.operation==='inspect'){const inspection=inspectWorkspace(body.directory as string);const values=await deps.secretValues(projectId,id);inspection.scriptDefinitions=Object.fromEntries(Object.entries(inspection.scriptDefinitions).map(([name,command])=>[name,redactOutput(command,values)]));return {status:200,body:{inspection}};}
   if(body.operation==='authorize')return {status:200,body:{authorization:deps.registry.authorize(deps.ownerId,projectId,id,body)}};
   throw new DynamicContractError(400,'Choose inspect or authorize workspace.');
  }
  return {status:405,body:{error:'Unsupported workspace operation.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};throw error;}
}
