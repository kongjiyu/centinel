import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DynamicContractError, type DynamicRun } from '../types.js';
import { redactObservationRecord } from '../browser/privacy.js';
import { DownloadVault } from '../environment/downloadVault.js';
import { publicDownloadUrl } from '../browser/fileTypes.js';
import { loadIndependentEvidence, readBoundedArtifactSlot } from './files.js';
export type ArtifactKind = 'partial_trace' | 'partial_network' | 'partial_console' | 'partial_budget' | 'partial_observation' | 'partial_manifest' | 'download';
export type RunArtifact = {
    id: string;
    projectId: string;
    runId: string;
    slot: string;
    kind: ArtifactKind;
    sha256: string;
    sourceSha256: string;
    bytes: number;
    mimeType: string;
    sourceManifestId: string | null;
    permissionUrl: string | null;
    capturedAt: string;
    registeredBy: string;
    createdAt: string;
    privacyVersion: 1;
    criterionProof: false;
};
export type ArtifactInput = Omit<RunArtifact, 'id' | 'projectId' | 'runId' | 'capturedAt' | 'registeredBy' | 'createdAt'>;
export type LocalArtifact = {
    input: ArtifactInput;
    bytes: Buffer;
};
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const slots = { trace: { file: 'action-trace.json', kind: 'partial_trace' }, network: { file: 'network.json', kind: 'partial_network' }, console: { file: 'console.json', kind: 'partial_console' }, budget: { file: 'execution-budget.json', kind: 'partial_budget' } } as const;
function stripPaths(value: unknown, depth = 0): unknown {
    if (depth > 20)
        throw new DynamicContractError(409, 'Partial artifact nesting exceeds its sharing bound.');
    if (typeof value === 'string')
        return value.replace(/(?:[A-Za-z]:[\\/]|\/)(?:Users|home|tmp|private|var|etc|Volumes|Applications)[\\/][^\s"'<>]+/g, '[LOCAL PATH WITHHELD]');
    if (Array.isArray(value))
        return value.map(item => stripPaths(item, depth + 1));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:file|screenshot|observation|response|workspace|directory)Path$/i.test(key) && !['reasoning', 'rawresponse', 'prompt', 'authorization', 'headers', 'cookies', 'cookie', 'set-cookie'].includes(key.toLowerCase())).map(([key, item]) => [key, stripPaths(item, depth + 1)]));
    return value;
}
/** Diagnostic derivatives never replace an independent check or mutate local logs. */
export function partialArtifacts(workspace: string, run: DynamicRun, secrets: readonly string[]): {
    artifacts: LocalArtifact[];
    omitted: Array<{
        slot: string;
        reason: string;
    }>;
} {
    if (!['blocked', 'cancelled', 'interrupted'].includes(run.state))
        return { artifacts: [], omitted: [] };
    const result: LocalArtifact[] = [];
    const omitted: Array<{
        slot: string;
        reason: string;
    }> = [];
    let total = 0;
    const retain = (slot: string, file: string, kind: ArtifactKind) => {
        let raw: Buffer;
        try {
            raw = readBoundedArtifactSlot(workspace, run, file);
        }
        catch (error) {
            if (error instanceof DynamicContractError) {
                omitted.push({ slot, reason: 'Local artifact missing or outside its sharing boundary.' });
                return;
            }
            throw error;
        }
        let value: unknown;
        try {
            value = JSON.parse(raw.toString('utf8'));
        }
        catch {
            throw new DynamicContractError(409, 'Partial evidence JSON is unreadable.');
        }
        const clean = stripPaths(redactObservationRecord(value, secrets));
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, criterionProof: false, privacyVersion: 1, content: clean }, null, 2));
        total += bytes.length;
        if (bytes.length > 4 * 1024 * 1024 || total > 8 * 1024 * 1024)
            throw new DynamicContractError(409, 'Partial evidence exceeds its bounded sharing package.');
        result.push({ input: { slot, kind, sha256: hash(bytes), sourceSha256: hash(raw), bytes: bytes.length, mimeType: 'application/json', sourceManifestId: null, permissionUrl: null, privacyVersion: 1, criterionProof: false }, bytes });
    };
    for (const [slot, entry] of Object.entries(slots))
        retain(slot, entry.file, entry.kind);
    if (run.legacySessionId) {
        const dir = path.join(workspace, 'sessions', run.legacySessionId, 'logs');
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(file => /^step-\d{3}-(before|after)\.json$/.test(file)).sort();
            if (files.length > 50)
                throw new DynamicContractError(409, 'Too many partial observations to share.');
            for (const file of files)
                retain(file.slice(0, -5), file, 'partial_observation');
        }
    }
    const manifestBytes=Buffer.from(JSON.stringify({schemaVersion:1,criterionProof:false,privacyVersion:1,captureScope:'Available bounded local artifacts at publication',slots:result.map(item=>({slot:item.input.slot,sha256:item.input.sha256,sourceSha256:item.input.sourceSha256})),omitted},null,2));
    result.push({input:{slot:'manifest',kind:'partial_manifest',sha256:hash(manifestBytes),sourceSha256:hash(manifestBytes),bytes:manifestBytes.length,mimeType:'application/json',sourceManifestId:null,permissionUrl:null,privacyVersion:1,criterionProof:false},bytes:manifestBytes});
    return { artifacts: result, omitted };
}
export function downloadArtifacts(workspace: string, run: DynamicRun, ownerId: string, vault: DownloadVault): LocalArtifact[] {
    const ref = run.evidence.find(item => item.kind === 'file_manifest');
    if (!ref || run.state !== 'completed')
        return [];
    const manifest = JSON.parse(loadIndependentEvidence(workspace, run, ref).toString('utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.downloads) || manifest.downloads.length > 10)
        throw new DynamicContractError(409, 'Captured-file manifest is invalid.');
    return manifest.downloads.map((receipt: any) => {
        if (!receipt || receipt.kind !== 'download' || !publicDownloadUrl(receipt.permissionUrl))
            throw new DynamicContractError(409, 'Captured download reference is invalid.');
        const grant = run.actionPolicy?.downloads?.find(item => item.url === receipt.permissionUrl && item.mimeType === receipt.mimeType && item.publicTestData === true);
        if (!grant || receipt.bytes > grant.maxBytes)
            throw new DynamicContractError(409, 'Captured file lacks its frozen public-test-data approval.');
        const stored = vault.get(ownerId, run.projectId, run.id, receipt.id);
        const bytes = Buffer.from(stored.base64, 'base64');
        if (stored.sha256 !== receipt.sha256 || stored.bytes !== receipt.bytes || stored.mimeType !== receipt.mimeType || stored.permissionUrl !== receipt.permissionUrl || hash(bytes) !== receipt.sha256)
            throw new DynamicContractError(409, 'Captured copy does not match its immutable manifest.');
        return { input: { slot: 'download-' + receipt.id, kind: 'download', sha256: receipt.sha256, sourceSha256: receipt.sha256, bytes: bytes.length, mimeType: receipt.mimeType, sourceManifestId: ref.id, permissionUrl: receipt.permissionUrl, privacyVersion: 1, criterionProof: false }, bytes };
    });
}
