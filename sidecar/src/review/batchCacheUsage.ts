import { sanitizeReviewRequestUsageContext, reviewSourceFileIdentity, type ReviewSourcePacketReference } from './usageContext.js';

export type ReusedAssessmentUsage = {
  status: 'available' | 'partial' | 'unavailable';
  batchCount: number | null;
  minimumCallsAvoided: number | null;
  originReviewIds: string[];
  uniqueFileCount: number | null;
  files: ReviewSourcePacketReference[];
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Historical validated evidence is not new AI context or new provider usage. */
export function projectBatchCacheUsage(events: Array<{ event_type?: unknown; payload?: unknown }> | null,
  manifest: Map<string, ReviewSourcePacketReference> | null): ReusedAssessmentUsage {
  if (events === null) return { status: 'unavailable', batchCount: null, minimumCallsAvoided: null, originReviewIds: [], uniqueFileCount: null, files: [] };
  const batches = new Map<string, { origin: string; avoided: number }>();
  const files = new Map<string, ReviewSourcePacketReference>();
  let incomplete = false;
  for (const event of events) {
    if (event.event_type !== 'review_batch_cache_reused') continue;
    const detail = object(object(event.payload).detail);
    if (typeof detail.batchId !== 'string' || !detail.batchId || typeof detail.originReviewId !== 'string'
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(detail.originReviewId)
      || detail.providerCallsAvoided !== 1 && detail.providerCallsAvoided !== 2) { incomplete = true; continue; }
    batches.set(detail.batchId, { origin: detail.originReviewId, avoided: detail.providerCallsAvoided });
    const context = sanitizeReviewRequestUsageContext({ phase: 'initial_analysis', sources: detail.sourceReferences, sourcesComplete: true });
    if (!context || context.sourcesComplete === false || !Array.isArray(detail.sourceReferences)
      || context.sources?.length !== detail.sourceReferences.length) incomplete = true;
    for (const source of context?.sources ?? []) {
      const current = manifest?.get(source.artifactId);
      if (!current || source.artifactVersionId !== current.artifactVersionId || source.contentHash !== current.contentHash
        || source.filePath.replace(/\\/g, '/').toLowerCase() !== current.filePath.replace(/\\/g, '/').toLowerCase()) { incomplete = true; continue; }
      const key = reviewSourceFileIdentity(source);
      if (!files.has(key) && files.size >= 10_000) { incomplete = true; continue; }
      files.set(key, { ...source, lineStart: null, lineEnd: null });
    }
  }
  return { status: incomplete ? 'partial' : 'available', batchCount: incomplete ? null : batches.size,
    minimumCallsAvoided: incomplete ? null : [...batches.values()].reduce((sum, item) => sum + item.avoided, 0),
    originReviewIds: [...new Set([...batches.values()].map(item => item.origin))].sort(),
    uniqueFileCount: incomplete ? null : files.size, files: [...files.values()].sort((a, b) => a.filePath.localeCompare(b.filePath)) };
}
