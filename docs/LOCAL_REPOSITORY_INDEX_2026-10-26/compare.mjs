import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CASE = Object.freeze({
  projectId: '3c66cb23-9805-471d-97e6-719182787d94',
  instanceId: 'axios__axios-4738',
  repositoryCommit: '9bb016f95e6de871a44f3276fd06562704a0abb0',
  benchmarkRevision: '846e647b9f33c0b51b739d005d13d85493c9af09',
  sourceManifestSha256: '669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64',
  authoritySha256: '29b39ac0614e13edc2fc0c40485d3e38129c5137bd531c2873fd2af97f8ed8df',
  reviewDomains: ['technical', 'security', 'business', 'personnel'],
  selectedFiles: 52,
  selectedCodeFiles: 48,
  goldIssueIds: ['node-timeout-custom-message'],
  precisionMinimum: 0.8,
  evidenceValidityMinimum: 1,
  codeInspectionMinimum: 0.9,
  domainDisclosureMinimum: 1,
  caseGoldRecallMinimum: 0.8,
});

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
const gate = (status, detail) => ({ status, detail });
const SAFE_AUTHORITIES = new Set(['codex', 'owner-scoped-provider', 'local-engine', 'unknown']);
const SAFE_PROVIDERS = new Set(['codex', 'voyage', 'openai-compatible', 'local', 'unknown']);
const SAFE_MODES = new Set(['disabled', 'cold_build', 'warm_reuse', 'restored', 'unknown']);
const SAFE_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'unrated', 'unknown']);
const SAFE_EXECUTION_STATUSES = new Set(['completed', 'partial', 'failed', 'running', 'queued', 'unknown']);
const SAFE_MODEL_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'partial', 'running', 'unknown']);
const SAFE_WORKFLOW_STATUSES = new Set(['pending_approval', 'completed', 'failed', 'partial', 'cancelled', 'running', 'unknown']);
const SAFE_USAGE_STATUSES = new Set(['complete', 'partial', 'failed', 'none', 'unknown']);
const SAFE_EMBEDDING_STATUSES = new Set(['complete', 'partial', 'failed', 'none', 'unknown']);
const SAFE_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'unknown']);
const SAFE_DOMAINS = new Set(CASE.reviewDomains);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(value, pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function knownId(value) {
  const result = safeId(value);
  return result && result !== 'unknown' ? result : null;
}

function safeEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeStageSummaries(stages) {
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) return null;
  const result = {};
  for (const [name, stage] of Object.entries(stages)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || !stage || typeof stage !== 'object') continue;
    result[name] = {
      calls: count(stage.calls, `usage.review.stages.${name}.calls`),
      inputTokens: count(stage.inputTokens, `usage.review.stages.${name}.inputTokens`),
      outputTokens: count(stage.outputTokens, `usage.review.stages.${name}.outputTokens`),
      totalTokens: count(stage.totalTokens, `usage.review.stages.${name}.totalTokens`),
      basis: safeEnum(stage.basis, new Set(['provider-reported usage records', 'provider-reported', 'attempt-number subdivision; not an additional total', 'attempt-subdivision', 'adapter-derived', 'character-estimate'])) ?? null,
    };
  }
  return result;
}

function safeCharacterEstimates(estimates) {
  if (!estimates || typeof estimates !== 'object' || Array.isArray(estimates)) return null;
  return {
    inputCharacters: count(estimates.inputCharacters, 'usage.estimates.inputCharacters'),
    outputCharacters: count(estimates.outputCharacters, 'usage.estimates.outputCharacters'),
  };
}

function count(value, pathName) {
  if (value === null || value === undefined) return null;
  if (!isCount(value)) throw new Error(`${pathName} must be a nonnegative safe integer or null`);
  return value;
}

function safeRatioPair(pair, pathName) {
  if (!pair || typeof pair !== 'object') return { numerator: null, denominator: null, value: null };
  const numerator = count(pair.numerator, `${pathName}.numerator`);
  const denominator = count(pair.denominator, `${pathName}.denominator`);
  if (numerator !== null && denominator !== null && numerator > denominator) {
    throw new Error(`${pathName}.numerator cannot exceed its denominator`);
  }
  return { numerator, denominator, value: numerator !== null && denominator !== null ? ratio(numerator, denominator) : null };
}

