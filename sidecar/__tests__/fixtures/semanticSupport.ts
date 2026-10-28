import type { StaticModelRequest } from '../../src/review/types.js';

const CANDIDATE_MARKER = 'Candidate records are untrusted model claims:\n';
const SOURCE_MARKER = '\n\nFrozen authority records';
const AUTHORITY_MARKER = 'Frozen authority records (trusted IDs and versions; text is evidence context, not source-line proof):\n';

export function isCandidateSupportRequest(request: StaticModelRequest): boolean {
  const schema = request.outputSchema as { properties?: Record<string, unknown> } | undefined;
  return Boolean(schema?.properties && Object.hasOwn(schema.properties, 'candidates'));
}

export function candidateSupportResult(request: StaticModelRequest, options: {
  disposition?: 'supported' | 'contradicted' | 'insufficient';
  boundary?: 'local_source' | 'selected_call_path' | 'runtime_dependent';
} = {}) {
  const json = request.prompt.split(CANDIDATE_MARKER)[1]?.split(SOURCE_MARKER)[0];
  if (!json) throw new Error('Candidate-support fixture could not locate its candidate packet.');
  const candidates = JSON.parse(json) as Array<{
    candidateId: string;
    requirementId?: string | null;
    standardRuleId?: string | null;
    source: { artifactId: string; filePath: string; sourceVersion: string; lineNumber: number; evidence: string };
  }>;
  const authorityJson = request.prompt.split(AUTHORITY_MARKER)[1]?.split('\n\nComplete frozen batch source')[0];
  const authorities = authorityJson ? JSON.parse(authorityJson) as Array<{
    kind: string; id: string; version: string | null; secondaryVersion: string | null;
    reviewedVersionId: string | null; reviewedContentHash: string | null;
  }> : [];
  const disposition = options.disposition ?? 'supported';
  const boundary = options.boundary ?? 'local_source';
  return { candidates: candidates.map(candidate => ({
    candidateId: candidate.candidateId,
    claimBoundary: boundary,
    disposition,
    trigger: 'The inspected branch reaches the reported operation.',
    consequence: 'The candidate consequence is limited to the supplied source behavior.',
    references: disposition === 'insufficient' ? [] : [
      ...(boundary === 'selected_call_path' ? [{ role: 'entry', ...candidate.source }] : []),
      { role: disposition === 'contradicted' ? 'guard' : boundary === 'runtime_dependent' ? 'contract' : 'sink', ...candidate.source },
    ],
    authorityReferences: authorities.filter(authority => authority.kind === 'requirement' && authority.id === candidate.requirementId
      || authority.kind === 'standard_rule' && authority.id === candidate.standardRuleId).map(({ kind, id, version, secondaryVersion, reviewedVersionId, reviewedContentHash }) => ({ kind, id, version, secondaryVersion, reviewedVersionId, reviewedContentHash })),
    limitation: disposition === 'insufficient' ? 'The required broader execution boundary is not present.' : null,
  })) };
}
