import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FileCheck2, Globe, History, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Select } from '../components/Select';
import type { Project, Screen } from '../types';
import type { CheckDefinition, DynamicRun, MissionRevision } from '../dynamic/types';
import { createStaticContextFixture } from '../../../sidecar/src/dynamic/testing/staticContextStub';
import { userFacingError } from '../utils/userFacingError';
import './DynamicWorkspaceScreen.css';

type Props = { projects: Project[]; initialProjectId?: string; initialRunId?: string; onNavigate(screen: Screen): void };
type DraftCheck = { id: string; criterionId: string; description: string; kind: CheckDefinition['kind']; value: string; required: boolean };
const key = () => crypto.randomUUID();
const emptyCheck = (): DraftCheck => ({ id: key(), criterionId: '', description: '', kind: 'visible_text', value: '', required: true });
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

export function DynamicWorkspaceScreen({ projects, initialProjectId, initialRunId, onNavigate }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [revisions, setRevisions] = useState<MissionRevision[]>([]);
  const [runs, setRuns] = useState<DynamicRun[]>([]);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(initialRunId ?? '');
  const [name, setName] = useState(''); const [goal, setGoal] = useState(''); const [targetUrl, setTargetUrl] = useState('');
  const [maxSteps, setMaxSteps] = useState(15);
  const [source, setSource] = useState('manual'); const [checks, setChecks] = useState<DraftCheck[]>(() => [emptyCheck()]);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [feedback, setFeedback] = useState('');
  const requestKey = useRef<{ revisionId: string; key: string } | null>(null);
  const loadGeneration = useRef(0); const loadSequence = useRef(0); const errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const selectedRun = runs.find(run => run.id === selectedRunId);
  const selectedRevision = revisions.find(revision => revision.missionId === missionId);
  const activeRun = runs.find(active);
  const mock = projectId ? createStaticContextFixture(projectId)! : null;
  const criteria = mock?.requirements.flatMap(requirement => requirement.criteria) ?? [];

  const resetDraft = useCallback(() => { setMissionId(null); setName(''); setGoal(''); setTargetUrl(''); setMaxSteps(15); setSource('manual'); setChecks([emptyCheck()]); dirty.current = false; setFeedback(''); }, []);
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
    resetDraft(); setRuns([]); setRevisions([]); setSelectedRunId(initialRunId ?? ''); setError(null);
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
    setMissionId(revision.missionId); setName(revision.name); setGoal(revision.goal); setTargetUrl(revision.targetUrl); setMaxSteps(revision.maxSteps);
    setSource(revision.context ? 'mock' : 'manual');
    setChecks(revision.checks.map(check => ({ id: check.id, criterionId: check.criterionId, description: check.description, kind: check.kind, value: check.kind === 'element_visible' ? check.selector : check.expected, required: check.required })));
    dirty.current = false; setFeedback(`Loaded revision ${revision.revision}. Saving edits creates a new revision.`); setError(null);
  };
  const change = (id: string, patch: Partial<DraftCheck>) => { dirty.current = true; setChecks(previous => previous.map(check => check.id === id ? { ...check, ...patch } : check)); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setFeedback('');
    try {
      const definitions: CheckDefinition[] = checks.map(check => ({ id: check.id, criterionId: source === 'mock' ? check.criterionId : `manual-${check.id}`, description: check.description.trim() || (check.kind === 'url' ? 'Expected page address' : check.kind === 'visible_text' ? 'Expected visible text' : 'Expected visible element'), required: check.required,
        ...(check.kind === 'element_visible' ? { kind: check.kind, selector: check.value.trim() } : { kind: check.kind, expected: check.value.trim() }) }));
      const revision = await api.saveDynamicMission(projectId, { name, goal, targetUrl, maxSteps, checks: definitions, context: source === 'mock' ? selectedRevision?.context ?? mock : null, contextAcknowledged: selectedRevision?.contextAcknowledged ?? false }, missionId ?? undefined);
      await load(); edit(revision); setFeedback(`Saved revision ${revision.revision}. Ready to run.`);
    } catch (e) { setError(userFacingError(e, 'The test could not be saved. Your inputs are preserved.')); }
    finally { setBusy(false); }
  };
  const start = async (revision: MissionRevision) => {
    setBusy(true); setError(null);
    if (!requestKey.current || requestKey.current.revisionId !== revision.id) requestKey.current = { revisionId: revision.id, key: key() };
    try {
      const run = await api.startDynamicRun(projectId, revision.id, requestKey.current.key);
      requestKey.current = null; setSelectedRunId(run.id); await load();
      onNavigate({ name: 'dynamic-testing', projectId, runId: run.id });
    } catch (e) { setError(userFacingError(e, 'The run could not start. Retry uses the same request.')); }
    finally { setBusy(false); }
  };
  const stop = async (run: DynamicRun) => { setBusy(true); setError(null); try { await api.stopDynamicRun(projectId, run.id); await load(); } catch (e) { setError(userFacingError(e, 'The run could not be stopped. Refresh to inspect its state.')); } finally { setBusy(false); } };

  return <div className="dynamic-workspace-screen">
    <header className="command-page-header"><div><span className="dw-eyebrow">Browser validation</span><h1>Dynamic testing</h1><p>Save a test, run it again, and inspect the evidence behind each result.</p></div></header>
    <div className="dw-toolbar"><div><label htmlFor="dw-project">Project</label><Select id="dw-project" value={projectId} disabled={busy} options={projects.map(project => ({ value: project.id, label: project.name }))} onChange={value => { requestKey.current = null; setProjectId(value); onNavigate({ name: 'dynamic-testing', projectId: value }); }} /></div><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'projects', initialCreate: true })}><Plus size={16} /> Create project</button></div>
    {error && <p className="dw-error" role="alert" tabIndex={-1} ref={errorRef}>{error} <button type="button" onClick={() => { setError(null); void load().catch(e => setError(userFacingError(e))); }}>Refresh</button></p>}
    {!projectId ? <p className="dw-empty">Create or select a project to save your first browser test.</p> : <>
      <div className="dw-grid">
        <section className="dw-editor" aria-labelledby="dw-editor-title">
          <div className="dw-section-heading"><div><h2 id="dw-editor-title">{missionId ? 'Edit saved test' : 'New test'}</h2><p>Required checks verify the result independently of the browser agent.</p></div>{missionId && <button type="button" className="btn-secondary" onClick={resetDraft} disabled={busy}><Plus size={16} /> New test</button>}</div>
          <form onSubmit={save}><fieldset className="dw-form-body" disabled={busy || loading}>
            <div className="dw-field"><label htmlFor="dw-name">Test name</label><input id="dw-name" required maxLength={120} value={name} onChange={e => { dirty.current = true; setName(e.target.value); }} placeholder="Sign-in page smoke test" /></div>
            <div className="dw-field"><label htmlFor="dw-url"><Globe size={16} /> Website address</label><input id="dw-url" required type="url" value={targetUrl} onChange={e => { dirty.current = true; setTargetUrl(e.target.value); }} placeholder="http://localhost:3000" /></div>
            <div className="dw-field"><label htmlFor="dw-goal">Test goal</label><textarea id="dw-goal" required rows={3} value={goal} onChange={e => { dirty.current = true; setGoal(e.target.value); }} placeholder="Describe what the browser should do and verify." /></div>
            <div className="dw-field"><label htmlFor="dw-source">Criteria source</label><Select id="dw-source" value={source} options={[{ value: 'manual', label: 'Write my own criteria' }, { value: 'mock', label: 'Example requirements (mock)' }]} onChange={value => { dirty.current = true; setSource(value); }} /></div>
            {source === 'mock' && <p className="dw-notice">Example requirements are synthetic input. No real Review or approval is attached.</p>}
            <fieldset className="dw-checks"><legend><FileCheck2 size={16} /> Acceptance checks</legend>
              {checks.map((check, index) => <div className="dw-check" key={check.id}>
                <div className="dw-check-top"><strong>Check {index + 1}</strong><button type="button" aria-label={`Remove check ${index + 1}`} disabled={checks.length === 1 || busy} onClick={() => { dirty.current = true; setChecks(previous => previous.filter(item => item.id !== check.id)); }}><Trash2 size={16} /></button></div>
                {source === 'mock' && <div className="dw-field"><label htmlFor={`dw-criterion-${check.id}`}>Requirement criterion</label><Select id={`dw-criterion-${check.id}`} value={check.criterionId} required placeholder="Select a criterion" options={criteria.map(criterion => ({ value: criterion.id, label: criterion.description }))} onChange={value => change(check.id, { criterionId: value })} /></div>}
                <div className="dw-check-fields"><div className="dw-field"><label htmlFor={`dw-kind-${check.id}`}>Verify</label><Select id={`dw-kind-${check.id}`} value={check.kind} options={[{ value: 'visible_text', label: 'Visible text' }, { value: 'url', label: 'Page address' }, { value: 'element_visible', label: 'Visible element (CSS selector)' }]} onChange={value => change(check.id, { kind: value as CheckDefinition['kind'] })} /></div>
                  <div className="dw-field"><label htmlFor={`dw-value-${check.id}`}>{check.kind === 'url' ? 'Expected page address' : check.kind === 'visible_text' ? 'Expected visible text' : 'CSS selector'}</label><input id={`dw-value-${check.id}`} required value={check.value} onChange={e => change(check.id, { value: e.target.value })} placeholder={check.kind === 'url' ? 'http://localhost:3000/signin' : check.kind === 'visible_text' ? 'Sign in' : 'input[name="username"]'} /></div></div>
                <label className="dw-required"><input type="checkbox" checked={check.required} onChange={e => change(check.id, { required: e.target.checked })} /> Required for a passing result</label>
              </div>)}
              <button type="button" className="btn-secondary" disabled={checks.length >= 20 || busy} onClick={() => { dirty.current = true; setChecks(previous => [...previous, emptyCheck()]); }}><Plus size={16} /> Add check</button>
            </fieldset>
            <details className="dw-advanced"><summary>Advanced options</summary><div className="dw-field"><label htmlFor="dw-steps">Step limit</label><input id="dw-steps" type="number" min={1} max={25} value={maxSteps} onChange={e => { dirty.current = true; setMaxSteps(Number(e.target.value)); }} /></div></details>
            <div className="dw-actions"><button type="submit" className="btn-primary" disabled={busy || loading}>{busy ? 'Working…' : 'Save test'}</button>{selectedRevision && <button type="button" className="btn-secondary" disabled={busy || Boolean(activeRun) || dirty.current} onClick={() => void start(selectedRevision)}>Run saved test</button>}</div>
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
        <div className="dw-section-heading"><div><span className="dw-eyebrow">Selected run · revision {selectedRun.revision.revision}</span><h2 id="dw-result-title">{selectedRun.revision.name}</h2><p><Clock3 size={14} /> {dateLabel(selectedRun.createdAt)} · {stateLabel(selectedRun)}</p></div>{active(selectedRun) ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void stop(selectedRun)}><Square size={16} /> Stop run</button> : <button type="button" className="btn-secondary" disabled={busy || Boolean(activeRun)} onClick={() => void start(selectedRun.revision)}>Run this revision again</button>}</div>
        <p className={`dw-result-verdict dw-${selectedRun.verdict}`}>{verdictLabel(selectedRun.verdict)}</p>
        {selectedRun.reason && <p className="dw-notice">{selectedRun.reason}</p>}
        {selectedRun.state === 'interrupted' && <p className="dw-muted">Execution was not resumed automatically. Check the test data before running again.</p>}
        {revisions.some(revision => revision.missionId === selectedRun.missionId && revision.id !== selectedRun.revision.id) && <p className="dw-notice">This result belongs to an earlier revision and does not validate the current test.</p>}
        {selectedRun.revision.context && <p className="dw-muted">Criteria source: example requirements (mock). Browser observations are recorded separately.</p>}
        <div className="dw-table-scroll"><table><caption>Independent check results</caption><thead><tr><th>Check</th><th>Result</th><th>Observation</th></tr></thead><tbody>{selectedRun.revision.checks.map(check => { const result = selectedRun.checks.find(item => item.checkId === check.id); return <tr key={check.id}><th scope="row">{check.description}</th><td><span className={`dw-verdict dw-${result?.verdict ?? 'not_tested'}`}>{verdictLabel(result?.verdict ?? 'not_tested')}</span></td><td>{result?.observed || result?.reason || 'No observation recorded.'}</td></tr>; })}</tbody></table></div>
        {selectedRun.evidence.length > 0 && <details className="dw-evidence"><summary>Screenshot evidence · local to the executing device</summary><RunScreenshot projectId={projectId} run={selectedRun} /></details>}
        <details className="dw-advanced"><summary>Run details</summary><dl><dt>Run ID</dt><dd>{selectedRun.id}</dd><dt>Started by</dt><dd>{selectedRun.createdBy}</dd><dt>Website</dt><dd>{selectedRun.revision.targetUrl}</dd><dt>Test goal</dt><dd>{selectedRun.revision.goal}</dd><dt>Last worker activity</dt><dd>{selectedRun.lease?.heartbeatAt ? dateLabel(selectedRun.lease.heartbeatAt) : 'Unavailable'}</dd></dl></details>
      </section>}
    </>}
  </div>;
}
