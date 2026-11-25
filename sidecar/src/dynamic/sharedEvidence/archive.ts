import { createHash } from 'node:crypto';
import { publicDownloadUrl } from '../browser/fileTypes.js';
import type { DynamicRun } from '../types.js';
import type { RunArtifact } from './artifacts.js';
import { verifyIndependentEvidence } from './files.js';
import { MAX_SHARED_EVIDENCE_BYTES, type EvidenceCopy } from './types.js';

export type EvidenceCopyArchive = {
  artifacts: RunArtifact[];
  copies: { copy: EvidenceCopy; contentBase64?: string }[];
};

const sha = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const mime = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const date = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));
const diagnosticSlots: Readonly<Record<string, RegExp>> = {
  partial_trace: /^trace$/, partial_network: /^network$/, partial_console: /^console$/, partial_budget: /^budget$/,
  partial_observation: /^step-\d{3}-(before|after)$/, partial_manifest: /^manifest$/, partial_usability: /^usability$/,
};

export function verifyArchivedArtifact(run: DynamicRun, item: RunArtifact): void {
  if (!item || item.projectId !== run.projectId || item.runId !== run.id || item.registeredBy !== run.createdBy
    || !uuid.test(item.id) || !date(item.createdAt) || !date(item.capturedAt) || item.privacyVersion !== 1
    || item.criterionProof !== false || !sha.test(item.sha256) || !sha.test(item.sourceSha256)
    || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_SHARED_EVIDENCE_BYTES
    || typeof item.mimeType !== 'string' || item.mimeType.length > 100 || !mime.test(item.mimeType)) {
    throw new Error('An archived diagnostic artifact has invalid scope or metadata.');
  }
  if (item.kind === 'download') {
    const ref = run.evidence.find(ref => ref.id === item.sourceManifestId && ref.kind === 'file_manifest');
    const grant = run.actionPolicy?.downloads?.find(grant => grant.url === item.permissionUrl && grant.mimeType === item.mimeType
      && grant.publicTestData === true && item.bytes <= grant.maxBytes);
    const observed = run.checks.some(result => (result.verdict === 'passed' || result.verdict === 'failed')
      && result.observed === `Captured SHA-256: ${item.sha256}` && ref && result.evidenceIds.includes(ref.id)
      && run.revision.checks.some(check => check.kind === 'download_sha256' && check.url === item.permissionUrl
        && check.id === result.checkId && check.criterionId === result.criterionId));
    if (run.state !== 'completed' || !/^download-[a-f0-9-]{36}$/.test(item.slot) || item.bytes > 1_048_576
      || item.sourceSha256 !== item.sha256 || !publicDownloadUrl(item.permissionUrl) || !grant || !observed) {
      throw new Error('An archived captured file is missing its frozen download permission or check evidence.');
    }
    return;
  }
  if (!['blocked', 'cancelled', 'interrupted'].includes(run.state) || item.bytes < 1 || item.mimeType !== 'application/json'
    || item.sourceManifestId !== null || item.permissionUrl !== null || !Object.hasOwn(diagnosticSlots, item.kind)
    || !diagnosticSlots[item.kind].test(item.slot) || (item.kind === 'partial_usability' && !run.revision.usability)) {
    throw new Error('An archived diagnostic artifact has an invalid slot or Run state.');
  }
}

export function verifyArchivedCopy(run: DynamicRun, copy: EvidenceCopy, artifact?: RunArtifact): string {
  const ref = run.evidence.find(item => item.id === copy?.evidenceId);
  if (!copy || copy.projectId !== run.projectId || copy.runId !== run.id || copy.executorId !== run.createdBy
    || !uuid.test(copy.id) || !date(copy.createdAt) || !date(copy.updatedAt) || !date(copy.expiresAt)
    || !['pending', 'available', 'failed', 'expired', 'deleting', 'deleted'].includes(copy.availability)
    || !sha.test(copy.sha256) || !Number.isSafeInteger(copy.bytes) || copy.bytes < 0 || copy.bytes > MAX_SHARED_EVIDENCE_BYTES
    || (copy.syncedBy !== null && !uuid.test(copy.syncedBy)) || (copy.deletedBy != null && !uuid.test(copy.deletedBy))) {
    throw new Error('An archived evidence copy has invalid scope or metadata.');
  }
  if (artifact) {
    if (artifact.id !== copy.evidenceId || artifact.kind !== copy.kind || artifact.sha256 !== copy.sha256
      || artifact.bytes !== copy.bytes || artifact.mimeType !== copy.mimeType || artifact.sourceSha256 !== copy.sourceSha256
      || copy.privacyVersion !== 1 || copy.criterionProof !== false) {
      throw new Error('An archived diagnostic copy does not match its registered artifact.');
    }
    return `artifact:${artifact.slot}`;
  }
  if (run.state !== 'completed' || !ref || copy.sha256 !== ref.sha256 || copy.kind !== ref.kind || copy.bytes < 1
    || copy.criterionProof !== undefined || copy.mimeType !== (ref.kind === 'screenshot' ? 'image/png' : 'application/json')) {
    throw new Error('An archived evidence copy does not match its recorded check.');
  }
  return `evidence:${ref.id}`;
}

export function verifyArchivedCopyBytes(run: DynamicRun, copy: EvidenceCopy, bytes: Buffer): void {
  if (bytes.length !== copy.bytes || createHash('sha256').update(bytes).digest('hex') !== copy.sha256) {
    throw new Error('An archived evidence copy failed size or checksum verification.');
  }
  if (copy.criterionProof !== false) {
    const ref = run.evidence.find(ref => ref.id === copy.evidenceId);
    if (!ref) throw new Error('An archived evidence copy is missing its recorded check.');
    verifyIndependentEvidence(bytes, ref);
  } else if (copy.mimeType === 'application/json' && copy.kind !== 'download') {
    const diagnostic = JSON.parse(bytes.toString('utf8'));
    if (diagnostic?.schemaVersion !== 1 || diagnostic.privacyVersion !== 1 || diagnostic.criterionProof !== false) {
      throw new Error('An archived diagnostic copy has invalid evidence metadata.');
    }
  }
}
