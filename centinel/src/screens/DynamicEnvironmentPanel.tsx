import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import {Select} from '../components/Select';
import {userFacingError} from '../utils/userFacingError';
import type {EnvironmentInput,EnvironmentProfile,EnvironmentSnapshot} from '../dynamic/types';
const blank = ():EnvironmentInput=>({name:'',targetUrl:'',allowedOrigins:[],viewport:{width:1280,height:720},accountRole:'',requiredVariables:[],startupInstructions:'',targetVersion:''});
export function DynamicEnvironmentPanel({projectId,value,onChange,disabled}:{projectId:string;value:string;onChange(id:string):void;disabled:boolean}) {
 const [profiles,setProfiles]=useState<EnvironmentProfile[]>([]);const [editing,setEditing]=useState<string|undefined>();
 const [draft,setDraft]=useState(blank);const [origins,setOrigins]=useState('');const [variables,setVariables]=useState('');
 const [secretName,setSecretName]=useState('');const [secretValue,setSecretValue]=useState('');const [available,setAvailable]=useState<string[]>([]);
 const [preflight,setPreflight]=useState<EnvironmentSnapshot|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const scope=useRef(0);const errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{const generation=++scope.current;setProfiles([]);setDraft(blank());setEditing(undefined);setOrigins('');setVariables('');setSecretName('');setSecretValue('');setError('');setPreflight(null);setNotice('');setBusy(false);
  void api.dynamicEnvironments(projectId).then(rows=>{if(generation===scope.current)setProfiles(rows);}).catch(e=>{if(generation===scope.current)setError(userFacingError(e,'Environments could not be loaded.'));});
  return()=>{scope.current++;};
 },[projectId]);
 useEffect(()=>{let current=true;setAvailable([]);setPreflight(null);setSecretValue('');
  if(value)void api.dynamicEnvironmentValues(projectId,value).then(result=>{if(current)setAvailable(result.variableNames);}).catch(e=>{if(current)setError(userFacingError(e));});
  return()=>{current=false;};
 },[projectId,value]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 const edit=(profile?:EnvironmentProfile)=>{setDraft(profile??blank());setEditing(profile?.id);setOrigins(profile?.allowedOrigins.join('\n')??'');setVariables(profile?.requiredVariables.join('\n')??'');setError('');setNotice('');};
 const save=async(event:React.FormEvent)=>{event.preventDefault();const generation=scope.current;setBusy(true);setError('');try{
  const allowedOrigins=origins.trim()?origins.split(/\s+/).filter(Boolean):[new URL(draft.targetUrl).origin];
  const profile=await api.saveDynamicEnvironment(projectId,{...draft,allowedOrigins,requiredVariables:variables.split(/[\s,]+/).filter(Boolean)},editing);
  if(generation!==scope.current)return;
  setProfiles(previous=>[profile,...previous.filter(item=>item.id!==profile.id)]);edit(profile);onChange(profile.id);setNotice(`Environment version ${profile.version} saved. Run conditions will be frozen at start.`);
 }catch(e){if(generation===scope.current)setError(userFacingError(e,'Environment could not be saved.'));}finally{if(generation===scope.current)setBusy(false);}};
 const saveValue=async(event:React.FormEvent)=>{event.preventDefault();const generation=scope.current;setBusy(true);setError('');try{const result=await api.saveDynamicEnvironmentValues(projectId,value,{[secretName]:secretValue});if(generation!==scope.current)return;setAvailable(result.variableNames);setSecretValue('');setPreflight(null);setNotice('Local value saved. Its content is not returned or sent to the model.');}catch(e){if(generation===scope.current)setError(userFacingError(e));}finally{if(generation===scope.current)setBusy(false);}};
 return <section className="dw-environments" aria-labelledby="dw-env-title">
  <div className="dw-field"><label id="dw-env-title" htmlFor="dw-environment">Run environment</label><Select id="dw-environment" disabled={disabled||busy} value={value||'test-address'} options={[{value:'test-address',label:'Use test address (no saved environment)'},...profiles.map(profile=>({value:profile.id,label:`${profile.name} · v${profile.version}`}))]} onChange={id=>onChange(id==='test-address'?'':id)}/></div>
  {error&&<p ref={errorRef} className="dw-error" role="alert" tabIndex={-1}>{error}</p>}
  {notice&&<p className="dw-feedback" role="status">{notice}</p>}
  <details className="dw-advanced"><summary>Manage environments and local values</summary>
   <p className="dw-muted">Profiles are shared with project members. Values are encrypted on this device for your account. They are prerequisites only; browser credential injection is configured separately.</p>
   <div className="dw-actions"><button type="button" className="btn-secondary" disabled={disabled||busy} onClick={()=>edit()}>New environment</button>{value&&<button type="button" className="btn-secondary" disabled={disabled||busy} onClick={()=>edit(profiles.find(profile=>profile.id===value))}>Edit selected environment</button>}</div>
   <form onSubmit={save}><fieldset className="dw-form-body" disabled={disabled||busy}>
    <div className="dw-check-fields"><div className="dw-field"><label htmlFor="dw-env-name">Environment name</label><input id="dw-env-name" required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></div><div className="dw-field"><label htmlFor="dw-env-url">Environment website</label><input id="dw-env-url" required type="url" value={draft.targetUrl} onChange={e=>setDraft({...draft,targetUrl:e.target.value})}/></div></div>
    <div className="dw-check-fields"><div className="dw-field"><label htmlFor="dw-env-origins">Allowed origins (one per line)</label><textarea id="dw-env-origins" rows={2} value={origins} onChange={e=>setOrigins(e.target.value)} placeholder="Defaults to this website's origin"/></div><div className="dw-field"><label htmlFor="dw-env-vars">Required variable names</label><textarea id="dw-env-vars" rows={2} value={variables} onChange={e=>setVariables(e.target.value)} placeholder="TEST_USERNAME&#10;TEST_PASSWORD"/></div></div>
    <div className="dw-check-fields"><div className="dw-field"><label htmlFor="dw-env-role">Account role / preparation note</label><input id="dw-env-role" value={draft.accountRole} onChange={e=>setDraft({...draft,accountRole:e.target.value})}/></div><div className="dw-field"><label htmlFor="dw-env-version">Target version or commit</label><input id="dw-env-version" value={draft.targetVersion} onChange={e=>setDraft({...draft,targetVersion:e.target.value})}/></div></div>
    <div className="dw-check-fields"><div className="dw-field"><label htmlFor="dw-env-width">Browser width</label><input id="dw-env-width" type="number" required min={320} max={3840} value={draft.viewport.width} onChange={e=>setDraft({...draft,viewport:{...draft.viewport,width:Number(e.target.value)}})}/></div><div className="dw-field"><label htmlFor="dw-env-height">Browser height</label><input id="dw-env-height" type="number" required min={320} max={2160} value={draft.viewport.height} onChange={e=>setDraft({...draft,viewport:{...draft.viewport,height:Number(e.target.value)}})}/></div></div>
    <div className="dw-field"><label htmlFor="dw-env-startup">Local startup instructions</label><textarea id="dw-env-startup" rows={2} value={draft.startupInstructions} onChange={e=>setDraft({...draft,startupInstructions:e.target.value})}/></div><p className="dw-muted">Keep values and passwords out of shared profile fields. Instructions are shown for manual use; no command runs automatically.</p>
    <button type="submit" className="btn-secondary">Save environment</button>
   </fieldset></form>
   {value&&<><form onSubmit={saveValue}><fieldset className="dw-form-body" disabled={disabled||busy}><h3>Local variables</h3><p className="dw-muted">Available names: {available.join(', ')||'None on this device'}. Submit an empty value to remove a name.</p><div className="dw-check-fields"><div className="dw-field"><label htmlFor="dw-secret-name">Variable name</label><input id="dw-secret-name" required pattern="[A-Z][A-Z0-9_]{0,63}" value={secretName} onChange={e=>setSecretName(e.target.value)}/></div><div className="dw-field"><label htmlFor="dw-secret-value">Local value</label><input id="dw-secret-value" type="password" autoComplete="off" value={secretValue} onChange={e=>setSecretValue(e.target.value)}/></div></div><button type="submit" className="btn-secondary">Save local value</button></fieldset></form>
    <div className="dw-actions"><button type="button" className="btn-secondary" disabled={disabled||busy} onClick={()=>{const generation=scope.current;setBusy(true);setError('');void api.preflightDynamicEnvironment(projectId,value).then(result=>{if(generation===scope.current)setPreflight(result);}).catch(e=>{if(generation===scope.current)setError(userFacingError(e));}).finally(()=>{if(generation===scope.current)setBusy(false);});}}>Check environment</button></div>
   </>}
  </details>
  {preflight&&<div className="dw-notice"><strong>Environment preflight</strong><ul>{preflight.preflight.map(check=><li key={check.name}>{check.name}: {check.ready?'Ready':'Needs attention'} — {check.reason}</li>)}</ul>{preflight.startupInstructions&&<p>{preflight.startupInstructions}</p>}</div>}
 </section>;
}
