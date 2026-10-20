import { createHash } from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import type { StaticAnalysisModelProvider } from '../review/types.js';
import { assessProjectReadiness } from './engine.js';
import { classifyReadinessFailure } from './failure.js';
import type { ReadinessAssessment, ReadinessInput, ReadinessState } from './types.js';
import { READINESS_EVALUATION_FIXTURES } from './fixtures/index.js';
import type { ReadinessCriterionVerdict, ReadinessEvaluationFixture, ReadinessSemanticCategory } from './fixtures/types.js';

export type ReadinessEvaluationEvidence = { sourceId: string; excerpt: string };

const CRITERIA: Record<ReadinessSemanticCategory, readonly string[]> = {
  requirements: ['clarity', 'consistency', 'testability', 'business_decisions', 'boundaries', 'exceptions', 'scope'],
  design: ['responsibilities', 'interfaces', 'data', 'flows', 'failure_decisions', 'scope'],
  standards: ['applicability', 'checkability', 'conflicts'],
};

const SECRET_LIKE_TEXT = /(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bbearer\s+[A-Za-z0-9._~+/-]{16,}|["']?(?:api[_ -]?key|secret|password|token)["']?\s*[:=]\s*\S+)/i;

type RawCategory = Record<string, unknown>;
type RawCheck = Record<string, unknown>;

export type ReadinessCriterionEvaluation = {
  expected: ReadinessCriterionVerdict;
  raw: ReadinessCriterionVerdict;
  effective: ReadinessCriterionVerdict;
  engineStatus: ReadinessCriterionVerdict | null;
  matches: boolean;
  basisValid: boolean;
  evidenceValid: boolean;
  expectedEvidenceMatched: boolean | null;
};

export type ReadinessCategoryEvaluation = {
  category: ReadinessSemanticCategory;
  expectedState: ReadinessState;
  engineState: ReadinessState | null;
  modelDerivedState: ReadinessState;
  stateMatches: boolean;
  expectedPresence: 'present' | 'missing';
  actualPresence: 'present' | 'missing' | 'unknown';
  presenceMatches: boolean;
  reviewedSourceInventoryValid: boolean;
  classificationBasisValid: boolean;
  classificationEvidenceValid: boolean;
  expectedClassificationEvidenceMatched: boolean | null;
  expectedChecks: Record<string, ReadinessCriterionVerdict>;
  actualChecks: Record<string, ReadinessCriterionEvaluation>;
  scopeCoverageValid: boolean;
  expectedScopeCoverageMatched: boolean | null;
};

export type ReadinessCaseEvaluation = {
  fixtureId: string;
  passed: boolean;
  executionError?: 'provider_or_engine_error';
  failureCode?: ReturnType<typeof classifyReadinessFailure>['code'];
  categories: ReadinessCategoryEvaluation[];
  overclaimedCompleted: ReadinessSemanticCategory[];
  falseMissing: ReadinessSemanticCategory[];
  missedCriteria: Array<{ category: ReadinessSemanticCategory; criterion: string }>;
  criterionMismatchCount: number;
  invalidEvidenceCount: number;
  invalidBasisCount: number;
  goldEvidenceMismatches: Array<{ category: ReadinessSemanticCategory; criterion: string }>;
  engineModelStateMismatch: ReadinessSemanticCategory[];
};

export type ReadinessEvaluationReport = {
  schemaVersion: 1;
  generatedAt: string;
  fixtureCount: number;
  passedCaseCount: number;
  failedCaseCount: number;
  totals: {
    overclaimedCompleted: number;
    falseMissing: number;
    missedCriteria: number;
    criterionMismatches: number;
    invalidEvidence: number;
    invalidBasis: number;
    goldEvidenceMismatches: number;
    engineModelStateMismatches: number;
    executionErrors: number;
  };
  cases: ReadinessCaseEvaluation[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compactSafeText(value: unknown, maxLength = 800): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !SECRET_LIKE_TEXT.test(value)
    && !/\b(?:chain of thought|private reasoning|internal analysis|model thoughts?)\b/i.test(value);
}

function validBasis(value: unknown): value is string {
  return compactSafeText(value, 400) && value.trim().length >= 24;
}

function uniqueRows(value: unknown, key: string): Map<string, RawCategory | RawCheck[]> {
  const result = new Map<string, RawCategory | RawCheck[]>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const row = asRecord(item);
    const id = row?.[key];
    if (typeof id !== 'string') continue;
    const prior = result.get(id);
    if (prior === undefined) result.set(id, row as RawCategory);
    else if (Array.isArray(prior)) prior.push(row as RawCheck);
    else result.set(id, [prior as RawCheck, row as RawCheck]);
  }
  return result;
}

function readRow(map: Map<string, RawCategory | RawCheck[]>, key: string): RawCategory | null {
  const value = map.get(key);
  return value && !Array.isArray(value) ? value : null;
}

function citationRows(value: unknown): ReadinessEvaluationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const row = asRecord(item);
    return row && typeof row.sourceId === 'string' && typeof row.excerpt === 'string'
      ? [{ sourceId: row.sourceId, excerpt: row.excerpt }]
      : [];
  });
}

