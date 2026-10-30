import { useEffect, useRef, useState } from 'react';
import { formatActivityTime } from '../hooks/useProjectSummaries';
import { api } from '../api/client';
import { userFacingError } from '../utils/userFacingError';
import { DynamicReportsPanel } from './DynamicReportsPanel';
import type { DynamicUnitRun } from '../../../sidecar/src/dynamic/unit/types';
import type { EnvironmentData } from '../dynamic/types';
export function DynamicUnitPanel({ projectId, environmentId, disabled, dataState, onDataChange }: {
    projectId: string;
    environmentId: string;
    disabled: boolean;
    dataState: EnvironmentData | null;
    onDataChange(data: EnvironmentData): void;
}) {
    const [history, setHistory] = useState<DynamicUnitRun[]>([]), [selectedId, setSelectedId] = useState(''), [seconds, setSeconds] = useState(60), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const scope = useRef(0), sequence = useRef(0), request = useRef<{
        key: string;
        timeoutMs: number;
    } | null>(null);
    const onData = useRef(onDataChange);
    onData.current = onDataChange;
    useEffect(() => { const generation = ++scope.current; setHistory([]); setSelectedId(''); setError(''); setBusy(false); request.current = null; const load = () => { const tick = ++sequence.current; void api.unitRuns(projectId, environmentId).then(async (rows) => { if (generation !== scope.current || tick !== sequence.current)
        return; setHistory(rows); if (rows.some(r => ['queued', 'running'].includes(r.state)) || rows.length) {
        const data = await api.dynamicEnvironmentData(projectId, environmentId);
        if (generation === scope.current && tick === sequence.current)
            onData.current(data);
    } }).catch(e => { if (generation === scope.current)
        setError(userFacingError(e, 'Unit history unavailable.')); }); }; load(); const timer = window.setInterval(load, 5000); return () => { scope.current++; window.clearInterval(timer); }; }, [projectId, environmentId]);
    const active = history.find(r => ['queued', 'running'].includes(r.state)), selected = history.find(r => r.id === selectedId);
    async function start() { const generation = scope.current, timeoutMs = Math.round(seconds * 1000); if (!request.current || request.current.timeoutMs !== timeoutMs)
        request.current = { key: crypto.randomUUID(), timeoutMs }; setBusy(true); setError(''); try {
        const run = await api.startUnitRun(projectId, environmentId, request.current.key, timeoutMs);
        if (generation !== scope.current)
            return;
        sequence.current++;
        request.current = null;
        setHistory(rows => [run, ...rows.filter(r => r.id !== run.id)]);
        setSelectedId(run.id);
        const data = await api.dynamicEnvironmentData(projectId, environmentId);
        if (generation === scope.current)
            onData.current(data);
    }
    catch (e) {
        if (generation === scope.current)
            setError(userFacingError(e, 'Unit Run could not start. Retry uses the same request identity.'));
    }
    finally {
        if (generation === scope.current)
            setBusy(false);
    } }
    async function stop(run: DynamicUnitRun) { const generation = scope.current; setBusy(true); setError(''); try {
        const update = await api.cancelUnitRun(projectId, environmentId, run.id);
        if (generation === scope.current) {
            sequence.current++;
            setHistory(rows => rows.map(r => r.id === update.id ? update : r));
        }
    }
    catch (e) {
        if (generation === scope.current)
            setError(userFacingError(e));
    }
    finally {
        if (generation === scope.current)
            setBusy(false);
    } }
    return <details className="dw-advanced dw-unit"><summary>Existing unit tests · Vitest</summary><p className="dw-muted">Runs the selected, authorized local Vitest script using fixed Node arguments. Prepare its test data first; executed Runs require cleanup after stopping. Prerequisite failures execute no code. These framework results are separate from browser criteria and findings.</p>{error && <p role="alert" className="dw-error">{error}</p>}<div className="dw-field"><label htmlFor="dw-unit-timeout">Unit execution timeout (seconds)</label><input id="dw-unit-timeout" type="number" min={.1} max={300} step={.1} value={seconds} disabled={busy || Boolean(active)} onChange={e => { setSeconds(Number(e.target.value)); request.current = null; }}/></div><div className="dw-actions"><button type="button" className="btn-secondary" disabled={disabled || busy || Boolean(active) || dataState?.state !== 'ready' || !Number.isFinite(seconds) || seconds < .1 || seconds > 300} onClick={() => void start()}>Run authorized unit tests</button></div>{active && <p role="status">Unit Run is {active.cancelRequested ? 'stopping' : active.state}. <button type="button" className="btn-secondary" disabled={busy || active.cancelRequested} onClick={() => void stop(active)}>Stop unit run</button></p>}{!history.length && <p className="dw-muted">No unit Runs recorded for this environment.</p>}<div className="dw-saved-list">{history.map(r => <button type="button" key={r.id} onClick={() => setSelectedId(r.id)}><strong>{r.command.script ?? 'Prerequisite attempt'} · Vitest {r.command.frameworkVersion ?? 'unavailable'}</strong><span>{r.state} · {r.result?.outcome ?? 'Not tested'} · {formatActivityTime(r.createdAt)}</span></button>)}</div>{selected && <section aria-label="Selected unit Run"><h3>Selected unit Run</h3><p>{selected.state} · Framework outcome: {selected.result?.outcome ?? 'Not tested'}</p><p className="dw-muted">Vitest {selected.command.frameworkVersion ?? 'unavailable'} · Node {selected.command.nodeVersion ?? 'unavailable'} · Declared target version: {selected.environment.targetVersion || 'Unavailable'}</p>{selected.reason && <p className="dw-notice">{selected.reason}</p>}{selected.result?.assessment && <><p>{selected.result.assessment.counts.total} tests · {selected.result.assessment.counts.passed} passed · {selected.result.assessment.counts.failed} failed · {selected.result.assessment.counts.pending} pending/skipped · {selected.result.assessment.counts.todo} todo</p><details><summary>Framework test cases · {selected.result.assessment.counts.total} retained</summary><div className="dw-table-scroll" tabIndex={0} aria-label="Scrollable framework test results"><table><caption>First 100 test cases · export the report for all retained cases</caption><thead><tr><th>File / test</th><th>Framework status</th><th>Failure</th></tr></thead><tbody>{selected.result.assessment.tests.slice(0, 100).map((t, i) => <tr key={i}><th scope="row">{t.file}<br />{t.name}</th><td>{t.status}</td><td>{t.failureMessages.join('\n') || 'None recorded'}</td></tr>)}</tbody></table></div></details>{selected.result.assessment.detailsTruncated && <p className="dw-notice">Test details exceeded a retained bound. Counts remain separate.</p>}</>}{selected.result?.process && <><p className="dw-muted">Exit: {selected.result.process.exitCode ?? 'Unavailable'} · Signal: {selected.result.process.signal ?? 'None recorded'} · {selected.result.process.durationMs} ms · {selected.result.process.truncated ? 'Logs incomplete' : 'Bounded logs retained'}</p><details><summary>Redacted framework logs</summary><pre className="dw-command-output">{selected.result.process.output || 'No output recorded.'}</pre></details></>}{!['queued', 'running'].includes(selected.state) && <DynamicReportsPanel key={selected.id} projectId={projectId} runId={selected.id} kind="unit"/>}<details><summary>Execution identity and conditions</summary><p>Run {selected.id} · Executor {selected.createdBy}</p><p>Workspace fingerprint: {selected.command.fingerprint}</p><p>Installed CLI SHA-256: {selected.command.cliSha256}</p><p>Repository commit: {selected.command.gitCommit ?? 'Unavailable'}</p><p>Report capture freezes cleanup history; a later cleanup requires a new snapshot.</p></details></section>}</details>;
}
