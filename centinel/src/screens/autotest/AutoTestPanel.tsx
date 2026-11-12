import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { AlertTriangle, Bot, CheckCircle2, Circle, CircleDot, FileCode2, FolderOpen, Play, Square, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { userFacingError } from '../../utils/userFacingError';
import { isActive, type AutoTestEntry, type AutoTestSession } from '../../autotest/types';
import { laneColor, laneNumber, stageHeadline, stageStatus, STAGES, STATE_LABEL, STATE_TONE } from '../../autotest/presentation';
import { AutoTestLiveGrid } from './AutoTestLiveGrid';
import './AutoTest.css';

const POLL_MS = 1500;

function expectedText(test: AutoTestEntry, checkId: string): string {
  const check = test.checks.find(entry => entry.id === checkId);
  if (!check) return '';
  if (check.kind === 'visible_text') return `The page shows “${String(check.expected)}”`;
  if (check.kind === 'url') { try { return `The page address is ${new URL(String(check.expected)).pathname}`; } catch { return `The page address is ${String(check.expected)}`; } }
  if (check.kind === 'element_visible') return `${check.selector} is visible`;
  if (check.kind === 'field_value') return `${check.selector} contains “${String(check.expected)}”`;
  return check.description;
}

/** The checker reports absence as a note, not page text; say that plainly. */
function actualText(result: { observed: string | null; reason: string }): string {
  const observed = result.observed?.trim();
  if (!observed || /^expected .* absent\.?$/i.test(observed)) return 'This was not shown on the page.';
  return `“${observed.slice(0, 300)}”`;
}

function TestRow({ test, onOpenRun }: { test: AutoTestEntry; onOpenRun?(runId: string): void }) {
  const [open, setOpen] = useState(test.state === 'failed');
  const failed = (test.checkResults ?? []).filter(result => result.verdict !== 'passed');
  return (
    <li className={`at-test state-${test.state}`}>
      <button type="button" className="at-test-summary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {test.laneId && <span className="at-lane-dot" style={{ ['--lane-color' as string]: laneColor(test.laneId) }} aria-label={`Lane ${laneNumber(test.laneId)}`} />}
        <span className="at-test-name">{test.name}</span>
        {test.requirementRef && <span className="at-ref">{test.requirementRef}</span>}
        <span className={`at-chip tone-${STATE_TONE[test.state]}`}>{STATE_LABEL[test.state]}</span>
      </button>
      {open && (
        <div className="at-test-detail">
          <p className="at-goal">{test.goal}</p>
          {test.state === 'failed' && failed.length > 0 && (
            <dl className="at-expect">
              {failed.map(result => (
                <div key={result.checkId}>
                  <dt>Expected</dt><dd>{expectedText(test, result.checkId)}</dd>
                  <dt>Actual</dt><dd>{actualText(result)}</dd>
                </div>
              ))}
            </dl>
          )}
          {test.explanation && (
            <div className="at-explanation">
              <span className="at-ai-label"><Bot size={14} aria-hidden="true" /> AI explanation</span>
              <p>{test.explanation}</p>
            </div>
          )}
          {(test.state === 'blocked' || test.state === 'not_tested') && test.reason && <p className="at-reason">{test.reason}</p>}
          {test.sourceRefs.length > 0 && (
            <p className="at-sources"><FileCode2 size={14} aria-hidden="true" /> {test.sourceRefs.map(ref => <code key={`${ref.path}:${ref.line}`}>{ref.path}:{ref.line}</code>)}</p>
          )}
          {test.runId && onOpenRun && <button type="button" className="btn-secondary at-open-run" onClick={() => onOpenRun(test.runId!)}>Open run evidence</button>}
        </div>
      )}
    </li>
  );
}

function StageTimeline({ session }: { session: AutoTestSession }) {
  return (
    <ol className="at-stages" aria-label="Auto test progress">
      {STAGES.map(({ stage, label }) => {
        const status = stageStatus(session, stage);
        const Icon = status === 'done' ? CheckCircle2 : status === 'current' ? CircleDot : status === 'failed' ? XCircle : Circle;
        return <li key={stage} className={`at-stage is-${status}`} aria-current={status === 'current' ? 'step' : undefined}><Icon size={16} aria-hidden="true" /><span>{label}</span></li>;
      })}
    </ol>
  );
}

function SessionView({ session, onCancel, cancelling, onOpenRun }: { session: AutoTestSession; onCancel(): void; cancelling: boolean; onOpenRun?(runId: string): void }) {
  const active = isActive(session);
  const summary = session.summary;
  const failedFirst = [...session.tests].sort((a, b) => Number(b.state === 'failed') - Number(a.state === 'failed'));
  return (
    <div className="at-session">
      <div className="at-session-head">
        <div>
          <h3>{stageHeadline(session)}</h3>
          <p className="at-folder"><code>{session.folder}</code>{session.launch?.url && <> · <code>{session.launch.url}</code></>}</p>
        </div>
        {active && <button type="button" className="btn-secondary" onClick={onCancel} disabled={cancelling}><Square size={14} /> {cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      </div>
      <StageTimeline session={session} />

      {session.error && (
        <div className="at-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{session.error.message}</strong>
            {session.error.log && <details><summary>Start-up log</summary><pre>{session.error.log}</pre></details>}
          </div>
        </div>
      )}

      {session.stage !== 'testing' && session.launch && (active || session.error) && (
        <details className="at-detail-block" open={session.stage === 'starting'}>
          <summary>Start command: <code>{session.launch.label}</code></summary>
          {session.launch.log ? <pre className="at-log">{session.launch.log}</pre> : <p className="at-muted">No output yet.</p>}
        </details>
      )}

      {(session.stage === 'testing' || (active && session.lanes.length > 0 && session.tests.length > 0)) && (
        <AutoTestLiveGrid projectId={session.projectId} sessionId={session.id} lanes={session.lanes} tests={session.tests} active={active} />
      )}
      {session.laneNote && <p className="at-note">{session.laneNote}</p>}

      {summary && (
        <div className="at-summary" aria-label="Results">
          <div className="at-counts">
            <span className="tone-danger"><strong>{summary.failed}</strong> failed</span>
            <span className="tone-success"><strong>{summary.passed}</strong> passed</span>
            {summary.uncertain > 0 && <span className="tone-warning"><strong>{summary.uncertain}</strong> uncertain</span>}
            {summary.blocked > 0 && <span className="tone-warning"><strong>{summary.blocked}</strong> blocked</span>}
            {summary.notTested > 0 && <span><strong>{summary.notTested}</strong> not tested</span>}
          </div>
        </div>
      )}

      {session.tests.length > 0 && (
        <div className="at-tests">
          <h4>{summary ? 'What was tested' : `Tests (${session.tests.length})`}</h4>
          <ul>{(summary ? failedFirst : session.tests).map(test => <TestRow key={`${test.id}-${test.state}`} test={test} onOpenRun={onOpenRun} />)}</ul>
        </div>
      )}

      {(summary || session.stage === 'failed') && (session.dropped.length > 0 || summary?.limitations.length) && (
        <details className="at-detail-block">
          <summary>What this did not cover</summary>
          <ul className="at-limits">
            {summary?.limitations.map(item => <li key={item}>{item}</li>)}
            {session.dropped.map(item => <li key={item.name + item.reason}>Dropped “{item.name}”: {item.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Auto test: give a folder, Centinel reads it, starts the app, writes tests and runs them
 * while the user watches live. Starting is automatic by the user's decision (12 Nov 2026).
 */
export function AutoTestPanel({ projectId, defaultFolder, onOpenRun }: { projectId: string; defaultFolder?: string; onOpenRun?(runId: string): void }) {
  const [folder, setFolder] = useState(defaultFolder ?? '');
  const [session, setSession] = useState<AutoTestSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setFolder(defaultFolder ?? ''); }, [defaultFolder, projectId]);
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    void (async () => {
      try {
        const sessions = await api.autoTests(projectId);
        if (!cancelled) setSession(sessions[0] ?? null);
      } catch { /* history is optional; starting still works */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const refresh = useCallback(async (id: string) => {
    try {
      const next = await api.autoTest(projectId, id);
      setSession(next);
      if (isActive(next)) timer.current = setTimeout(() => void refresh(id), POLL_MS);
    } catch {
      timer.current = setTimeout(() => void refresh(id), POLL_MS * 2);
    }
  }, [projectId]);

  useEffect(() => {
    if (session && isActive(session)) timer.current = setTimeout(() => void refresh(session.id), POLL_MS);
    return () => clearTimeout(timer.current);
    // Poll only when the session identity or activity changes; refresh reschedules itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isActive(session), refresh]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      clearTimeout(timer.current);
      setSession(await api.startAutoTest(projectId, { folder: folder.trim() || undefined }));
    } catch (caught) {
      setError(userFacingError(caught));
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!session) return;
    setCancelling(true);
    try { setSession(await api.cancelAutoTest(projectId, session.id)); } catch (caught) { setError(userFacingError(caught)); } finally { setCancelling(false); }
  };
  const browse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose the app folder to test' });
      if (typeof selected === 'string') setFolder(selected);
    } catch { /* the folder field still accepts a typed path */ }
  };

  const running = isActive(session);
  return (
    <section className="at-panel" aria-labelledby="at-title">
      <div className="at-panel-head">
        <div>
          <h2 id="at-title">Auto test</h2>
          <p>Give Centinel your app’s folder. It reads the code, starts the app, writes tests from your requirements and runs them while you watch.</p>
        </div>
      </div>
      <form className="at-start" onSubmit={event => { event.preventDefault(); void start(); }}>
        <label htmlFor="at-folder">App folder</label>
        <div className="at-start-row">
          <input id="at-folder" className="at-folder-input" value={folder} onChange={event => setFolder(event.target.value)} placeholder="/Users/you/projects/my-app" disabled={running || starting} spellCheck={false} />
          <button type="button" className="btn-secondary" onClick={() => void browse()} disabled={running || starting}><FolderOpen size={16} /> Browse</button>
          <button type="submit" className="btn-primary" disabled={running || starting || !folder.trim()}><Play size={16} /> {starting ? 'Starting…' : 'Start Auto test'}</button>
        </div>
        <p className="at-hint">Centinel starts the app with its own start command (for example <code>npm run dev</code>) on this computer and stops it when the test ends.</p>
      </form>
      {error && <p className="at-inline-error" role="alert">{error}</p>}
      {session && <SessionView session={session} onCancel={() => void cancel()} cancelling={cancelling} onOpenRun={onOpenRun} />}
    </section>
  );
}
