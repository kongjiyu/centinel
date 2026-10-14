import { partialArtifacts, downloadArtifacts } from './artifacts.js';
import type { DownloadVault } from '../environment/downloadVault.js';
import type { DynamicService } from '../service.js';
import { DynamicContractError } from '../types.js';
import type { SharedEvidenceRepository } from './repository.js';
import { loadIndependentEvidence } from './files.js';
export async function handleEvidenceCopyRoute(request: {
    method: string;
    pathname: string;
}, deps: {
    repository: SharedEvidenceRepository;
    ownerId?: string;
    downloadVault?: DownloadVault;
    privateValues?(projectId: string): Promise<string[]>;
    service: DynamicService;
    requireMember(projectId: string): Promise<void>;
    workspace(projectId: string): Promise<string>;
}) {
    const match = request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/runs\/([^/]+)\/evidence(?:\/(sync|local|[^/]+))?(?:\/([^/]+))?$/);
    if (!match)
        return null;
    const [, projectId, runId, id, action] = match;
    await deps.requireMember(projectId);
    try {
        const run = await deps.service.requireRun(projectId, runId);
        if (id === 'local' && action && request.method === 'GET') {
            const ref = run.evidence.find(item => item.id === action);
            if (!ref)
                throw new DynamicContractError(404, 'Evidence not recorded in this Run.');
            const bytes = loadIndependentEvidence(await deps.workspace(projectId), run, ref);
            return { status: 200, body: bytes, mimeType: ref.kind === 'screenshot' ? 'image/png' : 'application/json' };
        }
        if (id === 'artifacts' && !action && request.method === 'GET')
            return { status: 200, body: await deps.repository.artifacts(projectId, runId) };
        if (id === 'artifacts' && !action && request.method === 'POST') {
            if (run.createdBy !== deps.ownerId)
                throw new DynamicContractError(409, 'Publish diagnostic and captured-file artifacts from the original executing account.');
            if (!['completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state))
                throw new DynamicContractError(409, 'Stop the Run before publishing artifacts.');
            const workspace = await deps.workspace(projectId);
            const partial = partialArtifacts(workspace, run, await deps.privateValues?.(projectId) ?? []);
            const downloads = deps.downloadVault ? downloadArtifacts(workspace, run, deps.ownerId, deps.downloadVault) : [];
            const local = [...partial.artifacts, ...downloads];
            const copies = [];
            const registered = [];
            for (const artifact of local) {
                const entry = await deps.repository.registerArtifact(projectId, runId, artifact.input);
                registered.push(entry);
                const transfer = await deps.repository.prepare(projectId, runId, entry.id, artifact.bytes.length);
                if (!transfer.token) {
                    copies.push(transfer.copy);
                    continue;
                }
                try {
                    await deps.repository.upload(transfer, artifact.bytes);
                    copies.push(await deps.repository.finish(projectId, transfer.copy.id, transfer.token, 'available'));
                }
                catch {
                    await deps.repository.finish(projectId, transfer.copy.id, transfer.token, 'failed').catch(() => { });
                    throw new DynamicContractError(503, 'Artifact sharing stopped. Registry and copy status remain available for explicit retry.');
                }
            }
            return { status: 200, body: { artifacts: registered, copies, omitted: partial.omitted } };
        }
        if (!id && request.method === 'GET')
            return { status: 200, body: await deps.repository.list(projectId, runId) };
        if (id === 'sync' && !action && request.method === 'POST') {
            if (run.state !== 'completed')
                throw new DynamicContractError(409, 'Independent evidence is available only after checking completes.');
            if (run.evidence.length > 4 || new Set(run.evidence.map(ref => ref.id)).size !== run.evidence.length || new Set(run.evidence.map(ref => ref.kind)).size !== run.evidence.length)
                throw new DynamicContractError(409, 'The independent evidence set is invalid or exceeds its bounded slots.');
            const workspace = await deps.workspace(projectId);
            const files = run.evidence.map(ref => ({ ref, bytes: loadIndependentEvidence(workspace, run, ref) }));
            const results = [];
            for (const file of files) {
                const transfer = await deps.repository.prepare(projectId, runId, file.ref.id, file.bytes.length);
                if (!transfer.token) {
                    results.push(transfer.copy);
                    continue;
                }
                try {
                    await deps.repository.upload(transfer, file.bytes);
                    results.push(await deps.repository.finish(projectId, transfer.copy.id, transfer.token, 'available'));
                }
                catch {
                    await deps.repository.finish(projectId, transfer.copy.id, transfer.token, 'failed').catch(() => { });
                    throw new DynamicContractError(503, 'Evidence sync stopped. Copy status is retained; refresh before retrying from the executing device.');
                }
            }
            return { status: 200, body: results };
        }
        if (id && action === 'content' && request.method === 'GET') {
            const copy = (await deps.repository.list(projectId, runId)).find(item => item.id === id);
            if (!copy)
                throw new DynamicContractError(404, 'Evidence copy not found in this Run.');
            if (copy.availability !== 'available')
                throw new DynamicContractError(409, 'Shared evidence is pending, expired or unavailable.');
            const ext = copy.kind === 'download' ? '.bin' : copy.mimeType === 'image/png' ? '.png' : '.json';
            const objectPath = projectId + '/dynamic-v1/' + runId + '/' + copy.id + '/' + copy.sha256 + ext;
            return { status: 200, body: await deps.repository.download(objectPath, copy), mimeType: copy.mimeType, ...(copy.kind === 'download' ? { attachment: true } : {}) };
        }
        if (id && action === 'delete' && request.method === 'POST') {
            const transfer = await deps.repository.prepareDelete(projectId, runId, id);
            if (!transfer.token)
                return { status: 200, body: transfer.copy };
            await deps.repository.remove(transfer);
            return { status: 200, body: await deps.repository.finish(projectId, id, transfer.token, 'deleted') };
        }
        return { status: 405, body: { error: 'Unsupported shared evidence operation.' } };
    }
    catch (error) {
        if (error instanceof DynamicContractError)
            return { status: error.status, body: { error: error.message } };
        throw error;
    }
}
