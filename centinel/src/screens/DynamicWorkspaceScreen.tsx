import {DynamicRegressionPanel} from './DynamicRegressionPanel';
import {DynamicExplorationPanel} from './DynamicExplorationPanel';
import {checkToDraft,draftToCheck,isBooleanFormCheck,type DraftCheck} from '../dynamic/checkDraft';
import {DynamicFormExpectation} from './DynamicFormExpectation';
import { DynamicEnvironmentPanel } from './DynamicEnvironmentPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FileCheck2, Globe, History, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Select } from '../components/Select';
import type { Project, Screen } from '../types';
import type { CheckDefinition, DynamicRun, MissionRevision } from '../dynamic/types';
import {createStaticContextStub,type IncomingContextSource,type StaticContextFixture,type StubScenario} from '../../../sidecar/src/dynamic/testing/staticContextStub';
import {validateIncomingContext,contextNeedsAcknowledgment} from '../../../sidecar/src/dynamic/context';
import type {CriterionExclusion} from '../../../sidecar/src/dynamic/types';
import {DynamicContextPanel} from './DynamicContextPanel';
import {DynamicCoveragePanel} from './DynamicCoveragePanel';
import { userFacingError } from '../utils/userFacingError';
import './DynamicWorkspaceScreen.css';

type Props = {incomingContextSource?(scenario:StubScenario):IncomingContextSource; projects: Project[]; initialProjectId?: string; initialRunId?: string; onNavigate(screen: Screen): void };
const key = () => crypto.randomUUID();
const emptyCheck = (): DraftCheck => ({ id: key(), criterionId: '', description: '', kind: 'visible_text', value: '', formExpected:'',includeEmptyOption:false,required: true });
const stateLabel = (run: DynamicRun) => ({ queued: 'Queued', running: 'In progress', completed: 'Completed', blocked: 'Needs attention', interrupted: 'Needs attention', cancelled: 'Cancelled' }[run.state]);
const verdictLabel = (value: string) => ({ passed: 'Passed', failed: 'Failed', uncertain: 'Uncertain', not_tested: 'Not tested' }[value] ?? value);
const dateLabel = (value: string) => new Date(value).toLocaleString();
const active = (run: DynamicRun) => ['queued', 'running'].includes(run.state);

function RunScreenshot({ projectId, run }: { projectId: string; run: DynamicRun }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('Loading local evidence…');
  const evidenceKey = run.evidence.map(item => item.id + item.sha256).join(':');
  useEffect(() => {
    let current = true; let objectUrl: string | null = null;
    setUrl(null); setMessage('Loading local evidence…');
    if (!run.legacySessionId) { setMessage('No local screenshot was recorded.'); return; }
    void api.listDynamicEvidence(projectId, run.legacySessionId).then(async evidence => {
      const screenshot = evidence.find(item => item.type === 'screenshot' && run.evidence.some(ref => ref.id === item.id));
      if (!screenshot) throw new Error('Local evidence unavailable');
      const blob = await api.dynamicEvidenceBlob(screenshot.filePath);
      if (!current) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (current) setMessage('Screenshot unavailable on this device. Run metadata remains available.'); });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, run.id, run.legacySessionId, evidenceKey]);
  return url ? <img className="dw-screenshot" src={url} alt="Page captured for the selected run's independent checks" /> : <p className="dw-muted">{message}</p>;
}

