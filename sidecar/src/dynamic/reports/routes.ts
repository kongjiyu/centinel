import {canonicalJson} from '../../report/canonical.js';
import {DynamicContractError} from '../types.js';
import type {DynamicReportRepository} from './repository.js';
import {renderDynamicReportMarkdown,renderDynamicReportPdf,reportHash} from './render.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function handleDynamicReportRoute(request:{method:string;pathname:string;readBody():Promise<unknown>},deps:{repository:DynamicReportRepository;requireMember(project:string):Promise<void>}){
 const match=request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/(?:runs\/([^/]+)\/reports|reports\/([^/]+)(?:\/(json|markdown|pdf))?)$/);if(!match)return null;
 const [,project,run,id,format]=match;await deps.requireMember(project);
 try{
  if(!uuid.test(project)||!uuid.test(run??id))throw new DynamicContractError(400,'Valid project and report/Run identities required.');
  if(run&&request.method==='GET')return {status:200,body:await deps.repository.list(project,run)};
  if(run&&request.method==='POST'){const body=await request.readBody();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='reportId')||!uuid.test(String((body as any).reportId??'')))throw new DynamicContractError(400,'A fresh reportId is required; verdicts and findings are captured by the server.');return {status:201,body:await deps.repository.capture(project,run,(body as any).reportId)};}
  if(id&&request.method==='GET'){const snapshot=await deps.repository.get(project,id);if(!format)return {status:200,body:snapshot};const bytes=format==='pdf'?await renderDynamicReportPdf(snapshot):Buffer.from(format==='json'?canonicalJson(snapshot):renderDynamicReportMarkdown(snapshot));if(bytes.length>8*1024*1024)throw new DynamicContractError(409,'Rendered report exceeds export bound.');return {status:200,body:bytes,mimeType:format==='pdf'?'application/pdf':format==='json'?'application/json':'text/markdown; charset=utf-8',filename:`centinel-dynamic-${id}.${format==='markdown'?'md':format}`,sha256:reportHash(bytes)};}
  return {status:405,body:{error:'Method not allowed.'}};
 }catch(error){if(error instanceof DynamicContractError)return {status:error.status,body:{error:error.message}};throw error;}
}