function aggregatePredictions(adjudication) {
  const aggregate = adjudication?.predictions?.aggregate;
  if (!aggregate || typeof aggregate !== 'object') return null;
  const tp = count(aggregate.true, 'adjudication.predictions.aggregate.true');
  const fp = count(aggregate.false, 'adjudication.predictions.aggregate.false');
  const unknown = count(aggregate.unknown, 'adjudication.predictions.aggregate.unknown');
  const unadjudicated = count(aggregate.unadjudicated, 'adjudication.predictions.aggregate.unadjudicated');
  if ([tp, fp, unknown, unadjudicated].some(value => value === null)) return null;
  const resolvedDenominator = tp + fp;
  const fullDenominator = resolvedDenominator + unknown + unadjudicated;
  return {
    tp,
    fp,
    unknown,
    unadjudicated,
    resolvedPrecision: ratio(tp, resolvedDenominator),
    conservativePrecision: ratio(tp, fullDenominator),
    optimisticPrecision: ratio(tp + unknown + unadjudicated, fullDenominator),
    totalUniquePredictions: fullDenominator,
  };
}

function summarizeGold(gold) {
  if (!gold || typeof gold !== 'object' || !Array.isArray(gold.issues)) {
    return {
      status: 'unknown',
      issueHits: null,
      issueDenominator: CASE.goldIssueIds.length,
      occurrenceHits: null,
      occurrenceDenominator: null,
      issueRecall: null,
      occurrenceRecall: null,
      issues: [],
    };
  }

  const issues = gold.issues.map((issue, index) => {
    const hitOccurrences = count(issue.hitOccurrences, `adjudication.gold.issues[${index}].hitOccurrences`);
    const expectedOccurrences = count(issue.expectedOccurrences, `adjudication.gold.issues[${index}].expectedOccurrences`);
    return {
      id: CASE.goldIssueIds.includes(issue.id) ? issue.id : null,
      eligible: issue.eligible === true,
      status: ['hit', 'miss', 'unknown'].includes(issue.status) ? issue.status : 'unknown',
      hitOccurrences,
      expectedOccurrences,
      severity: safeEnum(issue.severity, SAFE_SEVERITIES) ?? 'unrated',
      sourceBackedExplanation: issue.sourceBackedExplanation === true,
    };
  });

  const byId = new Map(issues.map(issue => [issue.id, issue]));
  const exactInventory = issues.length === CASE.goldIssueIds.length
    && CASE.goldIssueIds.every(id => byId.has(id))
    && new Set(issues.map(issue => issue.id)).size === issues.length;
  const complete = gold.status === 'complete' && exactInventory && issues.every(issue => issue.eligible);
  const knownHits = exactInventory && issues.every(issue => issue.status !== 'unknown'
    && issue.hitOccurrences !== null && issue.expectedOccurrences !== null);
  if (issues.some(issue => issue.hitOccurrences !== null && issue.expectedOccurrences !== null
      && issue.hitOccurrences > issue.expectedOccurrences)) {
    throw new Error('adjudication.gold hitOccurrences cannot exceed expectedOccurrences');
  }
  const issueHits = knownHits ? issues.filter(issue => issue.status === 'hit').length : null;
  const occurrenceHits = knownHits ? issues.reduce((sum, issue) => sum + issue.hitOccurrences, 0) : null;
  const occurrenceDenominator = exactInventory && issues.every(issue => issue.expectedOccurrences !== null)
    ? issues.reduce((sum, issue) => sum + issue.expectedOccurrences, 0)
    : null;
  const highCritical = summarizeHighCritical(gold.severityInventory, byId);

  return {
    status: complete && knownHits ? 'complete' : 'unknown',
    issueHits,
    issueDenominator: exactInventory ? issues.length : CASE.goldIssueIds.length,
    occurrenceHits,
    occurrenceDenominator,
    issueRecall: issueHits === null ? null : ratio(issueHits, issues.length),
    occurrenceRecall: occurrenceHits === null ? null : ratio(occurrenceHits, occurrenceDenominator),
    issues,
    highCritical,
  };
}

function summarizeHighCritical(inventory, issuesById) {
  if (!inventory || inventory.status !== 'complete' || !Array.isArray(inventory.issueIds)) {
    return { status: 'unavailable', issueIds: null, retainedIds: null, recall: null };
  }
  if (inventory.issueIds.length === 0 || inventory.issueIds.some(id => !CASE.goldIssueIds.includes(id))) {
    return { status: 'invalid-inventory', issueIds: null, retainedIds: null, recall: null };
  }
  const issueIds = [...new Set(inventory.issueIds)];
  const retainedIds = issueIds.filter(id => {
    const issue = issuesById.get(id);
    return issue && (issue.status === 'hit' || issue.sourceBackedExplanation);
  });
  const inventoryValid = issueIds.length === inventory.issueIds.length
    && issueIds.every(id => CASE.goldIssueIds.includes(id));
  return {
    status: inventoryValid ? (retainedIds.length === issueIds.length ? 'complete' : 'failed') : 'invalid-inventory',
    issueIds,
    retainedIds,
    recall: inventoryValid ? ratio(retainedIds.length, issueIds.length) : null,
  };
}

