import type {ActionLedger} from './actionLedger.js';
import type {Page} from 'playwright';
import {authorizeBrowserAction,type BrowserActionPolicy} from './actionPolicy.js';
export type AgentAction=
 |{action:'click_visual';targetDescription:string;x:number;y:number;fallbackReason:string;reasoning:string}
 |{action:'click';targetDescription:string;selector?:string;elementRef?:string;x?:number;y?:number;fallbackReason?:string;reasoning:string}
 |{action:'type';targetDescription:string;selector?:string;elementRef?:string;x?:number;y?:number;fallbackReason?:string;text:string;reasoning:string}
 |{action:'select_option';selector?:string;elementRef?:string;value:string;reasoning:string}|{action:'set_checked';selector?:string;elementRef?:string;checked:boolean;reasoning:string}
 |{action:'press_key';key:string;reasoning:string}|{action:'scroll';direction:'up'|'down';amount:'small'|'medium'|'large';reasoning:string}
 |{action:'wait';milliseconds:number;reasoning:string}|{action:'navigate';url:string;reasoning:string}|{action:'assert_visible';text:string;reasoning:string}
 |{action:'observe_visual';reason:string;reasoning:string}|{action:'finish_success'|'finish_failure'|'finish_blocked';summary:string;reasoning:string};
export class BrowserActionUnavailable extends Error {}
export class BrowserActionUncertain extends Error {
 constructor(){super('Action outcome is uncertain. The action was not repeated; inspect the target and test data before retrying.');}
}
export type ElementBinding=string|{role:Parameters<Page['getByRole']>[0];name:string};
export type ActionReceipt={dispatch:'locator'|'coordinate'|'keyboard'|'navigation'|'observation';selector?:string;coordinateFallbackReason?:string;requestedUrl?:string;alreadyMatched?:boolean};
const stopped=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Execution stopped','AbortError');};
export async function waitForBrowserAction(ms:number,signal?:AbortSignal){
 stopped(signal);await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Execution stopped','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
}
/** One dispatch only. A failure after dispatch never becomes a second click,
 * coordinate fallback, fill, Enter or navigation request. */
export async function executeBrowserAction(page:Page,action:AgentAction,options:{signal?:AbortSignal;bindings?:ReadonlyMap<string,ElementBinding>;hasScreenshot?:boolean;policy?:BrowserActionPolicy;origins?:readonly string[];ledger?:ActionLedger}={}):Promise<ActionReceipt>{
 stopped(options.signal);
 if(action.action==='click_visual')action={action:'click',targetDescription:action.targetDescription,x:action.x,y:action.y,fallbackReason:action.fallbackReason,reasoning:action.reasoning};
 if((action.action==='click'||action.action==='type')&&(action.selector||action.elementRef)&&(action.x!==undefined||action.y!==undefined))throw new BrowserActionUnavailable('Locator and coordinate targets cannot be combined. Use click_visual with viewport coordinates for visual targets.');
 const authorization=options.policy?await authorizeBrowserAction(page,action,{policy:options.policy,origins:options.origins??[],bindings:options.bindings,signal:options.signal}):undefined;
 stopped(options.signal);
 if(action.action==='click'||action.action==='type'||action.action==='select_option'||action.action==='set_checked'){
  const binding=action.elementRef?options.bindings?.get(action.elementRef):action.selector;
  const selector=typeof binding==='string'?binding:undefined;
  if(action.elementRef&&!binding)throw new BrowserActionUnavailable('Element reference is absent from this observation. Re-observe before acting.');
  if(binding){const target=typeof binding==='string'?page.locator(binding):page.getByRole(binding.role,{name:binding.name,exact:true});if(await target.count()!==1||!await target.isVisible()||!await target.isEnabled())throw new BrowserActionUnavailable('A unique visible and enabled target is unavailable. Re-observe before acting.');stopped(options.signal);
   if(options.ledger&&action.action!=='click'){
    const matches=action.action==='type'?await target.evaluate(element=>{if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)return element.value;if((element as HTMLElement).isContentEditable)return (element as HTMLElement).innerText;throw new Error('Not fillable');})===action.text:action.action==='set_checked'?await target.isChecked()===action.checked:JSON.stringify(await target.evaluate(element=>{if(!(element instanceof HTMLSelectElement)||element.selectedOptions.length>30)throw new Error('Not selectable');return [...element.selectedOptions].map(option=>option.value);}))===JSON.stringify([action.value]);
    stopped(options.signal);if(matches)return {dispatch:'observation',selector,alreadyMatched:true};
   }
   if(action.action==='click'&&authorization?.targetKey)options.ledger?.reserveClick(authorization.targetKey,authorization.repeatable);
   try{if(action.action==='click')await target.click({timeout:5000});else if(action.action==='type')await target.fill(action.text,{timeout:5000});else if(action.action==='select_option')await target.selectOption(action.value,{timeout:5000});else await target.setChecked(action.checked,{timeout:5000});}catch{stopped(options.signal);throw new BrowserActionUncertain();}
   stopped(options.signal);return {dispatch:'locator',selector:typeof binding==='string'?binding:('role='+binding.role+' name='+binding.name)};
  }
  if(action.action==='select_option'||action.action==='set_checked')throw new BrowserActionUnavailable('This form action requires a stable locator from the current observation.');
  if(!options.hasScreenshot)throw new BrowserActionUnavailable('Coordinate fallback requires a protected screenshot from this observation.');
  const viewport=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  if(action.x===undefined||action.y===undefined||action.x<0||action.y<0||action.x>=viewport.width||action.y>=viewport.height)throw new BrowserActionUnavailable('Coordinates are outside the observed browser viewport.');
  stopped(options.signal);if(action.action==='click'&&authorization?.targetKey)options.ledger?.reserveClick(authorization.targetKey,authorization.repeatable);try{await page.mouse.click(action.x,action.y);if(action.action==='type')await page.keyboard.type(action.text);}catch{stopped(options.signal);throw new BrowserActionUncertain();}
  stopped(options.signal);return {dispatch:'coordinate',coordinateFallbackReason:action.fallbackReason?.trim()||'The proposal supplied coordinates without a stable locator.'};
 }
 switch(action.action){
  case 'press_key':try{await page.keyboard.press(action.key);}catch{stopped(options.signal);throw new BrowserActionUncertain();}stopped(options.signal);return {dispatch:'keyboard'};
  case 'navigate':try{await page.goto(action.url,{timeout:30000,waitUntil:'domcontentloaded'});}catch{stopped(options.signal);throw new BrowserActionUncertain();}stopped(options.signal);return {dispatch:'navigation',requestedUrl:action.url};
  case 'scroll':await page.mouse.wheel(0,(action.direction==='down'?1:-1)*({small:200,medium:500,large:1000}[action.amount]));stopped(options.signal);return {dispatch:'observation'};
  case 'wait':await waitForBrowserAction(action.milliseconds,options.signal);return {dispatch:'observation'};
  case 'assert_visible':if(!(await page.locator('body').innerText({timeout:3000})).includes(action.text))throw new BrowserActionUnavailable('Proposed visible text was not observed.');stopped(options.signal);return {dispatch:'observation'};
  default:throw new BrowserActionUnavailable('This proposal is not an executable browser action.');
 }
}
