import { findingSourceIdentityHash, type FindingCorrelation, type FindingResolutionEligibility } from './correlation.js';
import { ASSESSMENT_VALIDATION_VERSION } from './assessmentValidation.js';
import type { StaticReviewRecord } from './types.js';
import type { StoreFinding } from '../store/types.js';

export type ProjectFindingForReconciliation = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  artifactId: string | null;
  sourceIdentity?: string | null;
  sourceVersion?: string | null;
  filePath: string;
  lineNumber?: number | null;
  title: string;
  severity: string;
  createdAt: string;
  updatedAt?: string;
};

export type ReconciliationManifest = {
  id: string;
  reviewId: string;
  status: string;
  artifacts: Array<{
    id: string;
    filePath: string;
    originalPath?: string | null;
    contentHash: string;
  }>;
};

export type ProjectFindingResolutionEvidence = {
  status: 'resolved';
  basis: 'not_reproduced_in_comparable_review';
  reviewId: string;
  reviewName: string;
  sourceManifestId: string;
  previousSourceVersion: string;
  reviewedSourceVersion: string;
};

export type ProjectFindingHistoryEntry = {
  findingId: string;
  reviewId: string | null;
  reviewName?: string;
  classification: 'recurring' | 'regressed';
  status: ProjectFindingForReconciliation['status'];
  title: string;
  severity: string;
  sourceVersion?: string | null;
  createdAt: string;
};

export type ReconciledProjectFinding<T extends ProjectFindingForReconciliation = ProjectFindingForReconciliation> = T & {
  resolutionEvidence?: ProjectFindingResolutionEvidence;
  lineageHistory?: ProjectFindingHistoryEntry[];
  latestOccurrence?: { findingId: string; reviewId: string | null; classification: 'recurring' | 'regressed' };
};

type ReconciliationReview = Pick<StaticReviewRecord,
  'id' | 'projectId' | 'name' | 'reviewType' | 'status' | 'modelStatus' | 'scope' | 'config' | 'lineage' | 'iteration' | 'sourceManifestId' | 'createdAt'
>;

type ReconciliationCorrelation = Pick<FindingCorrelation,
  'id' | 'parentReviewId' | 'childReviewId' | 'parentFindingId' | 'childFindingId' | 'classification' | 'resolutionEligibility'
>;

type FindingResolutionMetadata = FindingResolutionEligibility;

const EXECUTED_REVIEW_STATUSES = new Set(['pending_approval', 'completed', 'approved']);
const BASELINE_REVIEW_STATUSES = new Set([...EXECUTED_REVIEW_STATUSES, 'changes_requested']);
const RESOLVABLE_FINDING_STATUSES = new Set<ProjectFindingForReconciliation['status']>(['new', 'carryover']);

function normalizeVersion(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^sha256:/i, '').toLowerCase() : '';
}

function normalizedIds(values?: string[]): string[] {
  return [...new Set((values ?? []).filter(Boolean))].sort();
}