function summarizeUsage(run) {
  const review = run.usage?.review;
  const embedding = run.usage?.embedding;
  const reviewInput = count(review?.reported?.inputTokens, 'usage.review.reported.inputTokens');
  const reviewOutput = count(review?.reported?.outputTokens, 'usage.review.reported.outputTokens');
  const unknownReviewCalls = count(review?.requests?.unknownUsage, 'usage.review.requests.unknownUsage');
  const reviewCalls = count(review?.requests?.total, 'usage.review.requests.total');
  const successfulCalls = count(review?.requests?.successful, 'usage.review.requests.successful');
  const failedCalls = count(review?.requests?.failed, 'usage.review.requests.failed');
  const reviewReportedComplete = review?.status === 'complete'
    && reviewInput !== null && reviewOutput !== null && unknownReviewCalls === 0
    && reviewCalls !== null && successfulCalls !== null && failedCalls !== null
    && reviewCalls === successfulCalls + failedCalls;
  const reviewTokens = reviewReportedComplete ? reviewInput + reviewOutput : null;

  let documentTokens = null;
  let queryTokens = null;
  let embeddingTokens = null;
  let embeddingComplete = false;
  const documentRequests = count(embedding?.documentRequests, 'usage.embedding.documentRequests');
  const queryRequests = count(embedding?.queryRequests, 'usage.embedding.queryRequests');
  if (embedding?.status === 'none') {
    const noRequests = documentRequests === 0 && queryRequests === 0
      && count(embedding?.unknownRequests, 'usage.embedding.unknownRequests') === 0
      && count(embedding?.documentTokens, 'usage.embedding.documentTokens') === 0
      && count(embedding?.queryTokens, 'usage.embedding.queryTokens') === 0;
    if (noRequests) {
      documentTokens = 0;
      queryTokens = 0;
      embeddingTokens = 0;
      embeddingComplete = true;
    }
  } else if (embedding?.status === 'complete') {
    documentTokens = count(embedding.documentTokens, 'usage.embedding.documentTokens');
    queryTokens = count(embedding.queryTokens, 'usage.embedding.queryTokens');
    const unknownRequests = count(embedding.unknownRequests, 'usage.embedding.unknownRequests');
    if (unknownRequests === 0 && documentRequests !== null && queryRequests !== null
        && documentTokens !== null && queryTokens !== null) {
      embeddingTokens = documentTokens + queryTokens;
      embeddingComplete = true;
    }
  }

  const complete = reviewReportedComplete && embeddingComplete && run.execution?.status === 'completed';
  return {
    status: complete ? 'complete' : 'incomplete',
    review: {
      status: safeEnum(review?.status, SAFE_USAGE_STATUSES) ?? 'unknown',
      calls: reviewCalls,
      successfulCalls,
      failedCalls,
      unknownUsageCalls: unknownReviewCalls,
      inputTokens: reviewInput,
      outputTokens: reviewOutput,
      totalTokens: reviewTokens,
      cacheReadTokens: count(review?.reported?.cacheReadTokens, 'usage.review.reported.cacheReadTokens'),
      cacheCreationTokens: count(review?.reported?.cacheCreationTokens, 'usage.review.reported.cacheCreationTokens'),
      stages: safeStageSummaries(review?.stages),
    },
    embedding: {
      status: safeEnum(embedding?.status, SAFE_EMBEDDING_STATUSES) ?? 'unknown',
      documentRequests,
      queryRequests,
      documentTokens,
      queryTokens,
      totalTokens: embeddingTokens,
    },
    combinedProviderTokens: complete ? reviewTokens + embeddingTokens : null,
    estimates: safeCharacterEstimates(run.usage?.estimates),
  };
}