function citationIsValid(
  citation: ReadinessEvaluationEvidence,
  sourceById: Map<string, ReadinessEvaluationFixture['sources'][number]>,
): boolean {
  const source = sourceById.get(citation.sourceId);
  return !!source
    && citation.excerpt.length > 0
    && citation.excerpt.length <= 800
    && source.content.includes(citation.excerpt)
    && citation.excerpt.length < source.content.length
    && !SECRET_LIKE_TEXT.test(citation.excerpt);
}

function evidenceListIsValid(
  value: unknown,
  sourceById: Map<string, ReadinessEvaluationFixture['sources'][number]>,
): { valid: boolean; validCitations: ReadinessEvaluationEvidence[]; invalidCount: number } {
  if (!Array.isArray(value)) return { valid: false, validCitations: [], invalidCount: value === undefined ? 0 : 1 };
  const rows = citationRows(value);
  const invalidCount = value.length - rows.length + rows.filter(row => !citationIsValid(row, sourceById)).length;
  return {
    valid: value.length > 0 && invalidCount === 0,
    validCitations: rows.filter(row => citationIsValid(row, sourceById)),
    invalidCount,
  };
}

function expectedQuoteMatched(
  expected: readonly ReadinessEvaluationEvidence[] | undefined,
  actual: readonly ReadinessEvaluationEvidence[],
): boolean | null {
  if (!expected?.length) return null;
  return expected.every(item => actual.some(candidate => candidate.sourceId === item.sourceId && candidate.excerpt.includes(item.excerpt)));
}

function validScopeCoverage(
  value: unknown,
  sourceById: Map<string, ReadinessEvaluationFixture['sources'][number]>,
): { valid: boolean; fullyCovered: boolean; invalidCount: number; rows: Array<Record<string, unknown>> } {
  if (!Array.isArray(value) || value.length === 0) return { valid: false, fullyCovered: false, invalidCount: 0, rows: [] };
  let invalidCount = 0;
  const rows = value.flatMap(item => {
    const row = asRecord(item);
    if (!row) {
      invalidCount += 1;
      return [];
    }
    const scopeEvidence = evidenceListIsValid([row.scopeEvidence], sourceById);
    const hasCoverageArray = Array.isArray(row.coverageEvidence);
    const coverageEvidence = evidenceListIsValid(row.coverageEvidence, sourceById);
    invalidCount += scopeEvidence.invalidCount + coverageEvidence.invalidCount;
    const recognizedStatus = row.status === 'covered' || row.status === 'gap' || row.status === 'unknown';
    const coveredWithoutEvidence = row.status === 'covered' && !coverageEvidence.valid;
    if (!compactSafeText(row.scopeItem, 300) || !recognizedStatus || !scopeEvidence.valid || !hasCoverageArray || coveredWithoutEvidence) {
      invalidCount += 1;
    }
    return [row];
  });
  const valid = rows.length > 0 && invalidCount === 0;
  return { valid, fullyCovered: valid && rows.every(row => row.status === 'covered'), invalidCount, rows };
}

