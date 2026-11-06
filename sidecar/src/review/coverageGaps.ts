import type { AssessmentBatch } from './assessmentBatches.js';
import type { InvalidModelAssessmentError } from './assessmentValidation.js';

/**
 * "Completed with gaps" (user-approved amendment, 5 November 2026).
 *
 * A Review whose independent batches produced validated findings or validated
 * assessments, but where some other batches could not be verified, finishes in
 * the normal approval lifecycle instead of `failed`. The unverified parts are
 * recorded here as a bounded list of safe descriptions (reason enums, file
 * paths and operation labels only; never model text or source bodies).
 *
 * This changes the terminal label only. Unverified parts never provide clean
 * completion proof or absence-based resolution: the Review keeps
 * `modelStatus = 'partial'`, which every resolution and baseline path rejects.
 */

export type ReviewUnverifiedReason = InvalidModelAssessmentError['reason'] | 'uncertain_citation' | 'model_timeout';

export type ReviewUnverifiedPart = {
  reason: ReviewUnverifiedReason;
  files: string[];
  features: string[];
  /** Observations in this part whose citations still need verification. */
  count?: number;
};

export type ReviewCoverageProgress = {
  coverage: 'partial';
  unverifiedParts: ReviewUnverifiedPart[];
  unverifiedPartCount: number;
};

export const MAX_UNVERIFIED_PARTS = 20;
const MAX_PART_FILES = 5;
const MAX_PART_FEATURES = 5;
const MAX_LABEL = 120;

const REASONS = new Set<ReviewUnverifiedReason>([
  'response_shape', 'finding_shape', 'domain_coverage', 'source_evidence', 'semantic_support', 'uncertain_citation',
]);

function clip(value: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function unique(values: string[], max: number): string[] {
  return [...new Set(values.map(clip).filter(Boolean))].slice(0, max);
}

export function unverifiedPartForBatch(batch: Pick<AssessmentBatch, 'features' | 'sources'>, reason: ReviewUnverifiedReason, count?: number): ReviewUnverifiedPart {
  return {
    reason,
    files: unique(batch.sources.map(source => source.artifact.filePath), MAX_PART_FILES),
    features: unique(batch.features.map(feature => feature.label), MAX_PART_FEATURES),
    ...(count && count > 0 ? { count } : {}),
  };
}

/**
 * Merge parts that describe the same files for the same reason (a feature
 * packet and its independent whole-file sweep can flag the same observation).
 */
export function coverageProgress(parts: ReviewUnverifiedPart[]): ReviewCoverageProgress {
  const merged = new Map<string, ReviewUnverifiedPart>();
  for (const part of parts) {
    const key = [part.reason, ...[...part.files].sort()].join('\u0000');
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...part, files: [...part.files], features: [...part.features] }); continue; }
    existing.features = unique([...existing.features, ...part.features], MAX_PART_FEATURES);
    const count = Math.max(existing.count ?? 0, part.count ?? 0);
    if (count > 0) existing.count = count;
  }
  const unique_ = [...merged.values()];
  return { coverage: 'partial', unverifiedParts: unique_.slice(0, MAX_UNVERIFIED_PARTS), unverifiedPartCount: unique_.length };
}

/** Defensive reader for persisted progress JSON (reports, older rows). */
export function readCoverageProgress(progress: unknown): ReviewCoverageProgress | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;
  const value = progress as Record<string, unknown>;
  if (value.coverage !== 'partial') return null;
  const parts = Array.isArray(value.unverifiedParts) ? value.unverifiedParts : [];
  const unverifiedParts = parts.flatMap((raw): ReviewUnverifiedPart[] => {
    if (!raw || typeof raw !== 'object') return [];
    const part = raw as Record<string, unknown>;
    const reason = part.reason as ReviewUnverifiedReason;
    if (!REASONS.has(reason)) return [];
    const strings = (input: unknown, max: number) => Array.isArray(input) ? unique(input.filter((item): item is string => typeof item === 'string'), max) : [];
    const count = Number.isSafeInteger(part.count) && Number(part.count) > 0 ? Number(part.count) : undefined;
    return [{ reason, files: strings(part.files, MAX_PART_FILES), features: strings(part.features, MAX_PART_FEATURES), ...(count ? { count } : {}) }];
  }).slice(0, MAX_UNVERIFIED_PARTS);
  const total = Number.isSafeInteger(value.unverifiedPartCount) ? Math.max(Number(value.unverifiedPartCount), unverifiedParts.length) : unverifiedParts.length;
  return { coverage: 'partial', unverifiedParts, unverifiedPartCount: total };
}

const REASON_TEXT: Record<ReviewUnverifiedReason, string> = {
  response_shape: 'the AI answer was not in the expected format',
  finding_shape: 'some reported issues were incomplete',
  domain_coverage: 'not every check area (security, business rules, technical behaviour, human error) was answered',
  source_evidence: 'the quoted code did not match the saved source exactly',
  semantic_support: 'the conclusions could not be backed up with evidence from the code',
  uncertain_citation: 'some issues point to code that could not be matched exactly',
  model_timeout: 'the AI did not answer within the time limit',
};

/** Plain-language description of one unverified part, e.g. for reports. */
export function describeUnverifiedPart(part: ReviewUnverifiedPart): string {
  const where = part.files.length ? part.files.join(', ') : part.features.length ? part.features.join(', ') : 'Part of the selected code';
  const count = part.reason === 'uncertain_citation' && part.count ? ` (${part.count} issue${part.count === 1 ? '' : 's'})` : '';
  return `${where}: ${REASON_TEXT[part.reason]}${count}.`;
}

export const COMPLETED_WITH_GAPS_LABEL = 'Completed with gaps';
