import type {ElementBinding} from './actions.js';
import type {Page} from 'playwright';
import {redactObservation,redactObservationRecord} from './privacy.js';
export class BrowserObservationUnavailable extends Error {}
export type BrowserObservation={schemaVersion:1;url:string;title:string;visibleText:string;elements:string[];controls:Array<{ref:string;role:string;name:string;selector?:string;disabled:boolean}>;omittedControls:boolean};
/** Read DOM semantics first. Secrets are never passed into the page's JS realm.
 * Private raw selectors are retained only in the executing process's ref map. */
export async function observeBrowserPage(page:Page,options:{secrets?:readonly string[];sensitiveSelectors?:readonly string[];signal?:AbortSignal}={}):Promise<{observation:BrowserObservation;bindings:ReadonlyMap<string,ElementBinding>;sensitiveValues:readonly string[]}>{
 if(options.signal?.aborted)throw new DOMException('Observation stopped','AbortError');
 const raw=await page.evaluate((selectors)=>{
  const sensitive='input[type="password"],[autocomplete="current-password"],[autocomplete="new-password"],[autocomplete^="cc-"],[data-centinel-sensitive]';
  const masks=[...document.querySelectorAll(sensitive),...selectors.flatMap(selector=>[...document.querySelectorAll(selector)])];
  if(masks.length>1000)return {oversized:true} as const;
  const privateTexts=masks.flatMap(el=>[(el as HTMLElement).innerText??'',(el as HTMLInputElement).value??'']).filter(Boolean);
  const body=document.body?.innerText??'';if(body.length>100000||privateTexts.some(text=>text.length>10000))return {oversized:true} as const;
  const candidates=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[tabindex]')];
  const controls=[];let visible=0;
  for(const el of candidates){const html=el as HTMLElement;const rect=html.getBoundingClientRect();const style=getComputedStyle(html);if(!rect.width||!rect.height||style.visibility==='hidden'||style.display==='none'||el.matches('input[type="hidden"]'))continue;visible++;if(controls.length>=40)continue;
   const tag=el.tagName.toLowerCase();const labelledBy=el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ');
   const name=el.getAttribute('aria-label')||labelledBy||el.getAttribute('placeholder')||(html as HTMLInputElement).labels?.[0]?.textContent||el.textContent||el.getAttribute('name')||'';
   let selector:string|undefined;for(const attribute of ['data-testid','data-test','id','name']){const value=el.getAttribute(attribute);if(!value)continue;if(value.length>1000)return {oversized:true} as const;const candidate=attribute==='id'?'#'+CSS.escape(value):tag+'['+attribute+'='+JSON.stringify(value)+']';try{if(document.querySelectorAll(candidate).length===1){selector=candidate;break;}}catch{}}
   if(!selector&&document.querySelectorAll(tag).length===1)selector=tag;
   if(name.length>10000)return {oversized:true} as const;
   const type=el.getAttribute('type')?.toLowerCase();
   const role=el.getAttribute('role')||(tag==='a'?'link':tag==='button'||tag==='input'&&['button','submit','reset'].includes(type??'')?'button':tag==='input'&&['checkbox','radio'].includes(type??'')?type!:tag==='input'||tag==='textarea'?'textbox':tag==='select'?'combobox':tag);
   if(role.length>1000)return {oversized:true} as const;
   controls.push({selector,role,name,disabled:el.matches(':disabled')||el.getAttribute('aria-disabled')==='true'});
  }
  return {oversized:false,body,privateTexts,controls,omittedControls:visible>controls.length};
 },options.sensitiveSelectors??[]);
 if(options.signal?.aborted)throw new DOMException('Observation stopped','AbortError');
 if(raw.oversized)throw new BrowserObservationUnavailable('DOM observation exceeded its bounded extraction limit. Reduce the surface or review missing coverage.');
 const secrets=[...(options.secrets??[]),...raw.privateTexts];const bindings=new Map<string,ElementBinding>();
 const controls=raw.controls.map((item,index)=>{const ref='e'+index;if(item.selector)bindings.set(ref,item.selector);else if(['button','link','checkbox','radio','combobox','textbox'].includes(item.role)&&item.name.trim())bindings.set(ref,{role:item.role as Parameters<Page['getByRole']>[0],name:item.name.trim()});const clean=redactObservationRecord(item,secrets);return {ref,role:clean.role,name:clean.name.trim().slice(0,250),disabled:clean.disabled,...(clean.selector===item.selector&&item.selector?{selector:item.selector}:{})};});
 return {bindings,sensitiveValues:raw.privateTexts,observation:{schemaVersion:1,url:redactObservation(page.url(),secrets),title:redactObservation(await page.title(),secrets),visibleText:redactObservation(raw.body,secrets).slice(0,2000),controls,elements:controls.map(item=>`[${item.ref}] ${item.role} ${item.name}${item.disabled?' (disabled)':''}${item.selector?' selector='+item.selector:''}`),omittedControls:raw.omittedControls}};
}
