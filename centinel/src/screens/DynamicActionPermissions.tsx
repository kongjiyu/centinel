import type {InteractionAction} from '../../../sidecar/src/dynamic/browser/actionPolicy';
export const emptyInteractionSelectors=():Record<InteractionAction,string>=>({click:'',type:'',select_option:'',set_checked:''});
const fields:Array<{action:InteractionAction;label:string}>=[{action:'click',label:'Controls allowed to click'},{action:'type',label:'Fields allowed to fill'},{action:'select_option',label:'Lists allowed to select'},{action:'set_checked',label:'Checkboxes allowed to change'}];
export function DynamicActionPermissions({selectors,onChange,allowCoordinates,onCoordinatesChange}:{selectors:Record<InteractionAction,string>;onChange(action:InteractionAction,value:string):void;allowCoordinates:boolean;onCoordinatesChange(value:boolean):void}){
 return <details className="dw-advanced"><summary>Browser action permissions</summary>
  <p className="dw-muted">Only the controls and actions listed here are approved for testing. Empty lists allow observation and navigation only. Approval includes the control's effects on this test environment; an allowed website address does not guarantee read-only behavior.</p>
  <div className="dw-check-fields">{fields.map(field=><div className="dw-field" key={field.action}><label htmlFor={'dw-permission-'+field.action}>{field.label}</label><textarea id={'dw-permission-'+field.action} rows={2} maxLength={10000} value={selectors[field.action]} onChange={event=>onChange(field.action,event.target.value)} placeholder="One unique CSS selector per line"/></div>)}</div>
  <label className="dw-required"><input type="checkbox" checked={allowCoordinates} onChange={event=>onCoordinatesChange(event.target.checked)}/>Allow screenshot coordinates for approved controls</label>
  <p className="dw-muted">Coordinates still require a protected screenshot and must point to an approved, unique control. Enter/Space submission, file controls and downloads are not enabled by these permissions. At most 20 controls; a Run keeps the permissions and engine versions recorded when it started.</p>
 </details>;
}
