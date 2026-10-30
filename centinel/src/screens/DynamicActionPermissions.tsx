import {useState} from 'react';
import type {InteractionAction} from '../../../sidecar/src/dynamic/browser/actionPolicy';
import type {DiscoveredControl} from '../../../sidecar/src/dynamic/environment/controlDiscovery';
export const emptyInteractionSelectors=():Record<InteractionAction,string>=>({click:'',type:'',select_option:'',set_checked:''});
const fields:Array<{action:InteractionAction;label:string}>=[{action:'click',label:'Controls allowed to click'},{action:'type',label:'Fields allowed to fill'},{action:'select_option',label:'Lists allowed to select'},{action:'set_checked',label:'Checkboxes allowed to change'}];
export function DynamicActionPermissions({selectors,onChange,allowCoordinates,onCoordinatesChange,repeatableSelectors,onRepeatableChange,onDiscover}:{selectors:Record<InteractionAction,string>;onChange(action:InteractionAction,value:string):void;allowCoordinates:boolean;onCoordinatesChange(value:boolean):void;repeatableSelectors:string;onRepeatableChange(value:string):void;onDiscover?():Promise<DiscoveredControl[]>}){
 const empty=Object.values(selectors).every(value=>!value.trim());
 return <details className="dw-advanced" open={empty&&Boolean(onDiscover)}><summary>Browser action permissions</summary>
  {onDiscover&&<ControlDiscovery onDiscover={onDiscover} selectors={selectors} onChange={onChange}/>}
  <p className="dw-muted">Only the controls and actions listed here are approved for testing. Empty lists allow observation and navigation only. Approval includes the control's effects on this test environment; an allowed website address does not guarantee read-only behavior.</p>
  <div className="dw-check-fields">{fields.map(field=><div className="dw-field" key={field.action}><label htmlFor={'dw-permission-'+field.action}>{field.label}</label><textarea id={'dw-permission-'+field.action} rows={2} maxLength={10000} value={selectors[field.action]} onChange={event=>onChange(field.action,event.target.value)} placeholder="One unique CSS selector per line"/></div>)}</div>
  <div className="dw-field"><label htmlFor="dw-repeatable-clicks">Click controls safe to repeat (optional)</label><textarea id="dw-repeatable-clicks" rows={2} maxLength={10000} value={repeatableSelectors} onChange={event=>onRepeatableChange(event.target.value)} placeholder="Already-approved click selectors, one per line"/><p className="dw-muted">Other click controls can be activated once per website path in a Run. Only mark controls whose repeated effects you approve, such as opening a menu. Conflicting selector rules keep repetition blocked.</p></div>
  <label className="dw-required"><input type="checkbox" checked={allowCoordinates} onChange={event=>onCoordinatesChange(event.target.checked)}/>Allow screenshot coordinates for approved controls</label>
  <p className="dw-muted">Coordinates still require a protected screenshot and must point to an approved, unique control. Enter/Space submission, file controls and downloads are not enabled by these permissions. At most 20 controls; a Run keeps the permissions and engine versions recorded when it started.</p>
 </details>;
}

/** Propose controls from a read-only page load; only ticked controls are added to the permission lists. */
function ControlDiscovery({onDiscover,selectors,onChange}:{onDiscover():Promise<DiscoveredControl[]>;selectors:Record<InteractionAction,string>;onChange(action:InteractionAction,value:string):void}){
 const [controls,setControls]=useState<DiscoveredControl[]|null>(null);const [chosen,setChosen]=useState<Set<string>>(new Set());
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);
 const listed=(action:InteractionAction)=>new Set(selectors[action].split('\n').map(line=>line.trim()).filter(Boolean));
 const find=async()=>{setBusy(true);setError(null);setNotice(null);try{const found=await onDiscover();setControls(found);setChosen(new Set(found.filter(control=>!control.actions.every(action=>listed(action).has(control.selector))).map(control=>control.selector)));}catch(cause){setError(cause instanceof Error&&cause.message?cause.message:'The page could not be scanned.');}finally{setBusy(false);}};
 const approve=()=>{if(!controls)return;const additions:Partial<Record<InteractionAction,string[]>>={};for(const control of controls){if(!chosen.has(control.selector))continue;for(const action of control.actions){if(!listed(action).has(control.selector))(additions[action]??=[]).push(control.selector);}}
  let count=0;for(const [action,items] of Object.entries(additions) as Array<[InteractionAction,string[]]>){count+=items.length;onChange(action,[selectors[action].trim(),...items].filter(Boolean).join('\n'));}
  setNotice(count?`${count} control${count===1?'':'s'} added. Save the environment to keep them.`:'Those controls are already approved.');};
 return <div className="dw-discovery">
  <div className="dw-discovery-heading"><div><strong>Find controls on the test page</strong><p className="dw-muted">Opens the website address once, read-only. Nothing is clicked or typed, and field values are not read. You choose which controls the test may use.</p></div><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void find()}>{busy?'Scanning…':controls?'Scan again':'Find controls'}</button></div>
  {error&&<p className="dw-notice" role="alert">{error}</p>}
  {controls&&controls.length===0&&<p className="dw-muted" role="status">No controls with a stable id, name, test id or label were found. Add selectors manually below.</p>}
  {controls&&controls.length>0&&<><ul className="dw-discovery-list" aria-label="Controls found on the page">{controls.map(control=><li key={control.selector}><label><input type="checkbox" checked={chosen.has(control.selector)} onChange={event=>setChosen(previous=>{const next=new Set(previous);if(event.target.checked)next.add(control.selector);else next.delete(control.selector);return next;})}/> <span className="dw-discovery-label">{control.label}</span> <small>{control.kind} · <code>{control.selector}</code></small></label></li>)}</ul>
   <button type="button" className="btn-primary" disabled={!chosen.size} onClick={approve}>Allow selected controls</button></>}
  {notice&&<p className="dw-muted" role="status">{notice}</p>}
 </div>;
}