function summarizeCoverage(run) {
  const selected = run.coverage?.selectedSource;
  const domains = run.coverage?.featureDomains;
  const selectedFiles = count(selected?.expectedFiles, 'coverage.selectedSource.expectedFiles');
  const importedFiles = count(selected?.importedFiles, 'coverage.selectedSource.importedFiles');
  const sourceSweepFiles = count(selected?.sourceSweepFiles, 'coverage.selectedSource.sourceSweepFiles');
  const codeFiles = count(selected?.codeFiles, 'coverage.selectedSource.codeFiles');
  const inspectedCodeFiles = count(selected?.inspectedCodeFiles, 'coverage.selectedSource.inspectedCodeFiles');
  const codeCoverage = codeFiles !== null && inspectedCodeFiles !== null ? ratio(inspectedCodeFiles, codeFiles) : null;
  const inferredPairs = count(domains?.inferredPairs, 'coverage.featureDomains.inferredPairs');
  const disclosedPairs = count(domains?.disclosedPairs, 'coverage.featureDomains.disclosedPairs');
  const validatedPairs = count(domains?.validatedPairs, 'coverage.featureDomains.validatedPairs');
  const supportedPairs = count(domains?.supportedPairs, 'coverage.featureDomains.supportedPairs');
  const boundedCounts = [
    [importedFiles, selectedFiles, 'coverage.selectedSource.importedFiles'],
    [sourceSweepFiles, selectedFiles, 'coverage.selectedSource.sourceSweepFiles'],
    [codeFiles, selectedFiles, 'coverage.selectedSource.codeFiles'],
    [inspectedCodeFiles, codeFiles, 'coverage.selectedSource.inspectedCodeFiles'],
    [disclosedPairs, inferredPairs, 'coverage.featureDomains.disclosedPairs'],
    [validatedPairs, disclosedPairs, 'coverage.featureDomains.validatedPairs'],
    [supportedPairs, validatedPairs, 'coverage.featureDomains.supportedPairs'],
  ];
  for (const [numerator, denominator, label] of boundedCounts) {
    if (numerator !== null && denominator !== null && numerator > denominator) {
      throw new Error(`${label} cannot exceed its denominator`);
    }
  }
  const disclosure = inferredPairs !== null && disclosedPairs !== null ? ratio(disclosedPairs, inferredPairs) : null;
  const supported = inferredPairs !== null && supportedPairs !== null ? ratio(supportedPairs, inferredPairs) : null;
  const retrieval = run.coverage?.retrieval ?? {};
  const required = [selectedFiles, importedFiles, sourceSweepFiles, codeFiles, inspectedCodeFiles,
    inferredPairs, disclosedPairs, validatedPairs];
  const complete = required.every(value => value !== null)
    && typeof selected?.goldAffectedFilesInspected === 'boolean'
    && typeof selected?.allSourceSweepsComplete === 'boolean';
  return {
    status: complete ? 'complete' : 'unknown',
    source: {
      selectedFiles,
      importedFiles,
      sourceSweepFiles,
      codeFiles,
      inspectedCodeFiles,
      codeInspectionRatio: codeCoverage,
      goldAffectedFilesInspected: typeof selected?.goldAffectedFilesInspected === 'boolean' ? selected.goldAffectedFilesInspected : null,
      allSourceSweepsComplete: typeof selected?.allSourceSweepsComplete === 'boolean' ? selected.allSourceSweepsComplete : null,
    },
    domains: {
      inferredPairs,
      disclosedPairs,
      validatedPairs,
      supportedPairs,
      disclosureRatio: disclosure,
      supportedClaimCoverage: supported,
      explicitUnverifiedBoundaries: count(domains?.explicitUnverifiedBoundaries, 'coverage.featureDomains.explicitUnverifiedBoundaries'),
    },
    retrieval: {
      packetRequests: count(retrieval.packetRequests, 'coverage.retrieval.packetRequests'),
      sourceAppearances: count(retrieval.sourceAppearances, 'coverage.retrieval.sourceAppearances'),
      uniqueFiles: count(retrieval.uniqueFiles, 'coverage.retrieval.uniqueFiles'),
      uniqueChunks: count(retrieval.uniqueChunks, 'coverage.retrieval.uniqueChunks'),
      contextCharacters: count(retrieval.contextCharacters, 'coverage.retrieval.contextCharacters'),
      goldSupportRanges: safeRatioPair(retrieval.goldSupportRanges, 'coverage.retrieval.goldSupportRanges'),
    },
  };
}

