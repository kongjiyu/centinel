import fs from 'node:fs/promises';
import path from 'node:path';

// Read only the latest saved captures. No browser credentials, provider access,
// source bodies, raw responses, or historical record updates.
const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Pass a saved evaluation directory.');
const names = (await fs.readdir(directory)).filter(name => /^\d+-.*\.json$/.test(name)).sort();
async function latest(suffixes) {
  const name = names.findLast(name => suffixes.some(suffix => name.endsWith(suffix)));
  return name ? JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) : null;
}
const [session, usage, harness] = await Promise.all([
  latest(['-optimized-session.json', '-optimized-progress.json']),
  latest(['-optimized-usage.json']), latest(['-optimized-harness.json']),
]);
const progress = JSON.parse(session?.data?.progressJson || '{}');
const stage = usage?.data?.reviewUsage?.byStage?.find(row => row.stage === 'model_analysis');
const events = harness?.data?.events ?? [];
const saved = events.filter(event => event.event === 'review_analysis_batch_saved');
process.stdout.write(JSON.stringify({
  reviewId: session?.data?.id ?? null, sessionRecordedAt: session?.recordedAt ?? null,
  status: session?.data?.status ?? null, stage: progress.stage ?? null,
  usageRecordedAt: usage?.recordedAt ?? null, harnessRecordedAt: harness?.recordedAt ?? null,
  providers: usage?.data?.byGroup?.map(row => ({ provider: row.provider, model: row.model,
    calls: row.totalCalls, knownTokens: row.totalTokens, unknownTotalCalls: row.unknownTotalCalls })) ?? [],
  reasoning: stage ? { calls: stage.calls, successfulCalls: stage.successfulCalls, failedCalls: stage.failedCalls,
    uniqueFiles: stage.aiFileCount, fileAppearances: stage.aiFileAppearances,
    phases: stage.phases?.map(row => ({ phase: row.phase, calls: row.calls,
      knownTokens: row.providerReportedTotalTokens, unknownTotalCalls: row.unknownProviderTotalCalls })) } : null,
  distinctBatchesWithSavedEvidence: new Set(saved.map(event => event.detail?.batchId).filter(Boolean)).size,
  plannedBatches: events.find(event => event.event === 'review_batches_planned')?.detail?.batches?.length ?? null,
  assessmentRepairsScheduled: events.filter(event => event.event === 'review_assessment_repair_scheduled').length,
  completeReviewComparison: false,
}, null, 2) + '\n');
