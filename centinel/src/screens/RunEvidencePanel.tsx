import { useEffect, useRef, useState } from 'react';
import { formatActivityTime } from '../hooks/useProjectSummaries';
import { api } from '../api/client';
import { saveDownloadedCopy } from '../dynamic/saveDownloadedCopy';
import { userFacingError } from '../utils/userFacingError';
import type { DynamicRun } from '../dynamic/types';
import type { EvidenceCopy } from '../../../sidecar/src/dynamic/sharedEvidence/types';
const copyLabel = (kind: EvidenceCopy['kind']) => ({ screenshot: 'Check screenshot', checks: 'Independent check results', usability:'Usability rule observations', file_manifest: 'Captured-file manifest', partial_trace: 'Partial action trace', partial_network: 'Partial network diagnostics', partial_console: 'Partial console logs', partial_budget: 'Partial execution budget', partial_observation: 'Partial page observation',partial_manifest:'Partial artifact availability manifest',partial_usability:'Partial usability assessment', download: 'Captured test file' }[kind]);
export function RunEvidencePanel({ projectId, run }: {
    projectId: string;
    run: DynamicRun;
}) {
    const [copies, setCopies] = useState<EvidenceCopy[]>([]);
    const [image, setImage] = useState<string | null>(null);
    const [imageStatus, setImageStatus] = useState('Loading recorded screenshot…');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [omitted, setOmitted] = useState<Array<{
        slot: string;
        reason: string;
    }>>([]);
    const [preview, setPreview] = useState<{
        title: string;
        content: string;
        truncated: boolean;
    } | null>(null);
    const [deleteId, setDeleteId] = useState('');
    const generation = useRef(0);
    const producer = sessionStorage.getItem('centinel:supabase-user-id') === run.createdBy;
    useEffect(() => { setOmitted([]); setPreview(null); }, [projectId, run.id]);
    useEffect(() => {
        const ticket = ++generation.current;
        let url: string | null = null;
        setPreview(null);
        setImage(null);
        setDeleteId('');
        setCopies([]);
        setImageStatus('Loading recorded screenshot…');
        setError('');
        setBusy(true);
        void (async () => {
            let rows: EvidenceCopy[] = [];
            try {
                rows = await api.dynamicEvidenceCopies(projectId, run.id);
                if (ticket !== generation.current)
                    return;
                setCopies(rows);
            }
            catch (e) {
                if (ticket === generation.current)
                    setError(userFacingError(e, 'Shared evidence status could not be loaded. Local evidence may remain available.'));
            }
            const manifestCopy=rows.find(row=>row.kind==='partial_manifest'&&row.availability==='available');
            if(manifestCopy){try{const blob=await api.dynamicRecordedEvidenceBlob(projectId,run.id,manifestCopy.id,'shared');if(blob.size!==manifestCopy.bytes||blob.size>4194304)throw Error('Manifest size mismatch');const manifest=JSON.parse(await blob.text());if(manifest.schemaVersion!==1||manifest.criterionProof!==false||!Array.isArray(manifest.omitted)||manifest.omitted.length>64)throw Error('Manifest schema mismatch');const missing=manifest.omitted.filter((item:unknown):item is {slot:string;reason:string}=>Boolean(item)&&typeof item==='object'&&typeof (item as {slot?:unknown}).slot==='string'&&typeof (item as {reason?:unknown}).reason==='string').map((item:{slot:string;reason:string})=>({slot:item.slot.slice(0,100),reason:item.reason.slice(0,500)}));if(ticket===generation.current)setOmitted(missing);}catch{if(ticket===generation.current)setError('Shared artifact availability manifest could not be verified.');}}
            const ref = run.evidence.find(item => item.kind === 'screenshot');
            if (!ref) {
                if (ticket === generation.current)
                    setImageStatus('No independent screenshot was recorded.');
                return;
            }
            const shared = rows.find(row => row.evidenceId === ref.id && row.availability === 'available');
            try {
                let blob: Blob;
                let fromShared = Boolean(shared);
                try {
                    blob = await api.dynamicRecordedEvidenceBlob(projectId, run.id, shared?.id ?? ref.id, shared ? 'shared' : 'local');
                }
                catch (error) {
                    if (!shared)
                        throw error;
                    blob = await api.dynamicRecordedEvidenceBlob(projectId, run.id, ref.id, 'local');
                    fromShared = false;
                }
                if (ticket !== generation.current)
                    return;
                url = URL.createObjectURL(blob);
                setImage(url);
                setImageStatus(fromShared ? 'Shared copy verified for this account.' : shared ? 'Shared copy unavailable; verified local copy shown.' : 'Local copy verified on this device.');
            }
            catch {
                if (ticket === generation.current)
                    setImageStatus('Screenshot unavailable here. Recorded outcomes remain available; sync a copy from the executing device.');
            }
        })().finally(() => {
            if (ticket === generation.current)
                setBusy(false);
        });
        return () => {
            generation.current++;
            if (url)
                URL.revokeObjectURL(url);
        };
    }, [projectId, run.id, refresh]);
    async function sync() {
        const ticket = generation.current;
        setBusy(true);
        setError('');
        try {
            await api.syncDynamicEvidence(projectId, run.id);
            if (ticket === generation.current)
                setRefresh(value => value + 1);
        }
        catch (e) {
            if (ticket === generation.current) {
                setError(userFacingError(e, 'Evidence sync stopped. Refresh status before retrying.'));
                try {
                    const rows = await api.dynamicEvidenceCopies(projectId, run.id);
                    if (ticket === generation.current)
                        setCopies(rows);
                }
                catch { }
            }
        }
        finally {
            if (ticket === generation.current)
                setBusy(false);
        }
    }
    async function remove() {
        const ticket = generation.current;
        setBusy(true);
        setError('');
        try {
            await api.deleteDynamicEvidenceCopy(projectId, run.id, deleteId);
            if (ticket === generation.current) {
                setDeleteId('');
                setRefresh(value => value + 1);
            }
        }
        catch (e) {
            if (ticket === generation.current)
                setError(userFacingError(e, 'Deletion could not be confirmed. Refresh before retrying.'));
        }
        finally {
            if (ticket === generation.current)
                setBusy(false);
        }
    }
    async function shareArtifacts() { const ticket = generation.current; setBusy(true); setError(''); try {
        const result = await api.shareDynamicRunArtifacts(projectId, run.id);
        if (ticket === generation.current) {
            setOmitted(result.omitted);
            setRefresh(value => value + 1);
        }
    }
    catch (e) {
        if (ticket === generation.current)
            setError(userFacingError(e, 'Artifact sharing stopped. Inspect retained status before retrying.'));
    }
    finally {
        if (ticket === generation.current)
            setBusy(false);
    } }
    async function inspect(copy: EvidenceCopy) {
        const ticket = generation.current;
        setBusy(true);
        setError('');
        try {
            const blob = await api.dynamicRecordedEvidenceBlob(projectId, run.id, copy.id, 'shared');
            if (blob.size !== copy.bytes || blob.size > 4194304)
                throw Error('Recorded size mismatch');
            const bytes = await blob.arrayBuffer();
            const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
            if (sha !== copy.sha256)
                throw Error('Recorded checksum mismatch');
            if (ticket !== generation.current)
                return;
            if (copy.kind === 'download') {
                const base64 = btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''));
                await saveDownloadedCopy({ id: copy.id, bytes: copy.bytes, sha256: copy.sha256, base64 }, () => generation.current === ticket);
            }
            else {
                const text = JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)), null, 2);
                setPreview({ title: copyLabel(copy.kind), content: text.slice(0, 20000), truncated: text.length > 20000 });
            }
        }
        catch (e) {
            if (ticket === generation.current)
                setError(userFacingError(e, 'Recorded artifact could not be read or saved.'));
        }
        finally {
            if (ticket === generation.current)
                setBusy(false);
        }
    }
    return <section className="dw-shared-evidence" aria-labelledby="dw-evidence-copy-title">
    <h3 id="dw-evidence-copy-title">Recorded evidence</h3>
    <p>Sync verified independent checks from this device to share them with project members. Shared copies expire seven days after capture; retries do not extend that date.</p>
 <div className="dw-actions">
    <button type="button" className="btn-secondary" disabled={busy || run.state !== 'completed' || !run.evidence.length} onClick={() => void sync()}>Sync independent evidence</button>
    <button type="button" className="btn-secondary" disabled={busy || !producer || ['queued', 'running'].includes(run.state)} onClick={() => void shareArtifacts()}>Share diagnostics and captured files</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh evidence status</button>
    </div>
 {!producer && <p className="dw-muted">Diagnostics and captured files are published by the original executing account. Shared copies remain readable to project members.</p>}
 {error && <p role="alert" className="dw-error">{error}</p>}
 <p className="dw-muted">{imageStatus}</p>{image && <img src={image} className="dw-screenshot" alt="Verified screenshot for the selected Run's independent checks"/>}
 {!copies.length && <p className="dw-muted">No shared copies recorded. Files on another device are unavailable until synced.</p>}
 {copies.length > 0 && <ul className="dw-evidence-copies">{copies.map(copy => <li key={copy.id}>
            <strong>{copyLabel(copy.kind)}</strong>
            <p>{copy.availability[0].toUpperCase() + copy.availability.slice(1)} · {copy.bytes} bytes · Expires {formatActivityTime(copy.expiresAt)}</p>
            {copy.criterionProof === false && <p className="dw-muted">Diagnostic or captured output; does not independently verify a criterion.</p>}
            {copy.availability === 'available' && copy.kind !== 'screenshot' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void inspect(copy)}>{copy.kind === 'download' ? 'Save captured file' : 'Inspect recorded JSON'}</button>}
            <details className="dw-advanced">
            <summary>Copy details</summary>
            <p>SHA-256 {copy.sha256}</p>{copy.sourceSha256 && <p>Original source SHA-256 {copy.sourceSha256} · privacy version {copy.privacyVersion}</p>}
            <p>Executed by {copy.executorId} · Synced by {copy.syncedBy ?? 'Not synced'}</p>{copy.availability === 'deleted' && <p>Deleted by {copy.deletedBy ?? 'Not recorded'}</p>}
            </details>{copy.availability !== 'deleted' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeleteId(copy.id)}>Delete shared copy</button>}</li>)}</ul>}
 {omitted.length > 0 && <div className="dw-notice">
        <strong>Unavailable local artifacts</strong>
        <ul>{omitted.map(item => <li key={item.slot}>{item.slot}: {item.reason}</li>)}</ul>
        </div>}
        {preview && <div role="region" aria-label="Recorded JSON preview">
        <h4>{preview.title}</h4>
        <p className="dw-muted">Recorded data, not an executable instruction. {preview.truncated ? 'Preview is limited to 20,000 characters.' : ''}</p>
        <pre className="dw-json-preview">{preview.content}</pre>
        <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>Close preview</button>
        </div>}
        {deleteId && <div className="dw-notice" role="group" aria-label="Confirm shared-copy deletion">
        <p>Delete this shared copy? Its history and checksum remain. Local and previously downloaded copies are not removed.</p>
        <div className="dw-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeleteId('')}>Keep copy</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove()}>Confirm deletion</button>
        </div>
        </div>}
 </section>;
}