function summarizeRun(run, { requireIndexIntervention = false } = {}) {
  if (!run || run.schemaVersion !== 'centinel-local-index-evaluation-run-v1') {
    throw new Error('run must use centinel-local-index-evaluation-run-v1');
  }
  const executionStatus = safeEnum(run.execution?.status, SAFE_EXECUTION_STATUSES) ?? 'unknown';
  const modelStatus = safeEnum(run.execution?.modelStatus, SAFE_MODEL_STATUSES) ?? 'unknown';
  const executionGate = executionStatus === 'completed' && modelStatus === 'succeeded'
    ? gate('pass', 'Review completed and model execution succeeded.')
    : ['failed', 'partial'].includes(executionStatus) || ['failed', 'blocked'].includes(modelStatus)
      ? gate('fail', `Execution status is ${executionStatus}/${modelStatus}.`)
      : gate('unknown', `Execution status is ${executionStatus}/${modelStatus}.`);

  const predictionCounts = aggregatePredictions(run.adjudication);
  const adjudicationStatus = run.adjudication?.status === 'complete' ? 'complete' : 'unknown';
  const adjudicationComplete = adjudicationStatus === 'complete' && predictionCounts !== null;
  const precisionDefined = predictionCounts?.resolvedPrecision !== null && predictionCounts?.resolvedPrecision !== undefined;
  const precisionGate = !adjudicationComplete
    ? gate('unknown', 'Independent adjudication or prediction counts are incomplete.')
    : !precisionDefined
      ? gate('fail', 'Precision is undefined because there are no resolved unique predictions.')
      : predictionCounts.unadjudicated > 0 || predictionCounts.unknown > 0
        ? gate('fail', `${predictionCounts.unadjudicated} unadjudicated and ${predictionCounts.unknown} unresolved unique predictions remain.`)
        : predictionCounts.resolvedPrecision >= CASE.precisionMinimum
          ? gate('pass', `Unique precision ${(predictionCounts.resolvedPrecision * 100).toFixed(2)}% meets the frozen 80% threshold.`)
          : gate('fail', `Unique precision ${(predictionCounts.resolvedPrecision * 100).toFixed(2)}% is below the frozen 80% threshold.`);

  const gold = summarizeGold(run.adjudication?.gold);
  const goldGate = gold.status !== 'complete'
    ? gate('unknown', 'The independent adjudication does not cover the exact eligible Axios gold inventory.')
    : gold.issueRecall >= CASE.caseGoldRecallMinimum && gold.occurrenceRecall >= CASE.caseGoldRecallMinimum
      ? gate('pass', 'All eligible registered Axios gold issues and occurrences are retained.')
      : gate('fail', 'One or more eligible registered Axios gold issues or occurrences were missed.');

  const evidence = run.adjudication?.references;
  const references = evidence && typeof evidence === 'object'
    ? { valid: count(evidence.valid, 'adjudication.references.valid'), total: count(evidence.total, 'adjudication.references.total') }
    : { valid: null, total: null };
  if (references.valid !== null && references.total !== null && references.valid > references.total) {
    throw new Error('adjudication.references.valid cannot exceed total');
  }
  const evidenceRatio = references.valid !== null && references.total !== null ? ratio(references.valid, references.total) : null;
  const evidenceGate = evidenceRatio === null
    ? gate('unknown', 'Exact frozen-source reference validation is missing or has a zero denominator.')
    : evidenceRatio >= CASE.evidenceValidityMinimum
      ? gate('pass', 'Every independently checked citation resolves exactly in frozen source.')
      : gate('fail', 'One or more asserted source references failed exact frozen-source validation.');

  const coverage = summarizeCoverage(run);
  const sourceGate = coverage.status !== 'complete'
    ? gate('unknown', 'Source and domain coverage counts are incomplete.')
    : coverage.source.selectedFiles !== CASE.selectedFiles
      || coverage.source.importedFiles !== CASE.selectedFiles
      || coverage.source.sourceSweepFiles !== CASE.selectedFiles
      || coverage.source.codeFiles !== CASE.selectedCodeFiles
      || !coverage.source.allSourceSweepsComplete
      ? gate('fail', 'The run did not complete the exact 52-file frozen-source sweep.')
      : coverage.source.codeInspectionRatio < CASE.codeInspectionMinimum
        || !coverage.source.goldAffectedFilesInspected
        ? gate('fail', 'Selected-code inspection is below 90% or the registered gold file was not inspected.')
        : coverage.domains.disclosureRatio === null
          ? gate('unknown', 'Feature/domain disclosure coverage is unavailable.')
          : coverage.domains.disclosureRatio < CASE.domainDisclosureMinimum
            || coverage.domains.validatedPairs !== coverage.domains.disclosedPairs
            ? gate('fail', 'Every inferred feature/domain pair must have a validated disclosed row.')
            : gate('pass', 'Frozen source sweeps, selected-code inspection and domain-row disclosure meet the case gates.');

  const indexMode = safeEnum(run.retrieval?.mode, SAFE_MODES) ?? 'unknown';
  const indexPackageVersion = knownId(run.retrieval?.packageVersion);
  const indexStrategyVersion = knownId(run.retrieval?.strategyVersion);
  const indexSourceManifest = safeId(run.retrieval?.sourceManifestSha256, SHA256_PATTERN);
  const indexCompatible = run.retrieval?.compatibilityVerified === true;
  const indexGate = !requireIndexIntervention
    ? gate('pass', 'Historical no-index baseline recorded as the control run.')
    : indexMode === 'disabled'
      ? gate('fail', 'The candidate did not use the local repository index.')
      : indexMode === 'unknown' || indexPackageVersion === null || indexStrategyVersion === null
          || indexSourceManifest === null || typeof run.retrieval?.compatibilityVerified !== 'boolean'
        ? gate('unknown', 'Index mode, package/strategy version, source manifest or compatibility verification is missing.')
        : indexSourceManifest !== CASE.sourceManifestSha256
          ? gate('fail', 'The local index was not built from the pinned Axios source manifest.')
          : !indexCompatible
            ? gate('fail', 'Index/source compatibility was not independently verified.')
            : gate('pass', 'The candidate used a versioned local index verified against the pinned Axios source.');

  let inputGate;
  if (run.projectId !== CASE.projectId || run.instanceId !== CASE.instanceId) {
    inputGate = gate('fail', 'Project or frozen corpus instance does not match the registered Axios case.');
  } else if (run.freeze?.source?.repositoryCommit == null
      || run.freeze?.source?.benchmarkRevision == null
      || run.freeze?.source?.manifestSha256 == null
      || run.freeze?.source?.selectedFiles == null
      || run.freeze?.source?.codeFiles == null
      || run.freeze?.authority?.sha256 == null) {
    inputGate = gate('unknown', 'Pinned source or authority provenance is incomplete.');
  } else if (run.freeze.source.repositoryCommit !== CASE.repositoryCommit
      || run.freeze.source.benchmarkRevision !== CASE.benchmarkRevision
      || run.freeze.source.manifestSha256 !== CASE.sourceManifestSha256
      || run.freeze.source.selectedFiles !== CASE.selectedFiles
      || run.freeze.source.codeFiles !== CASE.selectedCodeFiles
      || run.freeze.authority.sha256 !== CASE.authoritySha256) {
    inputGate = gate('fail', 'The candidate does not match the pinned Axios source manifest and authority snapshot.');
  } else if (!Array.isArray(run.freeze?.reviewDomains)
      || run.freeze.reviewDomains.length !== CASE.reviewDomains.length
      || CASE.reviewDomains.some((domain, index) => run.freeze.reviewDomains[index] !== domain)) {
    inputGate = gate('fail', 'The candidate does not use the frozen four review domains.');
  } else if (!safeEnum(run.freeze?.model?.provider, SAFE_PROVIDERS)
      || run.freeze.model.provider === 'unknown'
      || knownId(run.freeze?.model?.model) === null
      || !safeEnum(run.freeze?.model?.authority, SAFE_AUTHORITIES)
      || run.freeze.model.authority === 'unknown'
      || !safeEnum(run.freeze?.model?.reasoningEffort, SAFE_REASONING_EFFORTS)
      || run.freeze.model.reasoningEffort === 'unknown'
      || knownId(run.freeze?.policyVersion) === null
      || !SHA256_PATTERN.test(run.freeze?.instructionsSha256 ?? '')
      || !SHA256_PATTERN.test(run.freeze?.runtimeManifestSha256 ?? '')) {
    inputGate = gate('unknown', 'Model, policy, instructions or runtime provenance is missing or unsafe.');
  } else {
    inputGate = gate('pass', 'Project and pinned source manifest match the registered Axios case.');
  }

  const gates = {
    execution: executionGate,
    frozenInputs: inputGate,
    retrievalIntervention: indexGate,
    adjudicationPrecision: precisionGate,
    registeredGold: goldGate,
    evidenceReferences: evidenceGate,
    coverage: sourceGate,
  };
  const gateStatuses = Object.values(gates).map(value => value.status);
  const status = gateStatuses.includes('fail') ? 'fail' : gateStatuses.includes('unknown') ? 'unknown' : 'pass';

  return {
    runId: safeId(run.execution?.reviewId, UUID_PATTERN),
    execution: {
      status: executionStatus,
      modelStatus,
      workflowStatus: safeEnum(run.execution?.workflowStatus, SAFE_WORKFLOW_STATUSES) ?? 'unknown',
    },
    gates,
    semanticStatus: status,
    precision: predictionCounts,
    evidence: {
      exactReferences: { ...references, accuracy: evidenceRatio },
      causalClaims: predictionCounts ? {
        supported: predictionCounts.tp,
        contradicted: predictionCounts.fp,
        unresolved: predictionCounts.unknown,
        unadjudicated: predictionCounts.unadjudicated,
        conservativeAccuracy: predictionCounts.conservativePrecision,
      } : null,
    },
    gold,
    coverage,
    usage: summarizeUsage(run),
    dimensions: {
      provider: safeEnum(run.freeze?.model?.provider, SAFE_PROVIDERS),
      model: safeId(run.freeze?.model?.model),
      modelAuthority: safeEnum(run.freeze?.model?.authority, SAFE_AUTHORITIES),
      reasoningEffort: safeEnum(run.freeze?.model?.reasoningEffort, SAFE_REASONING_EFFORTS),
      policyVersion: safeId(run.freeze?.policyVersion),
      instructionsSha256: safeId(run.freeze?.instructionsSha256, SHA256_PATTERN),
      sourceManifestSha256: safeId(run.freeze?.source?.manifestSha256, SHA256_PATTERN),
      authoritySha256: safeId(run.freeze?.authority?.sha256, SHA256_PATTERN),
      runtimeManifestSha256: safeId(run.freeze?.runtimeManifestSha256, SHA256_PATTERN),
      indexMode: safeEnum(run.retrieval?.mode, SAFE_MODES) ?? 'unknown',
      indexPackageVersion: safeId(run.retrieval?.packageVersion),
      indexStrategyVersion: safeId(run.retrieval?.strategyVersion),
      indexSourceManifestSha256: safeId(run.retrieval?.sourceManifestSha256, SHA256_PATTERN),
      indexCompatibilityVerified: typeof run.retrieval?.compatibilityVerified === 'boolean'
        ? run.retrieval.compatibilityVerified : null,
      embeddingModel: safeId(run.retrieval?.embeddingModel),
      embeddingDimensions: count(run.retrieval?.embeddingDimensions, 'retrieval.embeddingDimensions'),
    },
  };
}