function scopeCoverageMatchesExpected(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: ReadinessEvaluationFixture['expected'][ReadinessSemanticCategory]['scopeCoverage'],
): boolean | null {
  if (!expectedRows?.length) return null;
  return expectedRows.every(expected => actualRows.some(row => {
    if (!compactSafeText(row.scopeItem, 300) || row.status !== expected.status) return false;
    const actualScope = citationRows([row.scopeEvidence]);
    const actualCoverage = citationRows(row.coverageEvidence);
    return actualScope.some(item => item.sourceId === expected.scopeEvidence.sourceId && item.excerpt.includes(expected.scopeEvidence.excerpt))
      && expected.coverageEvidence.every(item => actualCoverage.some(candidate => candidate.sourceId === item.sourceId && candidate.excerpt.includes(item.excerpt)));
  }));
}

function reportCheck(
  category: ReadinessSemanticCategory,
  criterion: string,
  rawValue: unknown,
  expectedStatus: ReadinessCriterionVerdict,
  expectedEvidence: readonly ReadinessEvaluationEvidence[] | undefined,
  sourceById: Map<string, ReadinessEvaluationFixture['sources'][number]>,
  scopeCoverageFullyCovered: boolean,
  scopeGapEvidenceValid: boolean,
): { evaluation: ReadinessCriterionEvaluation; invalidEvidenceCount: number; invalidBasisCount: number; missingExpectedEvidence: boolean } {
  const row = asRecord(rawValue);
  const raw: ReadinessCriterionVerdict = row?.status === 'pass' || row?.status === 'gap' || row?.status === 'unknown'
    ? row.status
    : 'unknown';
  const basisValid = validBasis(row?.basis);
  const evidence = evidenceListIsValid(row?.evidence, sourceById);
  const distinctEvidence = new Set(evidence.validCitations.map(item => `${item.sourceId}\u0000${item.excerpt}`)).size;
  const needsTwoQuotes = (category === 'requirements' && criterion === 'consistency')
    || (category === 'standards' && criterion === 'conflicts');
  const evidenceSufficient = evidence.valid && (!needsTwoQuotes || distinctEvidence >= 2);
  const usesScopeCoverage = criterion === 'scope' || (category === 'standards' && criterion === 'applicability');
  const gapEvidenceSufficient = evidence.invalidCount === 0
    && (usesScopeCoverage && scopeGapEvidenceValid
      || (evidence.valid && (!needsTwoQuotes || distinctEvidence >= 2)));
  const effective: ReadinessCriterionVerdict = raw === 'pass'
    && (!basisValid || !evidenceSufficient || (criterion === 'scope' && !scopeCoverageFullyCovered))
    ? 'unknown'
    : raw === 'gap' && (!basisValid || !gapEvidenceSufficient)
      ? 'unknown'
    : raw;
  const expectedEvidenceMatched = expectedQuoteMatched(expectedEvidence, evidence.validCitations);
  return {
    evaluation: {
      expected: expectedStatus,
      raw,
      effective,
      engineStatus: null,
      matches: effective === expectedStatus,
      basisValid,
      evidenceValid: raw === 'pass' ? evidenceSufficient : raw === 'gap' ? gapEvidenceSufficient : evidence.invalidCount === 0,
      expectedEvidenceMatched,
    },
    invalidEvidenceCount: evidence.invalidCount
      + (raw === 'pass' && !evidenceSufficient ? 1 : 0)
      + (raw === 'gap' && !gapEvidenceSufficient ? 1 : 0),
    invalidBasisCount: basisValid ? 0 : 1,
    missingExpectedEvidence: expectedEvidenceMatched === false,
  };
}

function deriveModelState(
  category: ReadinessSemanticCategory,
  categoryRow: RawCategory | null,
  actualChecks: Record<string, ReadinessCriterionEvaluation>,
  expectedCoveragePresent: boolean,
  classificationEvidenceValid: boolean,
  sourceIds: readonly string[],
  allRowsShapeValid: boolean,
): ReadinessState {
  if (!categoryRow || !allRowsShapeValid) return 'incomplete';
  const presence = categoryRow.presence;
  if (presence === 'unknown' || (presence !== 'present' && presence !== 'missing')) return 'incomplete';
  const checks = CRITERIA[category].map(criterion => actualChecks[criterion]);
  if (checks.some(check => !check)) return 'incomplete';
  if (presence === 'missing') {
    const reviewed = Array.isArray(categoryRow.reviewedSourceIds) ? categoryRow.reviewedSourceIds : [];
    const inventoryMatches = reviewed.length === sourceIds.length && sourceIds.every(id => reviewed.includes(id));
    const noClassificationQuotes = citationRows(categoryRow.classificationEvidence).length === 0;
    return inventoryMatches && noClassificationQuotes && checks.every(check => check.effective === 'unknown')
      ? 'missing'
      : 'incomplete';
  }
  if (!validBasis(categoryRow.classificationBasis) || !classificationEvidenceValid || !expectedCoveragePresent) return 'incomplete';
  return checks.every(check => check.effective === 'pass') ? 'completed' : 'incomplete';
}

