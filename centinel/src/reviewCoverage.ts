import { parseReviewProgress } from './reviewViewModel';
import type { StaticSession } from './types';

/**
 * Completed with gaps (user-approved, 5 November 2026). The sidecar records
 * `progress.coverage = 'partial'` with bounded, safe descriptions of the parts
 * that could not be verified. Those parts never establish a clean result.
 */
export type ReviewUnverifiedReason = 'response_shape' | 'finding_shape' | 'domain_coverage' | 'source_evidence' | 'semantic_support' | 'uncertain_citation' | 'model_timeout';
export type ReviewUnverifiedPart = { reason: ReviewUnverifiedReason; files: string[]; features: string[]; count?: number };
export type ReviewCoverageGaps = { parts: ReviewUnverifiedPart[]; total: number };

const REASON_TEXT: Record<ReviewUnverifiedReason, string> = {
  response_shape: 'the AI answer was not in the expected format',
  finding_shape: 'some reported issues were incomplete',
  domain_coverage: 'not every check area (security, business rules, technical behaviour, human error) was answered',
  source_evidence: 'the quoted code did not match the saved source exactly',
  semantic_support: 'the conclusions could not be backed up with evidence from the code',
  uncertain_citation: 'some issues point to code that could not be matched exactly',
  model_timeout: 'the AI did not answer within the time limit',
};

const strings = (value: unknown, max: number) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()).slice(0, max) : [];

export function reviewCoverageGaps(session: Pick<StaticSession, 'progressJson'>): ReviewCoverageGaps | null {
  const progress = parseReviewProgress(session.progressJson) as unknown as Record<string, unknown> | null;
  if (!progress || progress.coverage !== 'partial') return null;
  const parts = (Array.isArray(progress.unverifiedParts) ? progress.unverifiedParts : []).flatMap((raw): ReviewUnverifiedPart[] => {
    if (!raw || typeof raw !== 'object') return [];
    const part = raw as Record<string, unknown>;
    if (typeof part.reason !== 'string' || !(part.reason in REASON_TEXT)) return [];
    const count = Number.isSafeInteger(part.count) && Number(part.count) > 0 ? Number(part.count) : undefined;
    return [{ reason: part.reason as ReviewUnverifiedReason, files: strings(part.files, 5), features: strings(part.features, 5), ...(count ? { count } : {}) }];
  }).slice(0, 20);
  const total = Number.isSafeInteger(progress.unverifiedPartCount) ? Math.max(Number(progress.unverifiedPartCount), parts.length) : parts.length;
  return { parts, total };
}

export function unverifiedPartLocation(part: ReviewUnverifiedPart): string {
  return part.files.length ? part.files.join(', ') : part.features.length ? part.features.join(', ') : 'Part of the selected code';
}

export function unverifiedPartReason(part: ReviewUnverifiedPart): string {
  const text = REASON_TEXT[part.reason];
  const count = part.reason === 'uncertain_citation' && part.count ? ` (${part.count} issue${part.count === 1 ? '' : 's'})` : '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${count}.`;
}