export function DynamicWorkspaceScreen({ projects, initialProjectId, initialRunId, onNavigate,incomingContextSource=createStaticContextStub }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [revisions, setRevisions] = useState<MissionRevision[]>([]);
  const [runs, setRuns] = useState<DynamicRun[]>([]);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(initialRunId ?? '');
  const [name, setName] = useState(''); const [goal, setGoal] = useState(''); const [targetUrl, setTargetUrl] = useState('');
  const [environmentDataBusy,setEnvironmentDataBusy]=useState(false);
  const [environmentId, setEnvironmentId] = useState('');
  const [mode,setMode]=useState<'guided'|'exploratory'>('guided');
  const [maxSteps, setMaxSteps] = useState(15);
  const [draftContext,setDraftContext]=useState<StaticContextFixture|null>(null);
  const [contextScenario,setContextScenario]=useState('normal');
  const [contextAcknowledged,setContextAcknowledged]=useState(false);
  const [criterionExclusions,setCriterionExclusions]=useState<CriterionExclusion[]>([]);
  const [contextLoading,setContextLoading]=useState(false);const contextSequence=useRef(0);
  const [source, setSource] = useState('manual'); const [checks, setChecks] = useState<DraftCheck[]>(() => [emptyCheck()]);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [feedback, setFeedback] = useState('');
  const requestKey = useRef<{ revisionId: string; environmentId: string; baselineRunId?:string;key: string } | null>(null);
  const loadGeneration = useRef(0); const loadSequence = useRef(0); const errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const selectedRun = runs.find(run => run.id === selectedRunId);
  const selectedRevision = revisions.find(revision => revision.missionId === missionId);
  const activeRun = runs.find(active);
  const criteria=draftContext?.requirements.flatMap(requirement=>requirement.criteria)??[];

  const resetDraft = useCallback(() => { setMissionId(null);setMode('guided'); setName(''); setGoal(''); setTargetUrl(''); setMaxSteps(15); setSource('manual');contextSequence.current++;setContextLoading(false);setDraftContext(null);setContextScenario('normal');setContextAcknowledged(false);setCriterionExclusions([]); setChecks([emptyCheck()]); dirty.current = false; setFeedback(''); }, []);
  const load = useCallback(async () => {
    if (!projectId) return;
    const generation = loadGeneration.current; const sequence = ++loadSequence.current;
    const [missions, history] = await Promise.all([api.dynamicMissions(projectId), api.dynamicRuns(projectId)]);
    const latest = await Promise.all(missions.map(mission => api.dynamicRevision(projectId, mission.currentRevisionId)));
    if (generation !== loadGeneration.current || sequence !== loadSequence.current) return;
    setRevisions(latest); setRuns(history);
  }, [projectId]);
  useEffect(() => {
    loadGeneration.current++; let current = true;
    resetDraft();setBusy(false);requestKey.current=null; setEnvironmentId(''); setRuns([]); setRevisions([]); setSelectedRunId(initialRunId ?? ''); setError(null);
    setLoading(Boolean(projectId));
    void load().catch(e => { if (current) setError(userFacingError(e, 'Saved tests could not be loaded.')); }).finally(() => { if (current) setLoading(false); });
    const timer = window.setInterval(() => { void load().catch(e => { if (current) setError(userFacingError(e, 'Run history could not be refreshed.')); }); }, 5000);
    return () => { current = false; loadGeneration.current++; window.clearInterval(timer); };
  }, [projectId, load, resetDraft]);
  useEffect(() => { if (initialProjectId && initialProjectId !== projectId) setProjectId(initialProjectId); }, [initialProjectId]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (initialRunId) setSelectedRunId(initialRunId); }, [initialRunId]);
  useEffect(() => {
    if (!selectedRunId) return;
    const frame = requestAnimationFrame(() => resultRef.current?.scrollIntoView?.({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedRunId, Boolean(selectedRun)]);

  const edit = (revision: MissionRevision) => {
    setSelectedRunId('');
    onNavigate({ name: 'dynamic-testing', projectId });
    setMissionId(revision.missionId);setMode(revision.mode??'guided'); setName(revision.name); setGoal(revision.goal); setTargetUrl(revision.targetUrl); setMaxSteps(revision.maxSteps);
    contextSequence.current++;setContextLoading(false);setContextScenario('recorded');setContextAcknowledged(revision.contextAcknowledged);setCriterionExclusions(revision.criterionExclusions??[]);
    try{setDraftContext(validateIncomingContext(revision.context,projectId));}catch{setDraftContext(null);}
    setSource(revision.context ? 'mock' : 'manual');
    setChecks(revision.checks.map(checkToDraft));
    dirty.current = false; setFeedback(`Loaded revision ${revision.revision}. Saving edits creates a new revision.`); setError(null);
  };
  const loadContext=async(scenario:StubScenario)=>{
    const generation=loadGeneration.current;const sequence=++contextSequence.current;setContextLoading(true);setError(null);
    try{const loaded=validateIncomingContext(await incomingContextSource(scenario).load(projectId),projectId);if(generation!==loadGeneration.current||sequence!==contextSequence.current)return;
      setDraftContext(loaded);setContextScenario(scenario);setContextAcknowledged(false);setCriterionExclusions([]);dirty.current=true;
    }catch(error){if(generation===loadGeneration.current&&sequence===contextSequence.current)setError(userFacingError(error,'Incoming mock context could not be loaded. No replacement snapshot was generated.'));}
    finally{if(generation===loadGeneration.current&&sequence===contextSequence.current)setContextLoading(false);}
  };
  const change = (id: string, patch: Partial<DraftCheck>) => { dirty.current = true; setChecks(previous => previous.map(check => check.id === id ? { ...check, ...patch } : check)); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();const generation=loadGeneration.current; setBusy(true); setError(null); setFeedback('');
    try {
      if(source==='mock'&&(!draftContext||(contextNeedsAcknowledgment(draftContext)&&!contextAcknowledged)))throw new Error('Load and acknowledge the incoming mock snapshot, or choose manual criteria.');
      const definitions=checks.map(check=>draftToCheck(check,source==='mock'?check.criterionId:`manual-${check.id}`));
      const revision = await api.saveDynamicMission(projectId, { mode,name, goal, targetUrl, maxSteps, checks: definitions, context:source==='mock'?draftContext:null,contextAcknowledged:source==='mock'&&contextAcknowledged,criterionExclusions:source==='mock'?criterionExclusions:[] }, missionId ?? undefined);
      if(generation!==loadGeneration.current)return;await load();if(generation!==loadGeneration.current)return; edit(revision); setFeedback(`Saved revision ${revision.revision}. Ready to run.`);
    } catch (e) { if(generation===loadGeneration.current)setError(userFacingError(e, 'The test could not be saved. Your inputs are preserved.')); }
    finally { if(generation===loadGeneration.current)setBusy(false); }
  };
  const start = async (revision: MissionRevision, selectedEnvironment = environmentId,baselineRunId?:string) => {
    const generation=loadGeneration.current;setBusy(true); setError(null);
    if (!requestKey.current || requestKey.current.revisionId !== revision.id || requestKey.current.environmentId !== selectedEnvironment||requestKey.current.baselineRunId!==baselineRunId) requestKey.current = { revisionId: revision.id, environmentId: selectedEnvironment,baselineRunId,key: key() };
    try {
      const run=baselineRunId?await api.startDynamicRun(projectId,revision.id,requestKey.current.key,selectedEnvironment||undefined,baselineRunId):selectedEnvironment?await api.startDynamicRun(projectId,revision.id,requestKey.current.key,selectedEnvironment):await api.startDynamicRun(projectId,revision.id,requestKey.current.key);
      if(generation!==loadGeneration.current)return;requestKey.current = null; setSelectedRunId(run.id); await load();if(generation!==loadGeneration.current)return;
      onNavigate({ name: 'dynamic-testing', projectId, runId: run.id });
    } catch (e) { if(generation===loadGeneration.current)setError(userFacingError(e, 'The run could not start. Retry uses the same request.')); }
    finally { if(generation===loadGeneration.current)setBusy(false); }
  };
  const stop = async (run: DynamicRun) => { const generation=loadGeneration.current;setBusy(true); setError(null); try { await api.stopDynamicRun(projectId, run.id);if(generation!==loadGeneration.current)return; await load(); } catch (e) { if(generation===loadGeneration.current)setError(userFacingError(e, 'The run could not be stopped. Refresh to inspect its state.')); } finally { if(generation===loadGeneration.current)setBusy(false); } };

  return <div className="dynamic-workspace-screen">
    <header className="command-page-header"><div><span className="dw-eyebrow">Browser validation</span><h1>Dynamic testing</h1><p>Save a test, run it again, and inspect the evidence behind each result.</p></div></header>
    <div className="dw-toolbar"><div><label htmlFor="dw-project">Project</label><Select id="dw-project" value={projectId} disabled={busy} options={projects.map(project => ({ value: project.id, label: project.name }))} onChange={value => { requestKey.current = null; setProjectId(value); onNavigate({ name: 'dynamic-testing', projectId: value }); }} /></div><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'projects', initialCreate: true })}><Plus size={16} /> Create project</button></div>
    {error && <p className="dw-error" role="alert" tabIndex={-1} ref={errorRef}>{error} <button type="button" onClick={() => { setError(null); void load().catch(e => setError(userFacingError(e))); }}>Refresh</button></p>}
    {!projectId ? <p className="dw-empty">Create or select a project to save your first browser test.</p> : <>
      <DynamicEnvironmentPanel projectId={projectId} value={environmentId} disabled={busy} onDataBusy={setEnvironmentDataBusy} onChange={id=>{requestKey.current=null;setEnvironmentId(id);}} />
      <div className="dw-grid">
        <section className="dw-editor" aria-labelledby="dw-editor-title">
          <div className="dw-section-heading"><div><h2 id="dw-editor-title">{missionId ? 'Edit saved test' : 'New test'}</h2><p>Required checks verify the result independently of the browser agent.</p></div>{missionId && <button type="button" className="btn-secondary" onClick={resetDraft} disabled={busy}><Plus size={16} /> New test</button>}</div>
          <form onSubmit={save}><fieldset className="dw-form-body" disabled={busy || loading || contextLoading}>
            <div className="dw-field"><label htmlFor="dw-name">Test name</label><input id="dw-name" required maxLength={120} value={name} onChange={e => { dirty.current = true; setName(e.target.value); }} placeholder="Sign-in page smoke test" /></div>
            <div className="dw-field"><label htmlFor="dw-url"><Globe size={16} /> Website address</label><input id="dw-url" required type="url" value={targetUrl} onChange={e => { dirty.current = true; setTargetUrl(e.target.value); }} placeholder="http://localhost:3000" /></div>
            <div className="dw-field"><label htmlFor="dw-goal">Test goal</label><textarea id="dw-goal" required rows={3} value={goal} onChange={e => { dirty.current = true; setGoal(e.target.value); }} placeholder="Describe what the browser should do and verify." /></div>
            <div className="dw-field"><label htmlFor="dw-mode">Testing mode</label><Select id="dw-mode" value={mode} options={[{value:'guided',label:'Guided task'},{value:'exploratory',label:'Bounded exploration'}]} onChange={value=>{dirty.current=true;setMode(value as 'guided'|'exploratory');}}/>{mode==='exploratory'&&<p className="dw-muted">Explore the selected objectives within the recorded action rules and limits. Visited states and unvisited observed controls are recorded; this does not establish complete website coverage.</p>}</div>
            <div className="dw-field"><label htmlFor="dw-source">Criteria source</label><Select id="dw-source" value={source} options={[{ value: 'manual', label: 'Write my own criteria' }, { value: 'mock', label: 'Example requirements (mock)' }]} onChange={value=>{dirty.current=true;setSource(value);if(value==='mock'&&!draftContext)void loadContext('normal');if(value==='manual'){contextSequence.current++;setContextLoading(false);}}} /></div>
            {source==='mock'&&<DynamicContextPanel context={draftContext} scenario={contextScenario} onScenario={scenario=>void loadContext(scenario)} acknowledged={contextAcknowledged} onAcknowledgment={value=>{dirty.current=true;setContextAcknowledged(value);}} exclusions={criterionExclusions} onExclusions={value=>{dirty.current=true;setCriterionExclusions(value);}} selectedCriteria={checks.map(check=>check.criterionId)}/>}
            <fieldset className="dw-checks"><legend><FileCheck2 size={16} /> Acceptance checks</legend>
              {checks.map((check, index) => <div className="dw-check" key={check.id}>
                <div className="dw-check-top"><strong>Check {index + 1}</strong><button type="button" aria-label={`Remove check ${index + 1}`} disabled={checks.length === 1 || busy} onClick={() => { dirty.current = true; setChecks(previous => previous.filter(item => item.id !== check.id)); }}><Trash2 size={16} /></button></div>
                {source === 'mock' && <div className="dw-field"><label htmlFor={`dw-criterion-${check.id}`}>Requirement criterion</label><Select id={`dw-criterion-${check.id}`} value={check.criterionId} required placeholder="Select a criterion" options={criteria.map(criterion => ({ value: criterion.id, label: criterion.description,disabled:criterionExclusions.some(item=>item.criterionId===criterion.id) }))} onChange={value=>{const criterion=criteria.find(item=>item.id===value);change(check.id,{criterionId:value,description:check.description||criterion?.description||''});if(criterion&&!goal.trim())setGoal(criterion.description);if(criterion&&!name.trim())setName(criterion.description.slice(0,120));}} /></div>}
                <div className="dw-check-fields"><div className="dw-field"><label htmlFor={`dw-kind-${check.id}`}>Verify</label><Select id={`dw-kind-${check.id}`} value={check.kind} options={[{ value: 'visible_text', label: 'Visible text' }, { value: 'url', label: 'Page address' }, { value: 'element_visible', label: 'Visible element (CSS selector)' },{value:'field_value',label:'Field value'},{value:'field_checked',label:'Checked state'},{value:'field_enabled',label:'Enabled state'},{value:'field_valid',label:'Native field validity'},{value:'selected_values',label:'Selected option values'}]} onChange={value => change(check.id, { kind: value as CheckDefinition['kind'],formExpected:isBooleanFormCheck(value as CheckDefinition['kind'])?'true':'',includeEmptyOption:false })} /></div>
                  <div className="dw-field"><label htmlFor={`dw-value-${check.id}`}>{check.kind === 'url' ? 'Expected page address' : check.kind === 'visible_text' ? 'Expected visible text' : 'CSS selector'}</label><input id={`dw-value-${check.id}`} required value={check.value} onChange={e => change(check.id, { value: e.target.value })} placeholder={check.kind === 'url' ? 'http://localhost:3000/signin' : check.kind === 'visible_text' ? 'Sign in' : 'input[name="username"]'} /></div></div>
                <DynamicFormExpectation check={check} onChange={patch=>change(check.id,patch)}/>
                <label className="dw-required"><input type="checkbox" checked={check.required} onChange={e => change(check.id, { required: e.target.checked })} /> Required for a passing result</label>
              </div>)}
              <button type="button" className="btn-secondary" disabled={checks.length >= 20 || busy} onClick={() => { dirty.current = true; setChecks(previous => [...previous, emptyCheck()]); }}><Plus size={16} /> Add check</button>
            </fieldset>
            <details className="dw-advanced"><summary>Advanced options</summary><div className="dw-field"><label htmlFor="dw-steps">Step limit</label><input id="dw-steps" type="number" min={1} max={25} value={maxSteps} onChange={e => { dirty.current = true; setMaxSteps(Number(e.target.value)); }} /></div></details>
            <div className="dw-actions"><button type="submit" className="btn-primary" disabled={busy||loading||contextLoading||(source==='mock'&&(!draftContext||(contextNeedsAcknowledgment(draftContext)&&!contextAcknowledged)))}>{busy ? 'Working…' : 'Save test'}</button>{selectedRevision && <button type="button" className="btn-secondary" disabled={busy || environmentDataBusy || Boolean(activeRun) || dirty.current} onClick={() => void start(selectedRevision)}>Run saved test</button>}</div>
            {feedback && <p role="status" className="dw-feedback"><CheckCircle2 size={16} /> {feedback}</p>}
            {missionId && dirty.current && <p className="dw-muted">Save your changes before running this revision.</p>}
            {activeRun && <p className="dw-muted">A test is already active in this project. Stop it or wait before starting another.</p>}
          </fieldset></form>
        </section>
        <aside className="dw-history" aria-labelledby="dw-history-title">
          <div className="dw-section-heading"><h2 id="dw-history-title"><History size={18} /> Saved tests & runs</h2><button type="button" className="dw-icon-button" aria-label="Refresh test history" disabled={busy} onClick={() => { void load().catch(e => setError(userFacingError(e))); }}><RefreshCw size={16} /></button></div>
          {loading && <p role="status" className="dw-muted">Loading saved tests…</p>}
          <h3>Saved tests</h3>
          {!loading && !revisions.length && <p className="dw-muted">Your saved tests will appear here.</p>}
          <div className="dw-saved-list">{revisions.map(revision => <button type="button" className={missionId === revision.missionId ? 'selected' : ''} key={revision.id} disabled={busy} onClick={() => edit(revision)}><strong>{revision.name}</strong><span>Revision {revision.revision} · {revision.checks.length} checks</span></button>)}</div>
          <h3>Run history</h3>
          {!loading && !runs.length && <p className="dw-muted">Run a saved test to begin its history.</p>}
          <div className="dw-run-list">{runs.map(run => <button type="button" key={run.id} className={selectedRunId === run.id ? 'selected' : ''} onClick={() => { setSelectedRunId(run.id); onNavigate({ name: 'dynamic-testing', projectId, runId: run.id }); }}><strong>{run.revision.name}</strong><span className="dw-run-outcome"><span>{stateLabel(run)}</span><span className={`dw-verdict dw-${run.verdict}`}>{verdictLabel(run.verdict)}</span></span><small>Revision {run.revision.revision} · {dateLabel(run.createdAt)}</small></button>)}</div>
        </aside>
      </div>
      {selectedRun && <section ref={resultRef} className="dw-result" aria-labelledby="dw-result-title">
        <div className="dw-section-heading"><div><span className="dw-eyebrow">Selected run · revision {selectedRun.revision.revision}</span><h2 id="dw-result-title">{selectedRun.revision.name}</h2><p><Clock3 size={14} /> {dateLabel(selectedRun.createdAt)} · {stateLabel(selectedRun)}</p></div>{active(selectedRun) ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void stop(selectedRun)}><Square size={16} /> Stop run</button> : <button type="button" className="btn-secondary" disabled={busy || environmentDataBusy || Boolean(activeRun)} onClick={() => void start(selectedRun.revision, selectedRun.environment?.id ?? environmentId)}>Run this revision again</button>}</div>
        <p className={`dw-result-verdict dw-${selectedRun.verdict}`}>{verdictLabel(selectedRun.verdict)}</p>
        {selectedRun.reason && <p className="dw-notice">{selectedRun.reason}</p>}
        {selectedRun.state === 'interrupted' && <p className="dw-muted">Execution was not resumed automatically. Check the test data before running again.</p>}
        {revisions.some(revision => revision.missionId === selectedRun.missionId && revision.id !== selectedRun.revision.id) && <p className="dw-notice">This result belongs to an earlier revision and does not validate the current test.</p>}
        {selectedRun.revision.context && <p className="dw-muted">Criteria source: example requirements (mock). Browser observations are recorded separately.</p>}
        <DynamicCoveragePanel run={selectedRun}/>
        <details className="dw-advanced"><summary>Recorded browser permissions</summary>{selectedRun.actionPolicy?<><p>{selectedRun.actionPolicy.interactions.length} approved controls · Coordinates {selectedRun.actionPolicy.allowCoordinates?'enabled for approved controls':'disabled'}</p>{selectedRun.actionPolicy.interactions.length>0&&<ul className="dw-recorded-permissions">{selectedRun.actionPolicy.interactions.map(grant=><li key={grant.selector}><code>{grant.selector}</code> · {grant.actions.join(', ')}{grant.actions.includes('click')?(grant.repeatable?' · repeatable click approved':' · click repetition not approved'):''}</li>)}</ul>}<p>File controls, downloads and implicit keyboard submissions are not approved by these grants.</p></>:<p>Permissions were not recorded for this historical Run. Current environment settings do not establish its original conditions.</p>}{selectedRun.executionVersions&&<p>Engine versions: observer {selectedRun.executionVersions.observer} · planner {selectedRun.executionVersions.planner} · policy {selectedRun.executionVersions.policy} · executor {selectedRun.executionVersions.executor} · checker {selectedRun.executionVersions.checker}</p>}</details>
        <DynamicRegressionPanel run={selectedRun}/>
        {selectedRun.state==='completed'&&selectedRun.checks.length>0&&selectedRun.evidence.length>0&&<div className="dw-actions"><button type="button" className="btn-secondary" disabled={busy||environmentDataBusy||Boolean(activeRun)} onClick={()=>void start(selectedRun.revision,environmentId||selectedRun.environment?.id||'',selectedRun.id)}>Retest from this baseline</button><p className="dw-muted">Pins this Run's original test revision. Uses the selected environment or the baseline profile's current configuration; preparation and your local session are checked again. Private values are not copied.</p></div>}
        <DynamicExplorationPanel run={selectedRun}/>
        {selectedRun.executionBudget&&<details className="dw-advanced"><summary>Recorded execution limits</summary><p>{selectedRun.executionBudget.runtimeMs/1000} seconds · {selectedRun.executionBudget.maxSteps} steps · {selectedRun.executionBudget.maxModelCalls} model calls</p><p>Page observation: {selectedRun.executionBudget.maxObservationChars} characters · Console: {selectedRun.executionBudget.maxConsoleBytes} bytes</p><p>Accounted-token stop limit: {selectedRun.executionBudget.maxAccountedTokens??'Not set'}. Provider usage is checked after each request; this is not a billing cap.</p></details>}
        {selectedRun.environment && <details className="dw-advanced"><summary>Recorded environment · {selectedRun.environment.name} v{selectedRun.environment.version}</summary><p>{selectedRun.environment.targetUrl} · {selectedRun.environment.viewport.width}×{selectedRun.environment.viewport.height} · Target version: {selectedRun.environment.targetVersion || 'Not recorded'}</p>{selectedRun.environment.preparation&&<p>Recorded preparation: {selectedRun.environment.preparation.note} · profile v{selectedRun.environment.preparation.profileVersion}</p>}<p>Required names: {selectedRun.environment.requiredVariables.join(', ') || 'None'}. Values remain local and are not part of this record.</p><ul>{selectedRun.environment.preflight.map(check=><li key={check.name}>{check.name}: {check.ready?'Ready':'Needs attention'} — {check.reason}</li>)}</ul></details>}
        <div className="dw-table-scroll"><table><caption>Independent check results</caption><thead><tr><th>Check</th><th>Result</th><th>Observation</th></tr></thead><tbody>{selectedRun.revision.checks.map(check => { const result = selectedRun.checks.find(item => item.checkId === check.id); return <tr key={check.id}><th scope="row">{check.description}</th><td><span className={`dw-verdict dw-${result?.verdict ?? 'not_tested'}`}>{verdictLabel(result?.verdict ?? 'not_tested')}</span></td><td>{result?.observed || result?.reason || 'No observation recorded.'}</td></tr>; })}</tbody></table></div>
        {selectedRun.evidence.length > 0 && <details className="dw-evidence"><summary>Screenshot evidence · local to the executing device</summary><RunScreenshot projectId={projectId} run={selectedRun} /></details>}
        <details className="dw-advanced"><summary>Run details</summary><dl><dt>Run ID</dt><dd>{selectedRun.id}</dd><dt>Started by</dt><dd>{selectedRun.createdBy}</dd><dt>Website</dt><dd>{selectedRun.revision.targetUrl}</dd><dt>Test goal</dt><dd>{selectedRun.revision.goal}</dd><dt>Last worker activity</dt><dd>{selectedRun.lease?.heartbeatAt ? dateLabel(selectedRun.lease.heartbeatAt) : 'Unavailable'}</dd></dl></details>
      </section>}
    </>}
  </div>;
}