function evaluateCategory(
  fixture: ReadinessEvaluationFixture,
  category: ReadinessSemanticCategory,
  modelResult: unknown,
  assessment: ReadinessAssessment | null,
  modelRowsShapeValid: boolean,
): { report: ReadinessCategoryEvaluation; invalidEvidenceCount: number; invalidBasisCount: number; goldEvidenceMismatches: Array<{ category: ReadinessSemanticCategory; criterion: string }> } {
  const modelRoot = asRecord(modelResult);
  const rows = Array.isArray(modelRoot?.categories) ? modelRoot.categories : [];
  const categoryRows = rows.map(asRecord).filter((row): row is RawCategory => !!row && row.category === category);
  const categoryRow = categoryRows.length === 1 ? categoryRows[0] : null;
  const checkMap = uniqueRows(categoryRow?.checks, 'criterion');
  const sourceById = new Map(fixture.sources.map(source => [source.sourceId, source]));
  let invalidEvidenceCount = 0;
  let invalidBasisCount = 0;
  const classificationBasisValid = validBasis(categoryRow?.classificationBasis);
  if (!classificationBasisValid) invalidBasisCount += 1;
  const classEvidence = evidenceListIsValid(categoryRow?.classificationEvidence, sourceById);
  invalidEvidenceCount += classEvidence.invalidCount;
  if (categoryRow?.presence === 'present' && !classEvidence.valid) invalidEvidenceCount += 1;

  const expected = fixture.expected[category];
  const expectedClassificationEvidenceMatched = expected.classificationEvidence?.length
    ? expectedQuoteMatched(expected.classificationEvidence, classEvidence.validCitations)
    : null;

  const rawScopeRows = categoryRow?.scopeCoverage;
  const scope = validScopeCoverage(rawScopeRows, sourceById);
  invalidEvidenceCount += scope.invalidCount;
  const expectedScopeCoverageMatched = scopeCoverageMatchesExpected(scope.rows, expected.scopeCoverage);
  const goldEvidenceMismatches: Array<{ category: ReadinessSemanticCategory; criterion: string }> = [];
  if (expectedClassificationEvidenceMatched === false) goldEvidenceMismatches.push({ category, criterion: 'classification' });
  if (expectedScopeCoverageMatched === false) goldEvidenceMismatches.push({ category, criterion: 'scope' });

  const actualChecks: Record<string, ReadinessCriterionEvaluation> = {};
  const engineCategory = assessment?.categories.find(item => item.id === category);
  const engineCriteria = uniqueRows((engineCategory as unknown as { criteria?: unknown } | undefined)?.criteria, 'id');
  for (const criterion of CRITERIA[category]) {
    const match = checkMap.get(criterion);
    const check = Array.isArray(match) ? null : match;
    const isScopeCriterion = criterion === 'scope' || (category === 'standards' && criterion === 'applicability');
    const scopeGapEvidenceValid = isScopeCriterion && scope.valid && scope.rows.some(row => row.status === 'gap');
    const result = reportCheck(category, criterion, check, expected.checks[criterion] ?? 'unknown', expected.evidence?.[criterion], sourceById, scope.fullyCovered, scopeGapEvidenceValid);
    const normalized = engineCriteria.get(criterion);
    const engineStatus = normalized && !Array.isArray(normalized)
      && (normalized.status === 'pass' || normalized.status === 'gap' || normalized.status === 'unknown')
      ? normalized.status
      : null;
    actualChecks[criterion] = {
      ...result.evaluation,
      effective: engineStatus ?? result.evaluation.effective,
      engineStatus,
      matches: (engineStatus ?? result.evaluation.effective) === result.evaluation.expected,
    };
    invalidEvidenceCount += result.invalidEvidenceCount;
    invalidBasisCount += result.invalidBasisCount;
    if (result.missingExpectedEvidence) goldEvidenceMismatches.push({ category, criterion });
  }

  const actualEngine = assessment?.categories.find(item => item.id === category)?.state ?? null;
  const modelDerivedState = deriveModelState(
    category,
    categoryRow,
    actualChecks,
    categoryRow?.presence === 'missing' || scope.fullyCovered,
    classEvidence.valid,
    fixture.sources.map(source => source.sourceId),
    modelRowsShapeValid && categoryRows.length === 1,
  );
  const actualPresence = categoryRow?.presence === 'present' || categoryRow?.presence === 'missing'
    ? categoryRow.presence
    : 'unknown';
  const reviewedSourceIds = Array.isArray(categoryRow?.reviewedSourceIds)
    ? categoryRow.reviewedSourceIds.filter((id): id is string => typeof id === 'string')
    : [];
  const reviewedSourceInventoryValid = reviewedSourceIds.length === fixture.sources.length
    && new Set(reviewedSourceIds).size === reviewedSourceIds.length
    && fixture.sources.every(source => reviewedSourceIds.includes(source.sourceId));
  const classificationEvidenceValid = actualPresence === 'missing'
    ? classEvidence.invalidCount === 0 && classEvidence.validCitations.length === 0
    : classEvidence.valid;

  return {
    report: {
      category,
      expectedState: expected.state,
      engineState: actualEngine,
      modelDerivedState,
      stateMatches: actualEngine === expected.state,
      expectedPresence: expected.presence,
      actualPresence,
      presenceMatches: actualPresence === expected.presence,
      reviewedSourceInventoryValid,
      classificationBasisValid,
      classificationEvidenceValid,
      expectedClassificationEvidenceMatched,
      expectedChecks: expected.checks,
      actualChecks,
      scopeCoverageValid: categoryRow?.presence === 'missing' ? true : scope.valid,
      expectedScopeCoverageMatched,
    },
    invalidEvidenceCount,
    invalidBasisCount,
    goldEvidenceMismatches,
  };
}

