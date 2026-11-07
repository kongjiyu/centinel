import { executionTiming, formatReviewDuration } from './reviewNarrative';
import type { HarnessEvent } from './reviewHarness';
import { isExecutedReviewStatus } from './reviewViewModel';
import type { ReviewModelUsage, StaticSession } from './types';

/**
 * What the last finished Review of a project took. Every value comes from a
 * recorded Review; nothing is extrapolated, so the estimate is honest about
 * being "about the same as last time" rather than a prediction.
 */
export type ReviewEstimate =
  | { kind: 'none' }
  | { kind: 'previous'; reviewName: string; finishedAt: string; durationMs: number | null; tokens: number | null; tokensIncomplete: boolean };

function time(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function finishedAt(session: StaticSession): string | null {
  if (session.completedAt) return session.completedAt;
  try {
    const progress = JSON.parse(session.progressJson || '{}') as { stage?: unknown; updatedAt?: unknown };
    if (progress.stage === 'complete' && typeof progress.updatedAt === 'string') return progress.updatedAt;
    // Summary lists carry only the stage; the row's last update is when it finished
    // (or a later decision, which can only lengthen the estimate).
    if (progress.stage === 'complete' && session.updatedAt) return session.updatedAt;
  } catch { /* An unreadable progress record has no finish time. */ }
  return null;
}

/** The most recently finished Review of the project, if any. */
export function latestFinishedReview(sessions: StaticSession[]): StaticSession | null {
  return sessions
    .filter(session => isExecutedReviewStatus(session.status) && finishedAt(session))
    .sort((a, b) => (time(finishedAt(b)) ?? 0) - (time(finishedAt(a)) ?? 0))[0] ?? null;
}

/**
 * The recorded step events, when available, give the active run time: an
 * interrupted Review that resumed hours later is not counted as running while
 * the computer was off. Without events, creation-to-finish is the fallback.
 */
export function buildReviewEstimate(session: StaticSession | null, usage: ReviewModelUsage | null, events?: HarnessEvent[] | null): ReviewEstimate {
  if (!session) return { kind: 'none' };
  const end = finishedAt(session);
  const start = time(session.createdAt);
  const stop = time(end);
  const totals = usage?.totals;
  const tokens = totals ? (totals.accountedTokens ?? totals.totalTokens ?? totals.input + totals.output) : null;
  const activeMs = events?.length ? executionTiming(events, false, Date.now()).ms : null;
  const tokensIncomplete = Boolean(totals && ((totals.unknownTotalCalls ?? 0) > 0 || (totals.unknownInputCalls ?? 0) > 0 || (totals.unknownOutputCalls ?? 0) > 0));
  return {
    kind: 'previous',
    reviewName: session.name,
    finishedAt: end ?? session.updatedAt,
    durationMs: activeMs ?? (start != null && stop != null && stop >= start ? stop - start : null),
    tokens: tokens != null && Number.isFinite(tokens) ? tokens : null,
    tokensIncomplete,
  };
}

function roundTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** One plain sentence for the Start review form. */
export function describeReviewEstimate(estimate: ReviewEstimate): string {
  if (estimate.kind === 'none') return 'This is the first Review of this project, so there is no estimate yet. Small projects usually take a few minutes.';
  const parts: string[] = [];
  if (estimate.durationMs != null) parts.push(`about ${formatReviewDuration(estimate.durationMs)}`);
  if (estimate.tokens != null) parts.push(`${estimate.tokensIncomplete ? 'at least ' : 'about '}${roundTokens(estimate.tokens)} AI tokens`);
  if (!parts.length) return `The last Review, "${estimate.reviewName}", did not record its time or AI usage.`;
  return `Estimate: ${parts.join(' and ')}, based on the last Review of this project ("${estimate.reviewName}"). Changed or added files can take longer.`;
}