function compareDimensions(baseline, candidate) {
  const normalize = (run, dimension) => {
    switch (dimension) {
      case 'projectId': return safeId(run.projectId, UUID_PATTERN);
      case 'instanceId': return safeId(run.instanceId);
      case 'repositoryCommit': return safeId(run.freeze?.source?.repositoryCommit, /^[0-9a-f]{40}$/i);
      case 'sourceManifestSha256': return safeId(run.freeze?.source?.manifestSha256, SHA256_PATTERN);
      case 'authoritySha256': return safeId(run.freeze?.authority?.sha256, SHA256_PATTERN);
      case 'instructionsSha256': return safeId(run.freeze?.instructionsSha256, SHA256_PATTERN);
      case 'runtimeManifestSha256': return safeId(run.freeze?.runtimeManifestSha256, SHA256_PATTERN);
      case 'provider': return safeEnum(run.freeze?.model?.provider, SAFE_PROVIDERS);
      case 'model': return safeId(run.freeze?.model?.model);
      case 'modelAuthority': return safeEnum(run.freeze?.model?.authority, SAFE_AUTHORITIES);
      case 'reasoningEffort': return safeEnum(run.freeze?.model?.reasoningEffort, SAFE_REASONING_EFFORTS);
      case 'policyVersion': return safeId(run.freeze?.policyVersion);
      case 'reviewDomains': {
        const domains = run.freeze?.reviewDomains;
        return Array.isArray(domains) && domains.every(domain => SAFE_DOMAINS.has(domain))
          ? [...domains].sort().join(',') : null;
      }
      default: return null;
    }
  };
  const dimensions = [
    'projectId', 'instanceId', 'repositoryCommit', 'sourceManifestSha256', 'authoritySha256',
    'instructionsSha256', 'runtimeManifestSha256', 'provider', 'model', 'modelAuthority',
    'reasoningEffort', 'policyVersion', 'reviewDomains',
  ];
  const pairs = dimensions.map(dimension => [dimension, normalize(baseline, dimension), normalize(candidate, dimension)]);
  return pairs.flatMap(([dimension, before, after]) => {
    if (before === null || before === undefined || after === null || after === undefined) {
      return [{ dimension, status: 'unavailable', baseline: before ?? null, candidate: after ?? null }];
    }
    return before === after ? [] : [{ dimension, status: 'changed', baseline: before, candidate: after }];
  });
}