export function evaluateReadinessOutcome(
  fixture: ReadinessEvaluationFixture,
  modelResult: unknown,
  assessment: ReadinessAssessment | null,
): ReadinessCaseEvaluation {
  const root = asRecord(modelResult);
  const rows = Array.isArray(root?.categories) ? root.categories : [];
  const seen = rows.map(asRecord).filter(Boolean).map(row => (row as RawCategory).category);
  const modelRowsShapeValid = rows.length === 3
    && seen.length === 3
    && new Set(seen).size === 3
    && (['requirements', 'design', 'standards'] as const).every(category => seen.includes(category));
  const categoryEvaluations = (['requirements', 'design', 'standards'] as const).map(category =>
    evaluateCategory(fixture, category, modelResult, assessment, modelRowsShapeValid));
  const categories = categoryEvaluations.map(item => item.report);
  const overclaimedCompleted = categories
    .filter(item => item.engineState === 'completed' && item.expectedState !== 'completed')
    .map(item => item.category);
  const falseMissing = categories
    .filter(item => item.actualPresence === 'missing' && item.expectedPresence !== 'missing')
    .map(item => item.category);
  const missedCriteria = categories.flatMap(item => Object.entries(item.actualChecks)
    .filter(([, check]) => check.expected === 'gap' && check.effective === 'pass')
    .map(([criterion]) => ({ category: item.category, criterion })));
  const criterionMismatchCount = categories.reduce((sum, item) => sum
    + Object.values(item.actualChecks).filter(check => !check.matches).length, 0);
  const engineModelStateMismatch = categories
    .filter(item => item.engineState !== null && item.engineState !== item.modelDerivedState)
    .map(item => item.category);
  const invalidEvidenceCount = categoryEvaluations.reduce((sum, item) => sum + item.invalidEvidenceCount, 0);
  const invalidBasisCount = categoryEvaluations.reduce((sum, item) => sum + item.invalidBasisCount, 0);
  const goldEvidenceMismatches = categoryEvaluations.flatMap(item => item.goldEvidenceMismatches);
  const passed = !assessment
    ? false
    : categories.every(item => item.stateMatches
      && item.presenceMatches
      && item.reviewedSourceInventoryValid
      && item.classificationBasisValid
      && item.classificationEvidenceValid
      && (fixture.expected[item.category].scopeCoverage?.length ? item.scopeCoverageValid : true))
      && criterionMismatchCount === 0
      && invalidEvidenceCount === 0
      && invalidBasisCount === 0
      && engineModelStateMismatch.length === 0;
  return {
    fixtureId: fixture.id,
    passed,
    ...(assessment ? {} : { executionError: 'provider_or_engine_error' as const }),
    categories,
    overclaimedCompleted,
    falseMissing,
    missedCriteria,
    criterionMismatchCount,
    invalidEvidenceCount,
    invalidBasisCount,
    goldEvidenceMismatches,
    engineModelStateMismatch,
  };
}

