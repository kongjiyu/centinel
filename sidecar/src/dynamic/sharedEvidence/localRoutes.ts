import type { DownloadVault } from '../environment/downloadVault.js';
import type { LocalDynamicHistory } from '../localHistory.js';
import { DynamicContractError, type EvidenceReference } from '../types.js';
import { downloadArtifacts, partialArtifacts } from './artifacts.js';
import type { LocalEvidenceCopies } from './localRepository.js';

export async function handleLocalEvidenceCopyRoute(
  method: string, project: string, runId: string, segments: string[], deps: {
    owner: string;
    history: LocalDynamicHistory;
    copies: LocalEvidenceCopies;
    downloads: DownloadVault;
    workspace: () => string;
    secrets: () => Promise<string[]>;
  },
) {
  const [id, action] = segments;
  const run = deps.history.run(project, runId);
  if (!run) throw new DynamicContractError(404, 'Saved Run is unavailable in this project.');

  const readEvidence = (ref: EvidenceReference) => {
    const content = deps.history.evidence(project, runId, ref.id);
    if (!content) throw new DynamicContractError(404, 'The evidence bytes are unavailable on this device.');
    return content;
  };

  if (!segments.length && method === 'GET') return { body: deps.copies.list(project, runId) };
  if (segments.length === 2 && id === 'local' && method === 'GET') {
    const ref = run.evidence.find(item => item.id === action);
    if (!ref) throw new DynamicContractError(404, 'Evidence is absent from this Run.');
    const { bytes, mimeType } = readEvidence(ref);
    return { body: bytes, mimeType };
  }
  if (segments.length === 1 && id === 'sync' && method === 'POST') {
    if (run.state !== 'completed') throw new DynamicContractError(409, 'Independent evidence is available after checking completes.');
    if (run.evidence.length > 4 || new Set(run.evidence.map(ref => ref.kind)).size !== run.evidence.length
        || new Set(run.evidence.map(ref => ref.id)).size !== run.evidence.length) {
      throw new DynamicContractError(409, 'The independent evidence set is invalid.');
    }
    return { body: deps.copies.save(run, run.evidence.map(ref => ({
      slot: `evidence:${ref.id}`, evidenceId: ref.id, kind: ref.kind, sha256: ref.sha256,
      ...readEvidence(ref),
    }))) };
  }
  if (segments.length === 1 && id === 'artifacts') {
    if (method === 'GET') return { body: deps.copies.artifacts(project, runId) };
    if (method === 'POST') {
      if (run.createdBy !== deps.owner) throw new DynamicContractError(409, 'Use the original executing account to save diagnostic and captured files.');
      if (!['completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state)) {
        throw new DynamicContractError(409, 'Stop the Run before saving diagnostic and captured files.');
      }
      const workspace = deps.workspace();
      const partial = partialArtifacts(workspace, run, await deps.secrets());
      const downloads = downloadArtifacts(workspace, run, deps.owner, deps.downloads, ref => readEvidence(ref).bytes);
      const copies = deps.copies.save(run, [...partial.artifacts, ...downloads].map(({ input, bytes }) => ({
        slot: `artifact:${input.slot}`, evidenceId: '', kind: input.kind, sha256: input.sha256,
        mimeType: input.mimeType, artifact: input, bytes,
      })));
      const ids = new Set(copies.map(copy => copy.evidenceId));
      const artifacts = deps.copies.artifacts(project, runId).filter(artifact => ids.has(artifact.id));
      return { body: { artifacts, copies, omitted: partial.omitted } };
    }
  }
  if (segments.length === 2 && action === 'content' && method === 'GET') {
    const { copy, bytes } = deps.copies.content(project, runId, id);
    return { body: bytes, mimeType: copy.mimeType, attachment: copy.kind === 'download' };
  }
  if (segments.length === 2 && action === 'delete' && method === 'POST') {
    return { body: deps.copies.remove(project, runId, id) };
  }
  return { status: 405, body: { error: 'Unsupported evidence operation.' } };
}
