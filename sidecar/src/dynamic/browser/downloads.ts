import crypto from 'node:crypto';import type {CDPSession,Download,Page} from 'playwright';
import {BrowserPolicyBlocked,type BrowserActionPolicy} from './actionPolicy.js';import {BrowserActionUnavailable,BrowserActionUncertain,type AgentAction,type ElementBinding} from './actions.js';import type {ActionLedger} from './actionLedger.js';import {allowedBrowserUrl} from './policy.js';import {containsLocalValue} from '../environment/secrets.js';import {MAX_DOWNLOAD_BYTES,type DownloadGrant,type DownloadReceipt} from './fileTypes.js';
type Paused={requestId:string;request:{url:string;method:string};responseStatusCode?:number;responseHeaders?:Array<{name:string;value:string}>;resourceType:string};
type Pending={page:Page;grant:DownloadGrant;buffer?:Buffer;capturing:boolean;resolve:(receipt:DownloadReceipt)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
/** Response headers are paused before Chrome's download persistence. Read bounded
 * chunks, then deliver only verified bytes. Native downloads remain disabled. */
export class ApprovedDownloads {
 readonly receipts:DownloadReceipt[]=[];private sessions=new Map<Page,CDPSession>();private pending?:Pending;private disposed=false;
 constructor(private options:{signal:AbortSignal;canForward?:()=>boolean;secrets:readonly string[];onPrivateValue(value:string):void;onViolation(reason:string):void;retain(receipt:Omit<DownloadReceipt,'id'>,buffer:Buffer):DownloadReceipt}){}
 private stopped(){if(this.disposed||this.options.signal.aborted||this.options.canForward?.()===false)throw new DOMException('Download execution stopped','AbortError');}
 async attach(page:Page){this.stopped();const cdp=await page.context().newCDPSession(page);this.sessions.set(page,cdp);cdp.on('Fetch.requestPaused',(event:Paused)=>{void this.response(page,cdp,event);});await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Response'}]});}
 private fail(reason:string){this.pending?.reject(new BrowserPolicyBlocked(reason));this.options.onViolation(reason);}
 private matches(url:string,grant:DownloadGrant){try{const actual=new URL(url),expected=new URL(grant.url);return actual.origin===expected.origin&&actual.pathname===expected.pathname;}catch{return false;}}
 private async response(page:Page,cdp:CDPSession,event:Paused){let stream:string|undefined;
  try{
   this.stopped();const headers=event.responseHeaders??[];const header=(name:string)=>headers.filter(item=>item.name.toLowerCase()===name).map(item=>item.value).join(',');const attachment=/\battachment\b/i.test(header('content-disposition'));const pending=this.pending;
   if(!pending||pending.page!==page||!this.matches(event.request.url,pending.grant)){
    if(attachment)throw new BrowserPolicyBlocked('Download response is not approved by the frozen permissions.');await cdp.send('Fetch.continueRequest',{requestId:event.requestId});return;
   }
   if(pending.capturing||event.request.method!=='GET'||!['Document','Other'].includes(event.resourceType)||event.responseStatusCode!==200)throw new BrowserPolicyBlocked('Approved download requires one direct browser GET response with status 200.');
   pending.capturing=true;const encoding=header('content-encoding');const mime=header('content-type').split(';')[0].trim().toLowerCase();const length=header('content-length');
   if(encoding&&!['identity','gzip','deflate','br'].includes(encoding.trim().toLowerCase())||mime!==pending.grant.mimeType||length&&(!/^\d+$/.test(length)||Number(length)>pending.grant.maxBytes))throw new BrowserPolicyBlocked('Download MIME, encoding or declared size does not match its frozen permission.');
   const source=await cdp.send('Fetch.takeResponseBodyAsStream',{requestId:event.requestId});stream=source.stream;const chunks:Buffer[]=[];let bytes=0;let eof=false;
   while(!eof){this.stopped();const result=await cdp.send('IO.read',{handle:stream,size:65536});this.stopped();const chunk=Buffer.from(result.data,result.base64Encoded?'base64':'utf8');bytes+=chunk.length;if(bytes>pending.grant.maxBytes||bytes>MAX_DOWNLOAD_BYTES)throw new BrowserPolicyBlocked('Download exceeded its frozen byte limit.');chunks.push(chunk);eof=result.eof;}
   await cdp.send('IO.close',{handle:stream});stream=undefined;this.stopped();const buffer=Buffer.concat(chunks,bytes);
   if(containsLocalValue(buffer.toString('utf8'),[...this.options.secrets]))throw new BrowserPolicyBlocked('Download is empty or contains a known private environment value.');
   if(this.pending!==pending)throw new BrowserPolicyBlocked('Download authorization window expired.');pending.buffer=buffer;
   await cdp.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[...headers.filter(item=>!['content-length','transfer-encoding','content-encoding'].includes(item.name.toLowerCase())),{name:'Content-Length',value:String(bytes)}],body:buffer.toString('base64')});
  }catch(error){if(stream)await cdp.send('IO.close',{handle:stream}).catch(()=>{});await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});if(!this.disposed&&!this.options.signal.aborted)this.fail(error instanceof BrowserPolicyBlocked?error.message:'Approved download could not be captured safely.');}
 }
 nativeDownload(page:Page,download:Download):boolean{
  void download.cancel().catch(()=>{});if(this.disposed)return false;const pending=this.pending;
  if(!pending||pending.page!==page||!pending.buffer||!this.matches(download.url(),pending.grant)){this.fail('Unexpected native download was blocked.');return false;}
  try{this.stopped();this.options.onPrivateValue(download.suggestedFilename());const payload=pending.buffer;pending.buffer=undefined;const metadata:Omit<DownloadReceipt,'id'>={kind:'download',permissionUrl:pending.grant.url,sha256:crypto.createHash('sha256').update(payload).digest('hex'),bytes:payload.length,mimeType:pending.grant.mimeType};const receipt=this.options.retain(metadata,payload);if(receipt.sha256!==metadata.sha256||receipt.bytes!==metadata.bytes||receipt.permissionUrl!==metadata.permissionUrl||receipt.mimeType!==metadata.mimeType||!receipt.id)throw Error();this.receipts.push(receipt);pending.resolve(receipt);return true;}catch{this.fail('Approved download could not be retained safely.');return false;}
 }
 async execute(page:Page,action:Extract<AgentAction,{action:'download_file'}>,options:{policy?:BrowserActionPolicy;origins?:readonly string[];bindings?:ReadonlyMap<string,ElementBinding>;ledger?:ActionLedger}):Promise<DownloadReceipt>{
  this.stopped();if(this.pending||!this.sessions.has(page)||!options.policy||!allowedBrowserUrl(page.url(),options.origins??[]))throw new BrowserPolicyBlocked('Download requires a frozen permission and an available browser capture.');
  const binding=action.elementRef?options.bindings?.get(action.elementRef):action.selector;if(!binding)throw new BrowserActionUnavailable('Download target is absent from this observation.');const target=typeof binding==='string'?page.locator(binding):page.getByRole(binding.role,{name:binding.name,exact:true});
  if(await target.count()!==1||!await target.isVisible()||!await target.isEnabled())throw new BrowserActionUnavailable('A unique visible and enabled download control is unavailable.');
  const matched=await target.evaluate((element,selectors)=>element.matches('a,button,input[type=button],input[type=submit]')?selectors.filter(selector=>{try{return element.matches(selector)&&document.querySelectorAll(selector).length===1;}catch{return false;}}):[],(options.policy.downloads??[]).map(grant=>grant.selector));if(matched.length!==1)throw new BrowserPolicyBlocked('The actual download control must match one frozen permission.');
  const grant=options.policy.downloads!.find(row=>row.selector===matched[0])!;if(!allowedBrowserUrl(grant.url,options.origins??[]))throw new BrowserPolicyBlocked('Approved download URL is outside the frozen allowed origins.');
  const href=await target.evaluate(element=>element instanceof HTMLAnchorElement?element.href:null);if(href&&!this.matches(href,grant))throw new BrowserPolicyBlocked('Download link destination does not match its frozen permission.');this.stopped();
  const location=new URL(page.url());options.ledger?.reserveClick(crypto.createHash('sha256').update('download\n'+location.origin+location.pathname+'\n'+matched[0]).digest('hex'),false);
  let pending!:Pending;const completed=new Promise<DownloadReceipt>((resolve,reject)=>{pending={page,grant,capturing:false,resolve,reject,timer:setTimeout(()=>reject(new BrowserActionUncertain()),30000)};});void completed.catch(()=>{});this.pending=pending;
  const abort=()=>pending.reject(new DOMException('Download execution stopped','AbortError'));this.options.signal.addEventListener('abort',abort,{once:true});
  try{try{await target.click({timeout:5000});}catch{this.stopped();throw new BrowserActionUncertain();}const receipt=await completed;this.stopped();return receipt;}finally{clearTimeout(pending.timer);this.options.signal.removeEventListener('abort',abort);if(this.pending===pending)this.pending=undefined;}
 }
 close(){this.disposed=true;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new DOMException('Download capture closed','AbortError'));this.pending=undefined;}this.sessions.clear();}
}
