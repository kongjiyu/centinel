import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { DynamicContractError } from '../types.js';
import { SHARED_EVIDENCE_BUCKET, MAX_SHARED_EVIDENCE_BYTES, type EvidenceCopy, type EvidenceTransfer } from './types.js';
export class SharedEvidenceRepository {
    constructor(private readonly client: SupabaseClient, private readonly storageClient: SupabaseClient = client) { }
    private async rpc(name: string, args: Record<string, unknown>) { const { data, error } = await this.client.rpc(name, args).abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(error.code === 'P0001' ? 409 : 503, error.code === 'P0001' ? 'Evidence changed, expired or is already transferring. Refresh before trying again.' : 'Private evidence storage is unavailable.'); return data; }
    list(projectId: string, runId: string): Promise<EvidenceCopy[]> { return this.rpc('list_dynamic_evidence_copies', { p_project_id: projectId, p_run_id: runId }); }
    prepare(projectId: string, runId: string, evidenceId: string, bytes: number): Promise<EvidenceTransfer> { return this.rpc('prepare_dynamic_evidence_copy', { p_project_id: projectId, p_run_id: runId, p_evidence_id: evidenceId, p_bytes: bytes }); }
    finish(projectId: string, id: string, token: string, outcome: 'available' | 'failed' | 'deleted'): Promise<EvidenceCopy> { return this.rpc('finish_dynamic_evidence_copy', { p_project_id: projectId, p_copy_id: id, p_token: token, p_outcome: outcome }); }
    prepareDelete(projectId: string, runId: string, id: string): Promise<EvidenceTransfer> { return this.rpc('delete_dynamic_evidence_copy', { p_project_id: projectId, p_run_id: runId, p_copy_id: id }); }
    async download(objectPath: string, expected: Pick<EvidenceCopy, 'sha256' | 'bytes'>): Promise<Buffer> {
        const { data, error } = await this.storageClient.storage.from(SHARED_EVIDENCE_BUCKET).download(objectPath, {cacheNonce:crypto.randomUUID()}, {signal:AbortSignal.timeout(15000),cache:'no-store'}).asStream();
        if (error || !data)
            throw new DynamicContractError(503, 'Private evidence is unavailable for this account.');
        const reader = data.getReader();
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                bytes += chunk.value.byteLength;
                if (bytes > MAX_SHARED_EVIDENCE_BYTES || bytes > expected.bytes)
                    throw Error('Exceeded recorded bound');
                chunks.push(Buffer.from(chunk.value));
            }
            const result = Buffer.concat(chunks);
            if (bytes !== expected.bytes || crypto.createHash('sha256').update(result).digest('hex') !== expected.sha256)
                throw Error('Checksum mismatch');
            return result;
        }
        catch {
            await reader.cancel().catch(() => { });
            throw new DynamicContractError(503, 'Private evidence failed its recorded size or checksum verification.');
        }
        finally {
            reader.releaseLock();
        }
    }
    async upload(transfer: EvidenceTransfer, bytes: Buffer) {
        const { error } = await this.storageClient.storage.from(SHARED_EVIDENCE_BUCKET).upload(transfer.objectPath, bytes, { upsert: false, contentType: transfer.copy.mimeType, cacheControl: '0' });
        if (error) {
            // A lost upload acknowledgement may have left this exact immutable object.
            // Read and verify it; never overwrite or blindly repeat the upload.
            await this.download(transfer.objectPath, transfer.copy);
        }
        else
            await this.download(transfer.objectPath, transfer.copy);
    }
    async remove(transfer: EvidenceTransfer) { const { error } = await this.storageClient.storage.from(SHARED_EVIDENCE_BUCKET).remove([transfer.objectPath]); if (error)
        throw new DynamicContractError(503, 'Shared-copy removal could not be confirmed; retry the recorded deletion.'); }
}