export function createReadinessEvaluationReport(
  cases: readonly ReadinessCaseEvaluation[],
  generatedAt = new Date().toISOString(),
): ReadinessEvaluationReport {
  const failed = cases.filter(item => !item.passed);
  return {
    schemaVersion: 1,
    generatedAt,
    fixtureCount: cases.length,
    passedCaseCount: cases.length - failed.length,
    failedCaseCount: failed.length,
    totals: {
      overclaimedCompleted: cases.reduce((sum, item) => sum + item.overclaimedCompleted.length, 0),
      falseMissing: cases.reduce((sum, item) => sum + item.falseMissing.length, 0),
      missedCriteria: cases.reduce((sum, item) => sum + item.missedCriteria.length, 0),
      criterionMismatches: cases.reduce((sum, item) => sum + item.criterionMismatchCount, 0),
      invalidEvidence: cases.reduce((sum, item) => sum + item.invalidEvidenceCount, 0),
      invalidBasis: cases.reduce((sum, item) => sum + item.invalidBasisCount, 0),
      goldEvidenceMismatches: cases.reduce((sum, item) => sum + item.goldEvidenceMismatches.length, 0),
      engineModelStateMismatches: cases.reduce((sum, item) => sum + item.engineModelStateMismatch.length, 0),
      executionErrors: cases.filter(item => item.executionError).length,
    },
    cases: [...cases],
  };
}

export function serializeReadinessEvaluationReport(report: ReadinessEvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

function toReadinessInput(fixture: ReadinessEvaluationFixture): ReadinessInput {
  const projectId = `readiness-eval-${fixture.id}`;
  const artifacts = fixture.sources.map(source => {
    const contentHash = createHash('sha256').update(source.content, 'utf8').digest('hex');
    const artifact: Artifact = {
      id: source.sourceId,
      projectId,
      type: source.artifactType,
      source: source.source,
      fileName: source.fileName,
      filePath: source.filePath,
      originalPath: source.filePath,
      contentHash,
      versionId: 'evaluation-fixture-v1',
      createdAt: '2026-10-19T00:00:00.000Z',
    };
    return { artifact, content: source.content };
  });
  return {
    projectId,
    description: '',
    artifacts,
    sourceFingerprint: createHash('sha256').update(fixture.id, 'utf8').digest('hex'),
  };
}

/**
 * Runs the fixed evaluation corpus through an already configured provider and
 * the production readiness engine. This function never constructs a provider,
 * reads credentials, writes project data, or initializes a CLI runtime.
 */
export async function runReadinessEvaluation(
  provider: Pick<StaticAnalysisModelProvider, 'analyze'>,
  fixtures: readonly ReadinessEvaluationFixture[] = READINESS_EVALUATION_FIXTURES,
  now = () => new Date(),
): Promise<ReadinessEvaluationReport> {
  const results: ReadinessCaseEvaluation[] = [];
  for (const fixture of fixtures) {
    let modelResult: unknown;
    let assessment: ReadinessAssessment | null = null;
    try {
      const capturingProvider: Pick<StaticAnalysisModelProvider, 'analyze'> = {
        analyze: async request => {
          const response = await provider.analyze(request);
          modelResult = response?.result;
          return response;
        },
      };
      assessment = await assessProjectReadiness(toReadinessInput(fixture), capturingProvider);
      results.push(evaluateReadinessOutcome(fixture, modelResult, assessment));
    } catch (error) {
      results.push({ ...evaluateReadinessOutcome(fixture, modelResult, null), failureCode: classifyReadinessFailure(error).code });
    }
  }
  return createReadinessEvaluationReport(results, now().toISOString());
}

export { READINESS_EVALUATION_FIXTURES };
export type { ReadinessEvaluationFixture } from './fixtures/types.js';
