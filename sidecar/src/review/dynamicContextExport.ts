import type { StaticContextFixture } from '../dynamic/testing/staticContextStub.js';

/**
 * Build the versioned Static-to-Dynamic context (PRD §10.1) from a Review's
 * frozen records only: its traceability snapshot and source manifest. Current
 * artifacts are consulted solely to report currency; they never change the
 * requirements or versions that the Review actually assessed.
 */

export type FrozenTraceabilityRecord = {
  requirementId: string;
  title: string;
  description: string;
  state: 'complete' | 'incomplete' | 'missing' | string;
};

export type FrozenManifestArtifact = {
  id: string;
  name: string;
  path: string;
  versionId: string | null;
  contentHash: string;
};

export type ReviewContextInput = {
  projectId: string;
  reviewId: string;
  reviewName: string;
  approved: boolean;
  snapshotCapturedAt: string | null;
  traceabilityAvailable: boolean;
  traceability: FrozenTraceabilityRecord[];
  manifestAvailable: boolean;
  manifest: FrozenManifestArtifact[];
  /** Current artifact content hashes by artifact ID; absent means unavailable now. */
  currentHashes: Map<string, string>;
};

const MAX_SOURCES = 50;
const MAX_REQUIREMENTS = 100;

const bounded = (value: string, limit: number): string => {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
};

export function buildReviewDynamicContext(input: ReviewContextInput): StaticContextFixture {
  const limitations: string[] = [
    'The deployed application version is unknown; a repository revision does not prove what is running.',
  ];
  const requirementsSourceId = `review:${input.reviewId}:requirements`;
  const sources: StaticContextFixture['sources'] = [{
    id: requirementsSourceId,
    version: bounded(input.snapshotCapturedAt || input.reviewId, 200),
    currency: 'current',
    uri: `centinel://projects/${input.projectId}/reviews/${input.reviewId}/traceability`,
  }];

  if (!input.manifestAvailable) limitations.push('The Review source manifest is unavailable, so source versions could not be listed.');
  const manifest = input.manifest.filter(item => item.id);
  for (const artifact of manifest.slice(0, MAX_SOURCES - 1)) {
    const current = input.currentHashes.get(artifact.id);
    const currency = !current || !artifact.contentHash ? 'unknown' : current === artifact.contentHash ? 'current' : 'stale';
    sources.push({
      id: bounded(artifact.id, 200),
      version: bounded(artifact.versionId || artifact.contentHash || 'unrecorded', 200),
      currency,
      uri: bounded(`centinel://projects/${input.projectId}/artifacts/${artifact.id}/${artifact.path || artifact.name}`, 4000),
    });
  }
  if (manifest.length > MAX_SOURCES - 1) limitations.push(`${manifest.length - (MAX_SOURCES - 1)} reviewed sources are omitted from this context; their currency is not shown.`);

  if (!input.traceabilityAvailable) limitations.push('The Review has no traceability snapshot. Confirm requirements and run a new Review to supply requirement criteria.');
  else if (input.traceability.length === 0) limitations.push('The Review captured no requirements. Confirm requirements and run a new Review to supply requirement criteria.');
  const records = input.traceability.filter(record => record.requirementId && (record.title || record.description));
  if (records.length > MAX_REQUIREMENTS) limitations.push(`${records.length - MAX_REQUIREMENTS} requirements are omitted from this context.`);

  const requirements: StaticContextFixture['requirements'] = [];
  const risks: StaticContextFixture['risks'] = [];
  for (const record of records.slice(0, MAX_REQUIREMENTS)) {
    const id = bounded(record.requirementId, 200);
    const description = bounded(record.description ? `${record.title}: ${record.description}` : record.title, 4000);
    // Requirements carry no separate acceptance criteria today, so the
    // requirement statement itself is the single verifiable criterion.
    requirements.push({ id, revision: 1, description, sourceId: requirementsSourceId, criteria: [{ id: bounded(`${record.requirementId}:statement`, 200), description }] });
    if (record.state === 'missing' || record.state === 'incomplete') {
      risks.push({
        id: bounded(`${record.requirementId}:traceability`, 200),
        requirementId: id,
        priority: record.state === 'missing' ? 'high' : 'medium',
        rationale: record.state === 'missing'
          ? 'Static Review found no implementation evidence for this requirement. Runtime behaviour is unverified.'
          : 'Static Review found only partial implementation evidence for this requirement.',
      });
    }
  }
  if (!input.approved) limitations.push('The source Review has not been approved; its findings and traceability are unreviewed.');

  return {
    schemaVersion: 1,
    provenance: 'review-snapshot',
    projectId: input.projectId,
    reviewId: bounded(input.reviewId, 200),
    snapshotId: bounded(`${input.reviewId}:${input.snapshotCapturedAt ?? 'snapshot'}`, 200),
    approvalState: input.approved ? 'approved' : 'pending',
    sources,
    target: { repository: null, commit: null, deploymentVersion: null },
    requirements,
    risks,
    conflicts: [],
    limitations,
  };
}
