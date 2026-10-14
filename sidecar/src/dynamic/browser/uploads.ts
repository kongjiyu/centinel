import crypto from 'node:crypto';import type {Page} from 'playwright';
import {BrowserPolicyBlocked,type BrowserActionPolicy} from './actionPolicy.js';
import {BrowserActionUnavailable,BrowserActionUncertain,type AgentAction,type ElementBinding,type ActionReceipt} from './actions.js';
import {allowedBrowserUrl} from './policy.js';import type {ActionLedger} from './actionLedger.js';import type {UploadGrant,UploadPayload} from './fileTypes.js';
export async function executeApprovedUpload(page:Page,action:Extract<AgentAction,{action:'upload_file'}>,options:{policy?:BrowserActionPolicy;origins?:readonly string[];bindings?:ReadonlyMap<string,ElementBinding>;signal?:AbortSignal;ledger?:ActionLedger;resolveUpload?:(grant:UploadGrant)=>UploadPayload;onUploadPrivateValue?:(value:string)=>void}):Promise<ActionReceipt>{
 const stopped=()=>{if(options.signal?.aborted)throw new DOMException('Upload stopped','AbortError');};stopped();
 if(!options.policy||!options.resolveUpload||!allowedBrowserUrl(page.url(),options.origins??[]))throw new BrowserPolicyBlocked('Upload requires a frozen environment grant and an available local test file.');
 const binding=action.elementRef?options.bindings?.get(action.elementRef):action.selector;if(!binding)throw new BrowserActionUnavailable('Upload target is absent from the current observation.');
 const target=typeof binding==='string'?page.locator(binding):page.getByRole(binding.role,{name:binding.name,exact:true});
 if(await target.count()!==1||!await target.isVisible()||!await target.isEnabled())throw new BrowserActionUnavailable('A unique visible and enabled upload input is unavailable.');
 const selectors=(options.policy.uploads??[]).filter(grant=>grant.id===action.fixtureId).map(grant=>grant.selector);
 const matches=await target.evaluate((element,grants)=>element instanceof HTMLInputElement&&element.type==='file'?grants.filter(selector=>{try{return element.matches(selector)&&document.querySelectorAll(selector).length===1;}catch{return false;}}):[],selectors);
 if(matches.length!==1)throw new BrowserPolicyBlocked('This file input and fixture are not approved by the frozen upload permissions.');
 const grant=options.policy.uploads!.find(row=>row.id===action.fixtureId&&row.selector===matches[0])!;
 let payload:UploadPayload;try{payload=options.resolveUpload(grant);}catch{throw new BrowserPolicyBlocked('Approved upload is unavailable, expired or does not match its frozen fingerprint.');}
 if(payload.buffer.length!==grant.bytes||payload.mimeType!==grant.mimeType||crypto.createHash('sha256').update(payload.buffer).digest('hex')!==grant.sha256)throw new BrowserPolicyBlocked('Upload bytes do not match the frozen permission.');
 options.onUploadPrivateValue?.(payload.name);stopped();
 const aliases=await target.evaluate((element,selectors)=>selectors.filter(selector=>{try{return element.matches(selector)&&document.querySelectorAll(selector).length===1;}catch{return false;}}),(options.policy.uploads??[]).map(row=>row.selector));stopped();
 const location=new URL(page.url());options.ledger?.reserveClick(crypto.createHash('sha256').update('upload\n'+location.origin+location.pathname+'\n'+aliases.sort().join('\n')).digest('hex'),false);
 try{await target.setInputFiles(payload,{timeout:5000});}catch{stopped();throw new BrowserActionUncertain();}stopped();
 return {dispatch:'upload',selector:grant.selector,fileTransfer:{kind:'upload',fixtureId:grant.id,sha256:grant.sha256,bytes:grant.bytes,mimeType:grant.mimeType}};
}