function delta(before, after) {
  return before !== null && before !== undefined && after !== null && after !== undefined
    ? after - before
    : null;
}

export function compareRuns(baseline, candidate) {
  const baselineSummary = summarizeRun(baseline);
  const candidateSummary = summarizeRun(candidate, { requireIndexIntervention: true });
  const confounds = compareDimensions(baseline, candidate);
  const baselineUsage = baselineSummary.usage;
  const candidateUsage = candidateSummary.usage;
  const usageComparable = baselineUsage.status === 'complete' && candidateUsage.status === 'complete';
  const baseTokens = baselineUsage.combinedProviderTokens;
  const candidateTokens = candidateUsage.combinedProviderTokens;
  const tokenDelta = usageComparable ? delta(baseTokens, candidateTokens) : null;
  const reductionPercent = usageComparable && baseTokens > 0 ? ((baseTokens - candidateTokens) / baseTokens) * 100 : null;
  const contextKeys = ['packetRequests', 'sourceAppearances', 'uniqueFiles', 'uniqueChunks', 'contextCharacters'];
  const context = Object.fromEntries(contextKeys.map(key => [key, {
    baseline: baselineSummary.coverage.retrieval[key],
    candidate: candidateSummary.coverage.retrieval[key],
    delta: delta(baselineSummary.coverage.retrieval[key], candidateSummary.coverage.retrieval[key]),
  }]));
  const goldRangeContext = {
    baseline: baselineSummary.coverage.retrieval.goldSupportRanges,
    candidate: candidateSummary.coverage.retrieval.goldSupportRanges,
  };
  const attribution = confounds.length === 0 ? 'matched-controls' : 'descriptive-confounded';
  const hasComparableGoldRanges = [goldRangeContext.baseline, goldRangeContext.candidate].every(value =>
    value.numerator !== null && value.denominator !== null && value.denominator > 0);
  const contextStatus = contextKeys.every(key => context[key].baseline !== null && context[key].candidate !== null)
    && hasComparableGoldRanges ? 'complete' : 'partial';

  return {
    schemaVersion: 'centinel-local-index-comparison-result-v1',
    scope: {
      projectId: CASE.projectId,
      instanceId: CASE.instanceId,
      registeredAxiosGoldIssues: CASE.goldIssueIds,
      fullFiveProjectAcceptance: 'not-assessed: this comparison covers Axios only',
      wholeSystemHighCriticalRecall: 'not-assessed: the frozen Axios manifest does not label severity and one project cannot establish whole-system recall',
    },
    baseline: baselineSummary,
    candidate: candidateSummary,
    comparison: {
      attribution,
      confounds,
      tokenAccounting: {
        status: usageComparable ? 'complete' : 'unknown-or-partial',
        baselineReviewModelTokens: baselineUsage.review.totalTokens,
        candidateReviewModelTokens: candidateUsage.review.totalTokens,
        baselineEmbeddingDocumentTokens: baselineUsage.embedding.documentTokens,
        candidateEmbeddingDocumentTokens: candidateUsage.embedding.documentTokens,
        baselineEmbeddingQueryTokens: baselineUsage.embedding.queryTokens,
        candidateEmbeddingQueryTokens: candidateUsage.embedding.queryTokens,
        baselineCombinedReportedTokens: baseTokens,
        candidateCombinedReportedTokens: candidateTokens,
        rawDeltaCandidateMinusBaseline: tokenDelta,
        descriptiveReductionPercent: reductionPercent,
        reductionAttributableToIndexing: candidateSummary.gates.retrievalIntervention.status === 'pass'
          && baselineSummary.semanticStatus === 'pass' && candidateSummary.semanticStatus === 'pass'
          && usageComparable && contextStatus === 'complete' && attribution === 'matched-controls',
        note: 'Combined token counts are resource totals, not prices. Cache tokens are a subset of input and are not added. Any incomplete/unknown attempt makes the complete-run total and delta unavailable; estimates remain separate.',
      },
      contextCoverage: {
        status: contextStatus,
        measures: context,
        goldSupportRanges: goldRangeContext,
        note: 'File/path counts do not prove that a relevant source range entered a model request. Gold-range coverage is reported only when independently reconstructed from safe request-context metadata.',
      },
      semanticComparison: {
        candidateCaseStatus: candidateSummary.semanticStatus,
        baselineCaseStatus: baselineSummary.semanticStatus,
        comparisonStatus: attribution === 'matched-controls' && candidateSummary.semanticStatus === 'pass'
          && baselineSummary.semanticStatus === 'pass'
          && usageComparable && contextStatus === 'complete'
          ? 'case-level-comparable'
          : 'descriptive-only',
      },
    },
  };
}

function main() {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error('Usage: node compare.mjs <baseline-summary.json> <candidate-summary.json>');
    process.exitCode = 2;
    return;
  }
  try {
    const baseline = JSON.parse(readFileSync(path.resolve(baselinePath), 'utf8'));
    const candidate = JSON.parse(readFileSync(path.resolve(candidatePath), 'utf8'));
    process.stdout.write(`${JSON.stringify(compareRuns(baseline, candidate), null, 2)}\n`);
  } catch (error) {
    console.error(`[compare] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