function sameScope(left: StaticReviewRecord['scope'], right: StaticReviewRecord['scope']): boolean {
  return JSON.stringify({
    artifactIds: normalizedIds(left.artifactIds),
    requirementIds: normalizedIds(left.requirementIds),
    standardIds: normalizedIds(left.standardIds),
    sourceIds: normalizedIds(left.sourceIds),
    label: left.label?.trim() ?? '',
  }) === JSON.stringify({
    artifactIds: normalizedIds(right.artifactIds),
    requirementIds: normalizedIds(right.requirementIds),
    standardIds: normalizedIds(right.standardIds),
    sourceIds: normalizedIds(right.sourceIds),
    label: right.label?.trim() ?? '',
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function comparableConfig(value: Record<string, unknown>): string {
  return canonical(value);
}

function manifestHasVersion(manifest: ReconciliationManifest | undefined, artifactId: string, sourceVersion: string): boolean {
  if (!manifest || manifest.status !== 'available' || !manifest.id || !manifest.artifacts.length) return false;
  const normalized = normalizeVersion(sourceVersion);
  return Boolean(normalized && manifest.artifacts.some(artifact => artifact.id === artifactId && normalizeVersion(artifact.contentHash) === normalized));
}

function manifestSourceIdentities(manifest: ReconciliationManifest): string[] | null {
  if (manifest.status !== 'available' || !manifest.artifacts.length) return null;
  const identities = manifest.artifacts.map(artifact => findingSourceIdentityHash({
    artifactId: artifact.id,
    sourceIdentity: artifact.originalPath,
    filePath: artifact.filePath,
  }));
  if (identities.some(identity => !identity)) return null;
  const unique = [...new Set(identities)].sort();
  return unique.length === identities.length ? unique : null;
}

function isComparableExecutedReview(
  parent: ReconciliationReview,
  child: ReconciliationReview,
  parentManifest: ReconciliationManifest,
  childManifest: ReconciliationManifest,
): boolean {
  if (!parent || !child || parent.projectId !== child.projectId) return false;
  // Project reviews can re-check earlier findings without an iteration parent.
  if (parent.id === child.id) return false;
  if (!Number.isFinite(Date.parse(parent.createdAt)) || !Number.isFinite(Date.parse(child.createdAt))) return false;
  if (Date.parse(parent.createdAt) > Date.parse(child.createdAt)
    && (child.iteration?.parentReviewId ?? child.lineage.parentReviewId) !== parent.id) return false;
  if (!BASELINE_REVIEW_STATUSES.has(parent.status) || parent.modelStatus !== 'succeeded') return false;
  if (!EXECUTED_REVIEW_STATUSES.has(child.status) || child.modelStatus !== 'succeeded') return false;
  if (!parent.sourceManifestId || parentManifest?.id !== parent.sourceManifestId || parentManifest.reviewId !== parent.id) return false;
  if (!child.sourceManifestId || childManifest?.id !== child.sourceManifestId || childManifest.reviewId !== child.id) return false;
  return parentManifest.status === 'available' && childManifest.status === 'available';
}

function hasComparableCoverage(parent: ReconciliationReview, child: ReconciliationReview,
  parentManifest: ReconciliationManifest, childManifest: ReconciliationManifest): boolean {
  if (parent.reviewType !== child.reviewType) return false;
  if (!sameScope(parent.scope, child.scope)) return false;
  if (comparableConfig(parent.config) !== comparableConfig(child.config)) return false;
  if ((parent.iteration?.feedback ?? '').trim() !== (child.iteration?.feedback ?? '').trim()) return false;
  const parentSources = manifestSourceIdentities(parentManifest);
  const childSources = manifestSourceIdentities(childManifest);
  return parentSources !== null && childSources !== null && JSON.stringify(parentSources) === JSON.stringify(childSources);
}

function validatedResolution(
  finding: ProjectFindingForReconciliation,
  correlation: ReconciliationCorrelation,
  parent: ReconciliationReview,
  child: ReconciliationReview,
  parentManifest: ReconciliationManifest,
  childManifest: ReconciliationManifest,
  metadata: FindingResolutionMetadata | undefined,
): ProjectFindingResolutionEvidence | undefined {
  if (!metadata || metadata.version !== 2 || metadata.assessmentValidationVersion !== ASSESSMENT_VALIDATION_VERSION || metadata.basis !== 'not_reproduced_in_comparable_review') return undefined;
  const location = metadata.locationBasis;
  if (!location || location.kind !== 'exact_assessed_reference' || location.lineNumber !== finding.lineNumber
    || location.filePath.replace(/\\/g, '/') !== finding.filePath.replace(/\\/g, '/')
    || normalizeVersion(location.sourceVersion) !== normalizeVersion(metadata.reviewedSourceVersion)
    || !location.featureId || !['security', 'business', 'technical', 'personnel'].includes(location.domain)) return undefined;
  if (!finding.artifactId) return undefined;
  const parentArtifact = parentManifest.artifacts.find(artifact => artifact.id === finding.artifactId);
  if (!parentArtifact) return undefined;
  const parentSourceVersion = normalizeVersion(parentArtifact.contentHash);
  const sourceIdentityHash = findingSourceIdentityHash({
    artifactId: finding.artifactId,
    sourceIdentity: finding.sourceIdentity || parentArtifact.originalPath,
    filePath: finding.filePath || parentArtifact.filePath,
  });
  if (!parentSourceVersion || !sourceIdentityHash) return undefined;
  if (finding.sourceVersion && normalizeVersion(finding.sourceVersion) !== parentSourceVersion) return undefined;
  if (metadata.parentSourceManifestId !== parentManifest.id || metadata.sourceManifestId !== childManifest.id) return undefined;
  if (metadata.parentArtifactId !== finding.artifactId || metadata.sourceIdentityHash !== sourceIdentityHash) return undefined;
  if (normalizeVersion(metadata.parentSourceVersion) !== parentSourceVersion) return undefined;
  if (!normalizeVersion(metadata.reviewedSourceVersion) || normalizeVersion(metadata.parentSourceVersion) === normalizeVersion(metadata.reviewedSourceVersion)) return undefined;
  if (!manifestHasVersion(parentManifest, metadata.parentArtifactId, metadata.parentSourceVersion)) return undefined;
  if (!manifestHasVersion(childManifest, metadata.reviewedArtifactId, metadata.reviewedSourceVersion)) return undefined;
  const reviewedArtifact = childManifest.artifacts.find(artifact => artifact.id === metadata.reviewedArtifactId);
  const parentIdentityHash = findingSourceIdentityHash({
    artifactId: metadata.parentArtifactId,
    sourceIdentity: parentArtifact.originalPath,
    filePath: parentArtifact.filePath,
  });
  const childIdentityHash = findingSourceIdentityHash({
    artifactId: metadata.reviewedArtifactId,
    sourceIdentity: reviewedArtifact?.originalPath,
    filePath: reviewedArtifact?.filePath ?? '',
  });
  if (!parentIdentityHash || parentIdentityHash !== metadata.sourceIdentityHash || childIdentityHash !== metadata.sourceIdentityHash) return undefined;
  if (correlation.parentFindingId !== finding.id || correlation.childFindingId !== null) return undefined;
  return {
    status: 'resolved',
    basis: 'not_reproduced_in_comparable_review',
    reviewId: child.id,
    reviewName: child.name,
    sourceManifestId: childManifest.id,
    previousSourceVersion: metadata.parentSourceVersion,
    reviewedSourceVersion: metadata.reviewedSourceVersion,
  };
}

function historyEntry(
  finding: ProjectFindingForReconciliation,
  review: ReconciliationReview | undefined,
  classification: 'recurring' | 'regressed',
): ProjectFindingHistoryEntry {
  return {
    findingId: finding.id,
    reviewId: finding.sessionId,
    ...(review ? { reviewName: review.name } : {}),
    classification,
    status: finding.status,
    title: finding.title,
    severity: finding.severity,
    ...(finding.sourceVersion ? { sourceVersion: finding.sourceVersion } : {}),
    createdAt: finding.createdAt,
  };
}

/**
 * Presents one current project finding per confidently linked lineage while
 * retaining the earlier Review rows as history. A missing/legacy eligibility
 * record, non-successful child, scope/config change, or incomplete manifest
 * leaves the parent row unchanged.
 */
export function reconcileProjectFindings<T extends ProjectFindingForReconciliation>(input: {
  findings: T[];
  reviews: ReconciliationReview[];
  manifests: ReconciliationManifest[];
  correlations: ReconciliationCorrelation[];
  snapshotChildReviewIds: string[];
  ambiguities?: Array<{ childReviewId: string; candidateParentFindingIds: string[] }>;
}): Array<ReconciledProjectFinding<T>> {
  const findingsById = new Map(input.findings.map(finding => [finding.id, finding]));
  const reviewsById = new Map(input.reviews.map(review => [review.id, review]));
  const manifestsById = new Map(input.manifests.map(manifest => [manifest.id, manifest]));
  const snapshottedChildren = new Set(input.snapshotChildReviewIds);
  const latestByParent = new Map<string, { createdAt: number; kind: 'resolved' | 'linked'; childId: string; classification?: 'recurring' | 'regressed'; evidence?: ProjectFindingResolutionEvidence }>();

  for (const correlation of input.correlations) {
    if (!correlation.parentFindingId || !snapshottedChildren.has(correlation.childReviewId)) continue;
    const parentFinding = findingsById.get(correlation.parentFindingId);
    const parentReview = reviewsById.get(correlation.parentReviewId);
    const childReview = reviewsById.get(correlation.childReviewId);
    const parentManifest = parentReview?.sourceManifestId ? manifestsById.get(parentReview.sourceManifestId) : undefined;
    const childManifest = childReview?.sourceManifestId ? manifestsById.get(childReview.sourceManifestId) : undefined;
    if (!parentFinding || parentFinding.source !== 'static') continue;
    // Correlations are durable inputs and may outlive partially migrated or
    // malformed finding rows. Require both the owner and project to agree
    // before allowing either resolution evidence or lineage collapsing.
    if (parentFinding.projectId !== parentReview?.projectId || parentFinding.sessionId !== parentReview?.id) continue;
    if (!parentReview || !childReview || !parentManifest || !childManifest
      || !isComparableExecutedReview(parentReview, childReview, parentManifest, childManifest)) continue;
    const createdAt = Date.parse(childReview.createdAt);
    if (!Number.isFinite(createdAt)) continue;

    if (correlation.classification === 'resolved') {
      if (!RESOLVABLE_FINDING_STATUSES.has(parentFinding.status)) continue;
      if (!hasComparableCoverage(parentReview, childReview, parentManifest, childManifest)) continue;
      if (input.ambiguities?.some(item => item.childReviewId === correlation.childReviewId && item.candidateParentFindingIds.includes(parentFinding.id))) continue;
      const evidence = validatedResolution(parentFinding, correlation, parentReview, childReview, parentManifest!, childManifest!, correlation.resolutionEligibility);
      if (!evidence) continue;
      const existing = latestByParent.get(parentFinding.id);
      if (!existing || createdAt > existing.createdAt) latestByParent.set(parentFinding.id, { createdAt, kind: 'resolved', childId: childReview.id, evidence });
      continue;
    }

    if (correlation.classification !== 'recurring' && correlation.classification !== 'regressed') continue;
    const childFinding = correlation.childFindingId ? findingsById.get(correlation.childFindingId) : undefined;
    if (!childFinding || childFinding.source !== 'static'
      || childFinding.projectId !== childReview.projectId
      || childFinding.sessionId !== childReview.id) continue;
    const existing = latestByParent.get(parentFinding.id);
    if (!existing || createdAt > existing.createdAt) latestByParent.set(parentFinding.id, {
      createdAt,
      kind: 'linked',
      childId: childFinding.id,
      classification: correlation.classification,
    });
  }

  const successorByFindingId = new Map<string, { childId: string; classification: 'recurring' | 'regressed' }>();
  const resolutionByFindingId = new Map<string, ProjectFindingResolutionEvidence>();
  for (const [parentFindingId, relation] of latestByParent) {
    if (relation.kind === 'resolved' && relation.evidence) resolutionByFindingId.set(parentFindingId, relation.evidence);
    if (relation.kind === 'linked' && relation.classification) successorByFindingId.set(parentFindingId, { childId: relation.childId, classification: relation.classification });
  }

  const historyByCurrent = new Map<string, ProjectFindingHistoryEntry[]>();
  const rootByCurrent = new Map<string, string>();
  const classificationByCurrent = new Map<string, 'recurring' | 'regressed'>();
  const predecessorIds = new Set([...successorByFindingId.values()].map(relation => relation.childId));
  const superseded = new Set<string>();
  for (const rootId of successorByFindingId.keys()) {
    if (predecessorIds.has(rootId)) continue;
    let currentId = rootId;
    const visited = new Set<string>();
    const history: ProjectFindingHistoryEntry[] = [];
    let validChain = true;
    while (successorByFindingId.has(currentId)) {
      if (visited.has(currentId)) {
        validChain = false;
        break;
      }
      visited.add(currentId);
      const finding = findingsById.get(currentId);
      const relation = successorByFindingId.get(currentId)!;
      if (!finding || !findingsById.has(relation.childId)) {
        validChain = false;
        break;
      }
      const review = finding.sessionId ? reviewsById.get(finding.sessionId) : undefined;
      history.push(historyEntry(finding, review, relation.classification));
      currentId = relation.childId;
    }
    if (!validChain || !history.length) continue;
    const combined = [...new Map([...(historyByCurrent.get(currentId) ?? []), ...history].map(item => [item.findingId, item])).values()]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    historyByCurrent.set(currentId, combined);
    const previousRootId = rootByCurrent.get(currentId);
    const previousRoot = previousRootId ? findingsById.get(previousRootId)! : null;
    const candidateRoot = findingsById.get(rootId)!;
    if (!previousRoot || Date.parse(candidateRoot.createdAt) < Date.parse(previousRoot.createdAt)
      || candidateRoot.createdAt === previousRoot.createdAt && rootId.localeCompare(previousRoot.id) < 0) rootByCurrent.set(currentId, rootId);
    classificationByCurrent.set(currentId, combined.some(item => item.classification === 'regressed') ? 'regressed' : 'recurring');
    for (const id of visited) superseded.add(id);
  }

  return input.findings
    .filter(finding => !superseded.has(finding.id))
    .map(finding => {
      const rootId = rootByCurrent.get(finding.id);
      const root = rootId ? findingsById.get(rootId)! : finding;
      let status = root.status === 'new' || root.status === 'carryover' ? finding.status : root.status;
      let classification = classificationByCurrent.get(finding.id) ?? 'recurring';
      const decisionAfterOccurrence = Date.parse(root.updatedAt ?? '') >= Date.parse(finding.createdAt);
      if (rootId && root.status === 'fixed' && !decisionAfterOccurrence) classification = 'regressed';
      // Reproduced fixed issues reopen; a later human decision still wins.
      if (rootId && !decisionAfterOccurrence && (status === 'fixed' || classification === 'regressed')) status = finding.status;
      if (rootId) {
        const decision = [...(historyByCurrent.get(finding.id) ?? []).map(item => findingsById.get(item.findingId)!), finding]
          .filter(item => Date.parse(item.updatedAt ?? '') > Date.parse(item.createdAt)
            && Date.parse(item.updatedAt!) >= Date.parse(finding.createdAt))
          .sort((a, b) => Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!))[0];
        if (decision) status = decision.status;
      }
      return {
        ...finding, id: root.id, createdAt: root.createdAt, status,
        ...(rootId ? { latestOccurrence: { findingId: finding.id, reviewId: finding.sessionId, classification } } : {}),
        ...(resolutionByFindingId.has(finding.id) && RESOLVABLE_FINDING_STATUSES.has(status) ? { resolutionEvidence: resolutionByFindingId.get(finding.id) } : {}),
        ...(historyByCurrent.has(finding.id) ? { lineageHistory: historyByCurrent.get(finding.id) } : {}),
      };
    });
}

/** Keep actions on the original finding while presenting the latest evidence. */
export function presentReconciledProjectFindings(findings: StoreFinding[], reconciled: ReconciledProjectFinding[]) {
  const byId = new Map(findings.map(item => [item.id, item]));
  const currentById = new Map(reconciled.map(item => [item.id, item]));
  return findings.flatMap(finding => {
    const current = currentById.get(finding.id);
    if (!current) return [];
    const latest = current.latestOccurrence ? byId.get(current.latestOccurrence.findingId) ?? finding : finding;
    return [{ ...latest, id: current.id, status: current.status, createdAt: current.createdAt,
      updatedAt: Date.parse(finding.updatedAt) > Date.parse(latest.updatedAt) ? finding.updatedAt : latest.updatedAt,
      sessionId: latest.reviewSessionId,
      filePath: typeof latest.location.filePath === 'string' ? latest.location.filePath : '',
      lineNumber: typeof latest.location.lineNumber === 'number' ? latest.location.lineNumber : null,
      fromRemarks: false,
      ...(current.latestOccurrence ? { latestOccurrence: current.latestOccurrence } : {}),
      ...(current.resolutionEvidence ? { resolutionEvidence: current.resolutionEvidence } : {}),
      ...(current.lineageHistory ? { lineageHistory: current.lineageHistory } : {}),
    }];
  });
}
