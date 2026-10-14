import crypto from 'node:crypto';
import type {Locator, Page} from 'playwright';
import type {AgentAction, ElementBinding} from './actions.js';
import {allowedBrowserUrl} from './policy.js';
import {DynamicContractError} from '../types.js';
import {MAX_UPLOAD_BYTES,type UploadGrant} from './fileTypes.js';

export const INTERACTION_ACTIONS=['click','type','select_option','set_checked'] as const;
export type InteractionAction=typeof INTERACTION_ACTIONS[number];
export type BrowserActionPolicy={schemaVersion:1;interactions:Array<{selector:string;actions:InteractionAction[];repeatable?:boolean}>;allowCoordinates:boolean;uploads?:UploadGrant[]};
export class BrowserPolicyBlocked extends Error {}
/** Environment settings are authoritative. Page/model content cannot add grants. */
export function normalizeActionPolicy(value?:unknown):BrowserActionPolicy {
 const fail=():never=>{throw new DynamicContractError(400,'Action permissions need at most 20 unique selectors, supported actions and an explicit coordinate setting.');};
 if(value===undefined)return {schemaVersion:1,interactions:[],allowCoordinates:false};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const input=value as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['schemaVersion','interactions','allowCoordinates','uploads'].includes(key))||input.schemaVersion!==1||typeof input.allowCoordinates!=='boolean'||!Array.isArray(input.interactions)||input.interactions.length>20)return fail();
 const seen=new Set<string>();const interactions=input.interactions.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();const row=raw as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['selector','actions','repeatable'].includes(key))||typeof row.selector!=='string'||!row.selector.trim()||row.selector.length>500||!Array.isArray(row.actions)||!row.actions.length||row.actions.length>4||new Set(row.actions).size!==row.actions.length||row.actions.some(action=>!INTERACTION_ACTIONS.includes(action as InteractionAction)))return fail();
  if(row.repeatable!==undefined&&(typeof row.repeatable!=='boolean'||!row.actions.includes('click')))return fail();
  const selector=row.selector.trim();if(seen.has(selector))return fail();seen.add(selector);return {selector,actions:[...row.actions] as InteractionAction[],...(row.repeatable!==undefined?{repeatable:row.repeatable as boolean}:{})};
 });
 let uploads:UploadGrant[]|undefined;
 if(input.uploads!==undefined){
  if(!Array.isArray(input.uploads)||input.uploads.length>10)return fail();const targets=new Set<string>();
  uploads=input.uploads.map((value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail();const row=value as Record<string,unknown>;
   if(Object.keys(row).some(key=>!['selector','id','sha256','bytes','mimeType'].includes(key))||typeof row.selector!=='string'||!row.selector.trim()||row.selector.length>500||typeof row.id!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(row.id)||typeof row.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(row.sha256)||typeof row.bytes!=='number'||!Number.isInteger(row.bytes)||row.bytes<1||row.bytes>MAX_UPLOAD_BYTES||typeof row.mimeType!=='string'||row.mimeType.length>100||!(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/).test(row.mimeType))return fail();
   const selector=row.selector.trim();if(targets.has(selector))return fail();targets.add(selector);return {selector,id:row.id,sha256:row.sha256,bytes:row.bytes,mimeType:row.mimeType};
  });
 }
 return {schemaVersion:1,interactions,allowCoordinates:input.allowCoordinates,...(uploads?{uploads}:{})};
}
const checkStopped=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Policy check stopped','AbortError');};
/** Authorize the actual resolved target, never its model-supplied description.
 * Allowed origins do not promise that the target server is read-only. */
export async function authorizeBrowserAction(page:Page,action:AgentAction,options:{policy:BrowserActionPolicy;origins:readonly string[];bindings?:ReadonlyMap<string,ElementBinding>;signal?:AbortSignal}):Promise<{targetKey?:string;repeatable:boolean}>{
 checkStopped(options.signal);
 if(action.action==='navigate'){if(!allowedBrowserUrl(action.url,options.origins))throw new BrowserPolicyBlocked('Navigation is outside the frozen allowed origins.');return {repeatable:true};}
 if(action.action==='press_key'){
  if(!['Tab','Shift+Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(action.key))throw new BrowserPolicyBlocked('This key can activate or submit a control. Use an explicitly approved target interaction.');return {repeatable:true};
 }
 if(!INTERACTION_ACTIONS.includes(action.action as InteractionAction))return {repeatable:true};
 const proposal=action as Extract<AgentAction,{action:'click'|'type'|'select_option'|'set_checked'}>;
 const binding=proposal.elementRef?options.bindings?.get(proposal.elementRef):proposal.selector;
 if(proposal.elementRef&&!binding)throw new BrowserPolicyBlocked('The element reference is unavailable in the current observation.');
 let target:Locator;
 if(binding)target=typeof binding==='string'?page.locator(binding):page.getByRole(binding.role,{name:binding.name,exact:true});
 else {
  if((proposal.action!=='click'&&proposal.action!=='type')||!options.policy.allowCoordinates||proposal.x===undefined||proposal.y===undefined)throw new BrowserPolicyBlocked('Coordinate actions are not enabled for this environment.');
  // Do not mutate page attributes to create a selector or authorize an iframe.
  const at=await page.evaluate(({x,y})=>{const element=document.elementFromPoint(x,y);return element?{tag:element.tagName.toLowerCase()}:null;},{x:proposal.x,y:proposal.y});
  if(!at||at.tag==='iframe')throw new BrowserPolicyBlocked('The coordinate target cannot be authorized in the current document.');
  const approved=options.policy.interactions.filter(row=>row.actions.includes(action.action as InteractionAction));
  const match=await page.evaluate(({x,y,selectors})=>{const element=document.elementFromPoint(x,y);return selectors.filter(selector=>{try{return !!element?.matches(selector)&&document.querySelectorAll(selector).length===1;}catch{return false;}});},{x:proposal.x,y:proposal.y,selectors:approved.map(row=>row.selector)});
  if(match.length!==1)throw new BrowserPolicyBlocked('Coordinates must resolve to one explicitly approved control.');target=page.locator(match[0]);
 }
 if(await target.count()!==1)throw new BrowserPolicyBlocked('The approved interaction target must be unique.');
 const grants=options.policy.interactions.filter(row=>row.actions.includes(action.action as InteractionAction)).map(row=>row.selector);
 const permitted=await target.evaluate((element,selectors)=>{
  const forbidden=element.closest('input[type="file"],a[download]')||element.closest('label')?.control?.matches('input[type="file"]');
  if(forbidden)return [];
  return selectors.filter(selector=>{try{return element.matches(selector)&&document.querySelectorAll(selector).length===1;}catch{return false;}});
 },grants);
 checkStopped(options.signal);if(!permitted.length)throw new BrowserPolicyBlocked('This control/action is not approved in the frozen environment. File controls and downloads are not supported by these interaction grants.');
 const location=new URL(page.url());const targetKey=crypto.createHash('sha256').update(location.origin+location.pathname+'\n'+permitted.slice().sort().join('\n')).digest('hex');
 return {targetKey,repeatable:options.policy.interactions.filter(row=>permitted.includes(row.selector)).every(row=>row.repeatable===true)};
}
