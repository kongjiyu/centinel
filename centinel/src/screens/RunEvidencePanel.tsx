import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { userFacingError } from '../utils/userFacingError';
import type { DynamicRun } from '../dynamic/types';
import type { EvidenceCopy } from '../../../sidecar/src/dynamic/sharedEvidence/types';
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
    const [deleteId, setDeleteId] = useState('');
    const generation = useRef(0);
    useEffect(() => {
        const ticket = ++generation.current;
        let url: string | null = null;
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
        })().finally(() => { if (ticket === generation.current)
            setBusy(false); });
        return () => { generation.current++; if (url)
            URL.revokeObjectURL(url); };
    }, [projectId, run.id, refresh]);
    async function sync() { const ticket = generation.current; setBusy(true); setError(''); try {
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
    } }
    async function remove() { const ticket = generation.current; setBusy(true); setError(''); try {
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
    } }
    return <section className="dw-shared-evidence" aria-labelledby="dw-evidence-copy-title">
    <h3 id="dw-evidence-copy-title">Recorded evidence</h3>
    <p>Sync verified independent checks from this device to share them with project members. Shared copies expire seven days after capture; retries do not extend that date.</p>
 <div className="dw-actions">
    <button type="button" className="btn-secondary" disabled={busy || run.state !== 'completed' || !run.evidence.length} onClick={() => void sync()}>Sync independent evidence</button>
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh evidence status</button>
    </div>
 {error && <p role="alert" className="dw-error">{error}</p>}
 <p className="dw-muted">{imageStatus}</p>{image && <img src={image} className="dw-screenshot" alt="Verified screenshot for the selected Run's independent checks"/>}
 {!copies.length && <p className="dw-muted">No shared copies recorded. Files on another device are unavailable until synced.</p>}
 {copies.length > 0 && <ul className="dw-evidence-copies">{copies.map(copy => <li key={copy.id}>
            <strong>{copy.kind === 'screenshot' ? 'Check screenshot' : copy.kind === 'checks' ? 'Independent check results' : 'Captured-file manifest'}</strong>
            <p>{copy.availability[0].toUpperCase() + copy.availability.slice(1)} · {copy.bytes} bytes · Expires {new Date(copy.expiresAt).toLocaleString()}</p>
            <details className="dw-advanced">
            <summary>Copy details</summary>
            <p>SHA-256 {copy.sha256}</p>
            <p>Executed by {copy.executorId} · Synced by {copy.syncedBy ?? 'Not synced'}</p>{copy.availability==='deleted'&&<p>Deleted by {copy.deletedBy??'Not recorded'}</p>}
            </details>{copy.availability !== 'deleted' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeleteId(copy.id)}>Delete shared copy</button>}</li>)}</ul>}
 {deleteId && <div className="dw-notice" role="group" aria-label="Confirm shared-copy deletion">
        <p>Delete this shared copy? Its history and checksum remain. Local and previously downloaded copies are not removed.</p>
        <div className="dw-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeleteId('')}>Keep copy</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove()}>Confirm deletion</button>
        </div>
        </div>}
 </section>;
}
