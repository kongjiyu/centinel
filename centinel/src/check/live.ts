import type { ReviewHarnessTrace } from '../reviewHarness';
import { parseReviewProgress } from '../reviewViewModel';
import type { StaticSession } from '../types';

/**
 * What the code review is doing right now, read from its saved progress and
 * harness journal (DESIGN.md §4.2). Nothing here is estimated: the file line is
 * the file of the batch the Review reported starting (review_assessment_batch_started),
 * or, for older Reviews without that event, the entry file of the next planned
 * batch that has not finished. Live problems come from the Review's validated
 * finding events, including locations when the event provides them.
 */
export type ReviewLiveView = {
  stageLabel: string;
  currentFiles: string[];
  batchesDone: number;
  batchesTotal: number | null;
  problems: Array<{ key: string; title: string; location: string | null }>;
};

/** Model analysis runs documents, then behaviours, then remaining files (assessmentPhase). */
const PHASE_TEXT: Record<string, string> = {
  documents: 'Reading the documents',
  behaviors: 'Reading the code',
  environment: 'Checking settings and other files',
};

const STAGE_TEXT: Record<string, string> = {
  starting: 'Getting ready',
  freezing_sources: 'Saving a copy of the files',
  indexing_context: 'Indexing the project',
  deterministic_analysis: 'Running rule checks',
  model_analysis: 'Reading the code',
  persisting_evidence: 'Saving the results',
  provider_paused: 'Paused',
  complete: 'Finished',
};

export function reviewStageLabel(review: StaticSession | null): string {
  if (!review) return 'Getting ready';
  if (review.status === 'queued' || review.status === 'prepared') return 'Waiting to start';
  const progress = parseReviewProgress(review.progressJson) as (ReturnType<typeof parseReviewProgress> & { stage?: string }) | null;
  const stage = progress?.stage ?? progress?.currentStage;
  if (stage === 'model_analysis' && progress?.assessmentPhase && PHASE_TEXT[progress.assessmentPhase]) return PHASE_TEXT[progress.assessmentPhase];
  return (stage && STAGE_TEXT[stage]) || 'Reading the code';
}

type PlannedBatch = { id: string; featureIds: string[] };

export function reviewLiveView(review: StaticSession | null, trace: ReviewHarnessTrace | null): ReviewLiveView {
  const events = trace?.events ?? [];
  let planned: PlannedBatch[] = [];
  const finished = new Set<string>();
  const problems = new Map<string, ReviewLiveView['problems'][number]>();
  let started: { batchId: string; filePath: string | null } | null = null;
  for (const event of events) {
    if (event.reviewId !== review?.id) continue;
    const detail = event.detail ?? {};
    if (event.event === 'review_batches_planned' && Array.isArray(detail.batches)) {
      planned = (detail.batches as unknown[]).flatMap(raw => {
        const batch = raw as { id?: unknown; featureIds?: unknown };
        return typeof batch?.id === 'string' ? [{ id: batch.id, featureIds: Array.isArray(batch.featureIds) ? batch.featureIds.filter((id): id is string => typeof id === 'string') : [] }] : [];
      });
    } else if (event.event === 'review_assessment_batch_started' && typeof detail.batchId === 'string') {
      started = { batchId: detail.batchId, filePath: typeof detail.filePath === 'string' && detail.filePath ? detail.filePath : null };
    } else if (['review_analysis_batch_saved', 'review_analysis_batch_unverified', 'review_batch_cache_reused'].includes(event.event) && typeof detail.batchId === 'string') {
      finished.add(detail.batchId);
    } else if (event.event === 'review_live_finding_titles' && detail.provisional !== true) {
      const rows: unknown[] = Array.isArray(detail.issues) ? detail.issues
        : Array.isArray(detail.titles) ? detail.titles.map(title => ({ title })) : [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const issue = row as { title?: unknown; filePath?: unknown; lineNumber?: unknown };
        if (typeof issue.title !== 'string' || !issue.title.trim()) continue;
        const title = issue.title.trim();
        const location = typeof issue.filePath === 'string' && issue.filePath.trim()
          ? [issue.filePath, typeof issue.lineNumber === 'number' && Number.isSafeInteger(issue.lineNumber) && issue.lineNumber > 0
            ? issue.lineNumber : null].filter(part => part !== null).join(':')
          : null;
        const key = JSON.stringify([title, location]);
        problems.set(key, { key, title, location });
      }
    }
  }
  const features = new Map((trace?.analysisMap?.features ?? []).map(feature => [feature.id, feature]));
  const next = planned.find(batch => !finished.has(batch.id));
  const startedFile = started && !finished.has(started.batchId) ? started.filePath : null;
  const currentFiles = startedFile ? [startedFile] : next ? [...new Set(next.featureIds.flatMap(id => features.get(id)?.entryPoints.map(point => point.filePath) ?? []))].slice(0, 3) : [];
  const running = review ? ['queued', 'prepared', 'running'].includes(review.status) : false;
  return {
    stageLabel: reviewStageLabel(review),
    currentFiles: running ? currentFiles : [],
    batchesDone: planned.filter(batch => finished.has(batch.id)).length,
    batchesTotal: planned.length || null,
    problems: [...problems.values()],
  };
}
