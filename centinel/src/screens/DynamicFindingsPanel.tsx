import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Select } from '../components/Select';
import { userFacingError } from '../utils/userFacingError';
import type { DynamicRun } from '../dynamic/types';
import type { DynamicFinding, FindingDetail, ReviewFindingInput, VerificationDecision } from '../../../sidecar/src/dynamic/findings/types';
const label = (value: string) => ({ unreviewed: 'Unreviewed', confirmed: 'Confirmed', rejected: 'Rejected', needs_investigation: 'Needs investigation', open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }[value] ?? value);
export function DynamicFindingsPanel({ projectId, run, runs }: {
    projectId: string;
    run: DynamicRun;
    runs: DynamicRun[];
}) {
    const [findings, setFindings] = useState<DynamicFinding[]>([]);
    const [detail, setDetail] = useState<FindingDetail | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [decision, setDecision] = useState('');
    const [note, setNote] = useState('');
    const [severity, setSeverity] = useState('');
    const [priority, setPriority] = useState('');
    const [confidence, setConfidence] = useState('');
    const [status, setStatus] = useState('');
    const [remediationNote, setRemediationNote] = useState('');
    const [regressionId, setRegressionId] = useState('');
    const generation = useRef(0);
    const active = ['queued', 'running'].includes(run.state);
    useEffect(() => { const ticket = ++generation.current; setFindings([]); setDetail(null); setError(''); setMessage(''); setBusy(true); void api.dynamicFindings(projectId).then(rows => { if (generation.current === ticket)
        setFindings(rows.filter(row => row.missionId === run.missionId)); }).catch(e => { if (generation.current === ticket)
        setError(userFacingError(e, 'Finding records could not be loaded.')); }).finally(() => { if (generation.current === ticket)
        setBusy(false); }); return () => { generation.current++; }; }, [projectId, run.missionId]);
    async function select(id: string) { const ticket = ++generation.current; setBusy(true); setDetail(null); setError(''); try {
        const next = await api.dynamicFinding(projectId, id);
        if (ticket !== generation.current)
            return;
        setDetail(next);
        setDecision('');
        setNote('');
        setSeverity(next.finding.severity ?? '');
        setPriority(next.finding.priority ?? '');
        setConfidence(next.finding.confidence ?? '');
        setStatus('');
        setRemediationNote('');
        setRegressionId('');
    }
    catch (e) {
        if (ticket === generation.current)
            setError(userFacingError(e, 'Finding history could not be loaded.'));
    }
    finally {
        if (ticket === generation.current)
            setBusy(false);
    } }
    async function collect() { const ticket = generation.current; setBusy(true); setError(''); try {
        const next = await api.collectDynamicFindings(projectId, run.id);
        const all = await api.dynamicFindings(projectId);
        if (ticket !== generation.current)
            return;
        setFindings(all.filter(row => row.missionId === run.missionId));
        setMessage(next.length ? `${next.length} candidate${next.length === 1 ? '' : 's'} recorded. Review the observation before confirming an issue.` : 'No failed checks with sufficient recorded evidence.');
        if (next[0])
            await select(next[0].id);
    }
    catch (e) {
        if (ticket === generation.current)
            setError(userFacingError(e, 'Candidates could not be recorded.'));
    }
    finally {
        if (ticket === generation.current)
            setBusy(false);
    } }
    async function save(kind: 'review' | 'remediation') { if (!detail)
        return; const ticket = generation.current; const id = detail.finding.id; setBusy(true); setError(''); setMessage(''); try {
        const updated = kind === 'review' ? await api.reviewDynamicFinding(projectId, id, { version: detail.finding.version, decision: decision as VerificationDecision, note, ...(decision === 'confirmed' ? { severity: severity as ReviewFindingInput['severity'], priority: priority as ReviewFindingInput['priority'], confidence: confidence as ReviewFindingInput['confidence'] } : {}) }) : await api.remediateDynamicFinding(projectId, id, { version: detail.finding.version, status: status as DynamicFinding['remediation'], note: remediationNote, ...(regressionId ? { regressionRunId: regressionId } : {}) });
        const next = await api.dynamicFinding(projectId, id);
        if (ticket !== generation.current)
            return;
        setDetail(next);
        setFindings(rows => rows.map(row => row.id === id ? updated : row));
        setMessage('Decision recorded with your account and preserved history.');
        setDecision('');
        setNote('');
        setStatus('');
        setRemediationNote('');
    }
    catch (e) {
        if (ticket === generation.current)
            setError(userFacingError(e, 'Finding update failed. Refresh the finding before trying again.'));
    }
    finally {
        if (ticket === generation.current)
            setBusy(false);
    } }
    const regressionRuns = detail ? runs.filter(item => item.state === 'completed' && item.verdict === 'passed' && item.regression && detail.observations.some(observation => observation.runId === item.regression!.runId && observation.revisionId === item.revision.id)) : [];
    return <section className="dw-findings" aria-labelledby="dw-findings-heading">
    <div className="dw-section-heading">
    <div>
    <h3 id="dw-findings-heading">Finding verification</h3>
    <p>Failed checks need human verification. Dynamic findings remain separate from Project Assessment.</p>
    </div>
    </div>
 <div className="dw-actions">
    <button type="button" className="btn-secondary" disabled={busy || active || run.state !== 'completed' || !run.checks.some(check => check.verdict === 'failed')} onClick={() => void collect()}>Record failed-check candidates</button>{detail && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void select(detail.finding.id)}>Refresh finding</button>}</div>
 {error && <p role="alert" className="dw-error">{error}</p>}{message && <p role="status" className="dw-feedback">{message}</p>}
 {!findings.length && <p className="dw-muted">{busy ? 'Loading finding records…' : 'No candidates recorded for this saved test.'}</p>}
 {findings.length > 0 && <div className="dw-table-scroll" tabIndex={0} role="region" aria-label="Finding records table">
        <table>
        <caption>Dynamic candidates for this saved test</caption>
        <thead>
        <tr>
        <th>Issue</th>
        <th>Verification</th>
        <th>Remediation</th>
        <th>Observations</th>
        <th>Action</th>
        </tr>
        </thead>
        <tbody>{findings.map(finding => <tr key={finding.id}>
            <th scope="row">{finding.title}</th>
            <td>{label(finding.verification)}</td>
            <td>{label(finding.remediation)}</td>
            <td>{finding.observationCount}</td>
            <td>
            <button type="button" className="btn-secondary" disabled={busy} aria-label={"Inspect "+finding.title} onClick={() => void select(finding.id)}>Inspect</button>
            </td>
            </tr>)}</tbody>
        </table>
        </div>}
 {detail && <div className="dw-finding-detail">
        <h4>{detail.finding.title}</h4>
        <p>{label(detail.finding.verification)} · {label(detail.finding.remediation)} · Severity {detail.finding.severity ?? 'Unclassified'} · Priority {detail.finding.priority ?? 'Unclassified'} · Confidence {detail.finding.confidence ?? 'Unclassified'}</p>
 <p className="dw-muted">{detail.finding.confidenceBasis}</p>
 {detail.observations.map(observation => <details className="dw-advanced" key={observation.id}>
            <summary>Failed observation · {new Date(observation.createdAt).toLocaleString()}</summary>
            <dl>
            <dt>Run</dt>
            <dd>{observation.runId}</dd>
            <dt>Executor</dt>
            <dd>{observation.executorId}</dd>
            <dt>Target version</dt>
            <dd>{observation.targetVersion ?? 'Not recorded'}</dd>
            <dt>Expected</dt>
            <dd>{'expected' in observation.definition ? JSON.stringify(observation.definition.expected) : 'Visible element'}</dd>
            <dt>Observed</dt>
            <dd>{observation.result.observed ?? observation.result.reason}</dd>
            <dt>Reproduce</dt>
            <dd>{observation.targetUrl} — {observation.goal}</dd>
            <dt>Evidence</dt>
            <dd>{observation.evidence.map(item => <p key={item.id}>{item.kind} · {item.id} · local to executing device</p>)}</dd>
            </dl>
            </details>)}
 <div className="dw-check-fields">
        <div className="dw-field">
        <label htmlFor="dw-finding-decision">Verification decision</label>
        <Select id="dw-finding-decision" value={decision || 'unselected'} onChange={value => setDecision(value === 'unselected' ? '' : value)} options={[{ value: 'unselected', label: 'Choose a decision' }, { value: 'confirmed', label: 'Confirm issue' }, { value: 'rejected', label: 'Reject candidate' }, { value: 'needs_investigation', label: 'Needs investigation' }]}/>
        </div>
        </div>
 {decision === 'confirmed' && <div className="dw-finding-triage">{([{ id: 'severity', value: severity, set: setSeverity, options: ['critical', 'high', 'medium', 'low', 'info'] }, { id: 'priority', value: priority, set: setPriority, options: ['high', 'medium', 'low'] }, { id: 'confidence', value: confidence, set: setConfidence, options: ['low', 'medium', 'high'] }] as const).map(field => <div className="dw-field" key={field.id}>
                <label htmlFor={'dw-finding-' + field.id}>{field.id[0].toUpperCase() + field.id.slice(1)}</label>
                <Select id={'dw-finding-' + field.id} value={field.value || 'unselected'} onChange={value => field.set(value === 'unselected' ? '' : value)} options={[{ value: 'unselected', label: 'Choose ' + field.id }, ...field.options.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]}/>
                </div>)}</div>}
 <div className="dw-field">
        <label htmlFor="dw-finding-note">Verification reason</label>
        <textarea id="dw-finding-note" value={note} maxLength={4000} onChange={event => setNote(event.target.value)}/>
        </div>
        <button type="button" className="btn-primary" disabled={busy || active || !decision || note.trim().length < 3 || decision === 'confirmed' && (!severity || !priority || !confidence)} onClick={() => void save('review')}>Record verification</button>
 <details className="dw-advanced">
        <summary>Remediation and pinned regression</summary>
        <p>A later pass does not resolve an issue automatically. Inspect the failed observation, the regression and any changed conditions before recording resolution.</p>
        <div className="dw-field">
        <label htmlFor="dw-finding-remediation">Remediation status</label>
        <Select id="dw-finding-remediation" value={status || 'unselected'} onChange={value => setStatus(value === 'unselected' ? '' : value)} options={[{ value: 'unselected', label: 'Choose status' }, { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved after regression' }]}/>
        </div>{status === 'resolved' && <div className="dw-field">
            <label htmlFor="dw-finding-regression">Passed pinned regression</label>
            <Select id="dw-finding-regression" value={regressionId || 'unselected'} onChange={value => setRegressionId(value === 'unselected' ? '' : value)} options={[{ value: 'unselected', label: 'Choose a regression' }, ...regressionRuns.map(item => ({ value: item.id, label: item.revision.name + ' · ' + new Date(item.createdAt).toLocaleString() }))]}/>
            <p className="dw-muted">Confirmation and matching independent check evidence are required. Recorded configuration differences remain in the resolution history.</p>
            </div>}<div className="dw-field">
        <label htmlFor="dw-finding-remediation-note">Remediation reason</label>
        <textarea id="dw-finding-remediation-note" value={remediationNote} maxLength={4000} onChange={event => setRemediationNote(event.target.value)}/>
        </div>
        <button type="button" className="btn-secondary" disabled={busy || active || !status || remediationNote.trim().length < 3 || status === 'resolved' && (!regressionId || detail.finding.verification !== 'confirmed')} onClick={() => void save('remediation')}>Record remediation</button>
        </details>
 <details className="dw-advanced">
        <summary>Decision history · {detail.events.length}</summary>{detail.events.length ? detail.events.map(event => <article key={event.id}>
            <p>
            <strong>{label(event.decision ?? event.remediation ?? event.kind)}</strong> · {new Date(event.createdAt).toLocaleString()} · {event.actorId}</p>
            <p>{event.note}</p>{event.regressionRunId && <p>Regression {event.regressionRunId}</p>}{event.conditionChanges?.map(change => <p key={change}>{change}</p>)}</article>) : <p>No human decision recorded.</p>}</details>
 </div>}
 </section>;
}
