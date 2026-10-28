import {
  reviewSourceFileIdentity,
  sanitizeReviewRequestUsageContext,
  type ReviewLogicalPhase,
  type ReviewRequestComponents,
  type ReviewSourcePacketReference,
} from './usageContext.js';

export type UsageValueStatus = 'provider_reported' | 'provider_derived' | 'unavailable';

export type ReviewUsageAttemptRow = {
  id: string;
  stage: string;
  attempt: number;
  provider: string;
  apiFormat: string;
  model: string;
  outcome: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  metadata: Record<string, unknown> | null;
  duration_ms?: number | null;
  created_at: string;
};

export type PhysicalSourceRead = {
  source: ReviewSourcePacketReference | null;
  outcome: 'in_progress' | 'success' | 'failed' | 'cancelled';
  characters: number | null;
  lines: number | null;
  hashChecked: boolean | null;
};

export type ReviewUsageStageState = 'not_reached' | 'running' | 'completed' | 'stopped';

export type ReviewUsagePhaseBreakdown = {
  phase: ReviewLogicalPhase;
  calls: number;
  repairCalls: number;
  inputTokens: number;
  unknownInputCalls: number;
  outputTokens: number;
  unknownOutputCalls: number;
  cacheReadTokens: number;
  unknownCacheReadCalls: number;
  cacheCreationTokens: number;
  unknownCacheCreationCalls: number;
  providerReportedTotalTokens: number;
  providerReportedTotalCalls: number;
  unknownProviderTotalCalls: number;
  canonicalTotalTokens: number;
  unknownCanonicalTotalCalls: number;
  accountedTokens: number;
  assumedZeroNoResponseCalls: number;
  assumedZeroNoResponseTokens: number;
};

export type ReviewUsageStageBreakdown = {
  stage: string;
  /** Durable operation keys remain unchanged; this list maps them to the pipeline stage. */
  operations: string[];
  state: ReviewUsageStageState;
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  cancelledCalls: number;
  inProgressCalls: number;
  repairCalls: number;
  phases: ReviewUsagePhaseBreakdown[];
  inputTokens: number;
  unknownInputCalls: number;
  outputTokens: number;
  unknownOutputCalls: number;
  cacheReadTokens: number;
  unknownCacheReadCalls: number;
  cacheCreationTokens: number;
  unknownCacheCreationCalls: number;
  providerReportedTotalTokens: number;
  providerReportedTotalCalls: number;
  unknownProviderTotalCalls: number;
  canonicalTotalTokens: number;
  unknownCanonicalTotalCalls: number;
  accountedTokens: number;
  assumedZeroNoResponseCalls: number;
  assumedZeroNoResponseTokens: number;
  requestContext: {
    callsWithContext: number;
    callsWithoutContext: number;
    estimatedInputTokens: number;
    estimatedCalls: number;
    componentsCharacters: ReviewRequestComponents;
  };
  aiFileCount: number | null;
  aiFileAppearances: number | null;
  aiFilesTruncated: boolean;
  aiFiles: Array<{
    artifactId: string;
    artifactVersionId: string | null;
    contentHash: string | null;
    filePath: string;
    appearances: number;
    phases: ReviewLogicalPhase[];
    ranges: Array<{ lineStart: number | null; lineEnd: number | null }>;
  }>;
  physicalReadAttempts: number | null;
  physicalReadFileCount: number | null;
  physicalFilesTruncated: boolean;
  physicalFiles: Array<{
    artifactId: string;
    artifactVersionId: string | null;
    contentHash: string | null;
    filePath: string;
    readAttempts: number;
    successfulReads: number;
    failedReads: number;
    lines: number | null;
    characters: number | null;
  }>;
};

export type ReviewUsageProjection = {
  reusedAssessments?: import('./batchCacheUsage.js').ReusedAssessmentUsage;
  status: 'available' | 'partial' | 'unavailable';
  totalProviderReportedTokens: number;
  providerReportedCalls: number;
  unknownProviderTotalCalls: number;
  canonicalTotalTokens: number;
  unknownCanonicalTotalCalls: number;
  accountedTokens: number;
  assumedZeroNoResponseCalls: number;
  assumedZeroNoResponseTokens: number;
  byStage: ReviewUsageStageBreakdown[];
  sourceInventory: {
    status: 'available' | 'partial' | 'unavailable';
    totalUniqueFiles: number | null;
    knownUniqueFiles: number;
    aiFileAppearances: number | null;
    repeatedFileAppearances: number | null;
    unknownAiFileAttempts: number;
    files: Array<{
      artifactId: string;
      artifactVersionId: string | null;
      contentHash: string | null;
      filePath: string;
      appearances: number;
      stages: string[];
      phases: ReviewLogicalPhase[];
      ranges: Array<{ lineStart: number | null; lineEnd: number | null }>;
    }>;
    filesTruncated: boolean;
    physical: {
      status: 'available' | 'partial' | 'unavailable';
      readAttempts: number | null;
      uniqueFiles: number | null;
      unknownReadAttempts: number;
      byStage: Array<{
        stage: string;
        readAttempts: number;
        uniqueFiles: number;
        filesTruncated: boolean;
        files: ReviewUsageStageBreakdown['physicalFiles'];
      }>;
    };
  };
};

const REPAIR_PHASES = new Set<ReviewLogicalPhase>([
  'domain_repair', 'citation_repair', 'support_repair', 'response_repair',
]);
const NO_RESPONSE_ERROR_OUTCOMES = new Set(['retryable_error', 'permanent_error', 'malformed_response', 'cancelled']);
const MAX_FILE_ROWS = 10_000;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function requestContext(row: ReviewUsageAttemptRow) {
  return sanitizeReviewRequestUsageContext(row.metadata?.usageContext);
}

function actualProviderTotal(row: ReviewUsageAttemptRow): number | null {
  return count(row.metadata?.providerReportedTotalTokens);
}

function assumedZeroNoResponse(row: ReviewUsageAttemptRow): boolean {
  const metadata = row.metadata ?? {};
  const accounting = metadata.usageAccounting;
  const noActualUsage = row.input_tokens == null && row.output_tokens == null
    && row.cache_read_tokens == null && row.cache_creation_tokens == null
    && metadata.usageObservation == null && metadata.providerReportedTotalTokens == null
    && metadata.normalizedTotalTokens == null;
  return NO_RESPONSE_ERROR_OUTCOMES.has(row.outcome) && metadata.responseReceived === false && noActualUsage
    && accounting !== null && typeof accounting === 'object' && !Array.isArray(accounting)
    && (accounting as Record<string, unknown>).basis === 'assumed_zero_no_response'
    && (accounting as Record<string, unknown>).accountedTokens === 0;
}

/** Preserve provider totals and avoid adding cache counts already included in input. */
export function canonicalProviderTotal(row: Pick<ReviewUsageAttemptRow, 'apiFormat' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens' | 'metadata'>): {
  totalTokens: number | null;
  status: UsageValueStatus;
} {
  const reported = count(row.metadata?.providerReportedTotalTokens);
  if (reported !== null) return { totalTokens: reported, status: 'provider_reported' };

  const normalizedTotal = count(row.metadata?.normalizedTotalTokens);
  if (normalizedTotal !== null && row.metadata?.normalizedTotalTokensSource === 'adapter_derived') {
    return { totalTokens: normalizedTotal, status: 'provider_derived' };
  }

  const input = count(row.input_tokens);
  const output = count(row.output_tokens);
  if (input === null || output === null || /anthropic/i.test(row.apiFormat)) {
    return { totalTokens: null, status: 'unavailable' };
  }
  return { totalTokens: input + output, status: 'provider_derived' };
}

function sourceIdentity(reference: ReviewSourcePacketReference): string {
  return reviewSourceFileIdentity(reference);
}

function stageState(value: unknown, hasAttempts: boolean): ReviewUsageStageState {
  if (value === 'not_reached' || value === 'running' || value === 'completed' || value === 'stopped') return value;
  return hasAttempts ? 'completed' : 'not_reached';
}

function newStage(stage: string, state: unknown): ReviewUsageStageBreakdown {
  return {
    stage,
    operations: [],
    state: stageState(state, false),
    calls: 0, successfulCalls: 0, failedCalls: 0, cancelledCalls: 0, inProgressCalls: 0, repairCalls: 0,
    phases: [],
    inputTokens: 0, unknownInputCalls: 0, outputTokens: 0, unknownOutputCalls: 0,
    cacheReadTokens: 0, unknownCacheReadCalls: 0, cacheCreationTokens: 0, unknownCacheCreationCalls: 0,
    providerReportedTotalTokens: 0, providerReportedTotalCalls: 0, unknownProviderTotalCalls: 0,
    canonicalTotalTokens: 0, unknownCanonicalTotalCalls: 0,
    accountedTokens: 0, assumedZeroNoResponseCalls: 0, assumedZeroNoResponseTokens: 0,
    requestContext: { callsWithContext: 0, callsWithoutContext: 0, estimatedInputTokens: 0, estimatedCalls: 0, componentsCharacters: {} },
    aiFileCount: 0, aiFileAppearances: 0, aiFiles: [],
    aiFilesTruncated: false,
    physicalReadAttempts: 0, physicalReadFileCount: 0, physicalFiles: [],
    physicalFilesTruncated: false,
  };
}

function newPhase(phase: ReviewLogicalPhase): ReviewUsagePhaseBreakdown {
  return {
    phase, calls: 0, repairCalls: 0,
    inputTokens: 0, unknownInputCalls: 0,
    outputTokens: 0, unknownOutputCalls: 0,
    cacheReadTokens: 0, unknownCacheReadCalls: 0,
    cacheCreationTokens: 0, unknownCacheCreationCalls: 0,
    providerReportedTotalTokens: 0, providerReportedTotalCalls: 0, unknownProviderTotalCalls: 0,
    canonicalTotalTokens: 0, unknownCanonicalTotalCalls: 0,
    accountedTokens: 0, assumedZeroNoResponseCalls: 0, assumedZeroNoResponseTokens: 0,
  };
}

function pipelineStage(operation: string): string {
  if (operation === 'source_indexing' || operation === 'context_retrieval' || operation === 'indexing_context') return 'indexing_context';
  if (operation === 'model_analysis' || operation.startsWith('model_analysis:')) return 'model_analysis';
  return operation;
}

type TokenMetricCounts = Pick<ReviewUsageStageBreakdown,
  'inputTokens' | 'unknownInputCalls' | 'outputTokens' | 'unknownOutputCalls'
  | 'cacheReadTokens' | 'unknownCacheReadCalls' | 'cacheCreationTokens' | 'unknownCacheCreationCalls'>;

function addKnown(target: TokenMetricCounts, field: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens', unknownField: 'unknownInputCalls' | 'unknownOutputCalls' | 'unknownCacheReadCalls' | 'unknownCacheCreationCalls', value: unknown) {
  const normalized = count(value);
  if (normalized === null) target[unknownField]++;
  else target[field] += normalized;
}

type FileAccumulator = {
  source: ReviewSourcePacketReference;
  appearances: number;
  stages: Set<string>;
  phases: Set<ReviewLogicalPhase>;
  ranges: Map<string, { lineStart: number | null; lineEnd: number | null }>;
};

function addFile(accumulators: Map<string, FileAccumulator>, reference: ReviewSourcePacketReference, stage: string, phase?: ReviewLogicalPhase) {
  const key = sourceIdentity(reference);
  const current = accumulators.get(key) ?? {
    source: reference, appearances: 0, stages: new Set<string>(), phases: new Set<ReviewLogicalPhase>(), ranges: new Map(),
  };
  current.appearances++;
  current.stages.add(stage);
  if (phase) current.phases.add(phase);
  const rangeKey = `${reference.lineStart ?? ''}:${reference.lineEnd ?? ''}`;
  current.ranges.set(rangeKey, { lineStart: reference.lineStart, lineEnd: reference.lineEnd });
  accumulators.set(key, current);
}

function fileRows(accumulators: Map<string, FileAccumulator>, global = false) {
  return [...accumulators.values()].sort((a, b) => a.source.filePath.localeCompare(b.source.filePath)
    || (a.source.artifactVersionId ?? '').localeCompare(b.source.artifactVersionId ?? ''))
    .slice(0, MAX_FILE_ROWS).map(file => ({
      artifactId: file.source.artifactId,
      artifactVersionId: file.source.artifactVersionId,
      contentHash: file.source.contentHash,
      filePath: file.source.filePath,
      appearances: file.appearances,
      ...(global ? { stages: [...file.stages].sort() } : {}),
      phases: [...file.phases].sort(),
      ranges: [...file.ranges.values()].sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0)),
    }));
}

function physicalFiles(reads: PhysicalSourceRead[]): ReviewUsageStageBreakdown['physicalFiles'] {
  const accumulators = new Map<string, {
    source: ReviewSourcePacketReference;
    readAttempts: number;
    successfulReads: number;
    failedReads: number;
    lines: number;
    characters: number;
    knownLines: boolean;
    knownCharacters: boolean;
  }>();
  for (const read of reads) {
    if (!read.source) continue;
    const key = sourceIdentity(read.source);
    const current = accumulators.get(key) ?? { source: read.source, readAttempts: 0, successfulReads: 0, failedReads: 0, lines: 0, characters: 0, knownLines: true, knownCharacters: true };
    current.readAttempts++;
    if (read.outcome === 'success') current.successfulReads++;
    else if (read.outcome === 'failed' || read.outcome === 'cancelled') current.failedReads++;
    if (read.lines === null) current.knownLines = false; else current.lines += read.lines;
    if (read.characters === null) current.knownCharacters = false; else current.characters += read.characters;
    accumulators.set(key, current);
  }
  return [...accumulators.values()].sort((a, b) => a.source.filePath.localeCompare(b.source.filePath)).slice(0, MAX_FILE_ROWS).map(file => ({
    artifactId: file.source.artifactId,
    artifactVersionId: file.source.artifactVersionId,
    contentHash: file.source.contentHash,
    filePath: file.source.filePath,
    readAttempts: file.readAttempts,
    successfulReads: file.successfulReads,
    failedReads: file.failedReads,
    lines: file.knownLines ? file.lines : null,
    characters: file.knownCharacters ? file.characters : null,
  }));
}

function addPhysicalToStage(stage: ReviewUsageStageBreakdown, reads: PhysicalSourceRead[]) {
  stage.physicalReadAttempts = reads.length;
  const files = physicalFiles(reads);
  stage.physicalReadFileCount = new Set(reads.flatMap(read => read.source ? [sourceIdentity(read.source)] : [])).size;
  stage.physicalFilesTruncated = stage.physicalReadFileCount > MAX_FILE_ROWS;
  stage.physicalFiles = files;
}

/** Project version-aware per-stage token and source accounting from safe ledger metadata. */
export function projectReviewUsageAccounting(input: {
  records: ReviewUsageAttemptRow[];
  physicalReads: PhysicalSourceRead[] | null;
  stageStates?: Record<string, ReviewUsageStageState>;
  knownWorkflowStages?: string[];
  /** null means no frozen manifest was available; undefined is used by pure projections. */
  allowedSourceFiles?: Map<string, ReviewSourcePacketReference> | null;
}): ReviewUsageProjection {
  const recordsById = new Map<string, ReviewUsageAttemptRow>();
  for (const row of input.records) recordsById.set(row.id, row);
  const records = [...recordsById.values()];
  const stageMap = new Map<string, ReviewUsageStageBreakdown>();
  const globalAiFiles = new Map<string, FileAccumulator>();
  const stageAiFiles = new Map<string, Map<string, FileAccumulator>>();
  const stageUnknownAiFiles = new Map<string, number>();
  let unknownAiFileAttempts = 0;
  let aiFileAppearances = 0;
  let totalProviderReportedTokens = 0;
  let providerReportedCalls = 0;
  let unknownProviderTotalCalls = 0;
  let canonicalTotalTokens = 0;
  let unknownCanonicalTotalCalls = 0;
  let accountedTokens = 0;
  let assumedZeroNoResponseCalls = 0;
  let assumedZeroNoResponseTokens = 0;

  for (const stage of input.knownWorkflowStages ?? []) stageMap.set(stage, newStage(stage, input.stageStates?.[stage]));
  for (const row of records) {
    const workflowStage = pipelineStage(row.stage);
    const stage = stageMap.get(workflowStage) ?? newStage(workflowStage, input.stageStates?.[workflowStage]);
    stageMap.set(workflowStage, stage);
    if (!stage.operations.includes(row.stage)) stage.operations.push(row.stage);
    stage.state = stageState(input.stageStates?.[workflowStage], true);
    stage.calls++;
    if (row.outcome === 'success') stage.successfulCalls++;
    else if (row.outcome === 'cancelled') stage.cancelledCalls++;
    else if (row.outcome === 'in_progress') stage.inProgressCalls++;
    else stage.failedCalls++;

    addKnown(stage, 'inputTokens', 'unknownInputCalls', row.input_tokens);
    addKnown(stage, 'outputTokens', 'unknownOutputCalls', row.output_tokens);
    addKnown(stage, 'cacheReadTokens', 'unknownCacheReadCalls', row.cache_read_tokens);
    addKnown(stage, 'cacheCreationTokens', 'unknownCacheCreationCalls', row.cache_creation_tokens);
    const reported = actualProviderTotal(row);
    if (reported === null) { stage.unknownProviderTotalCalls++; unknownProviderTotalCalls++; }
    else { stage.providerReportedTotalTokens += reported; stage.providerReportedTotalCalls++; totalProviderReportedTokens += reported; providerReportedCalls++; }
    const canonical = canonicalProviderTotal(row);
    if (canonical.totalTokens === null) { stage.unknownCanonicalTotalCalls++; unknownCanonicalTotalCalls++; }
    else {
      stage.canonicalTotalTokens += canonical.totalTokens; canonicalTotalTokens += canonical.totalTokens;
      stage.accountedTokens += canonical.totalTokens; accountedTokens += canonical.totalTokens;
    }
    const assumedZero = assumedZeroNoResponse(row);
    if (assumedZero) {
      stage.assumedZeroNoResponseCalls++; assumedZeroNoResponseCalls++;
      stage.assumedZeroNoResponseTokens += 0; assumedZeroNoResponseTokens += 0;
    }

    const context = requestContext(row);
    if (!context) {
      stage.requestContext.callsWithoutContext++;
      unknownAiFileAttempts++;
      stageUnknownAiFiles.set(workflowStage, (stageUnknownAiFiles.get(workflowStage) ?? 0) + 1);
      continue;
    }
    stage.requestContext.callsWithContext++;
    if (context.estimation) {
      stage.requestContext.estimatedInputTokens += context.estimation.inputTokens;
      stage.requestContext.estimatedCalls++;
    }
    for (const [key, value] of Object.entries(context.components ?? {}) as Array<[keyof ReviewRequestComponents, number]>) {
      stage.requestContext.componentsCharacters[key] = (stage.requestContext.componentsCharacters[key] ?? 0) + value;
    }
    const phase = context.phase;
    let phaseEntry = stage.phases.find(item => item.phase === phase);
    if (!phaseEntry) {
      phaseEntry = newPhase(phase);
      stage.phases.push(phaseEntry);
    }
    phaseEntry.calls++;
    if (REPAIR_PHASES.has(phase)) { phaseEntry.repairCalls++; stage.repairCalls++; }
    addKnown(phaseEntry, 'inputTokens', 'unknownInputCalls', row.input_tokens);
    addKnown(phaseEntry, 'outputTokens', 'unknownOutputCalls', row.output_tokens);
    addKnown(phaseEntry, 'cacheReadTokens', 'unknownCacheReadCalls', row.cache_read_tokens);
    addKnown(phaseEntry, 'cacheCreationTokens', 'unknownCacheCreationCalls', row.cache_creation_tokens);
    if (reported === null) phaseEntry.unknownProviderTotalCalls++;
    else {
      phaseEntry.providerReportedTotalTokens += reported;
      phaseEntry.providerReportedTotalCalls++;
    }
    if (canonical.totalTokens === null) phaseEntry.unknownCanonicalTotalCalls++;
    else { phaseEntry.canonicalTotalTokens += canonical.totalTokens; phaseEntry.accountedTokens += canonical.totalTokens; }
    if (assumedZero) {
      phaseEntry.assumedZeroNoResponseCalls++;
      phaseEntry.assumedZeroNoResponseTokens += 0;
    }
    const sourceReferenceStatus = context.sourcesComplete !== false && Array.isArray(context.sources);
    const references = context.sources ?? [];
    const distinctPerAttempt = new Map<string, ReviewSourcePacketReference>();
    let attemptSourceReferencesComplete = sourceReferenceStatus;
    for (const reference of references) {
      const manifestReference = input.allowedSourceFiles?.get(reference.artifactId);
      const isAllowed = input.allowedSourceFiles === undefined
        ? true
        : Boolean(manifestReference
          && manifestReference.artifactVersionId === reference.artifactVersionId
          && manifestReference.contentHash === reference.contentHash
          && manifestReference.filePath.replace(/\\/g, '/').toLowerCase() === reference.filePath.replace(/\\/g, '/').toLowerCase());
      if (!isAllowed) { attemptSourceReferencesComplete = false; continue; }
      distinctPerAttempt.set(sourceIdentity(reference), reference);
    }
    if (!attemptSourceReferencesComplete) {
      unknownAiFileAttempts++;
      stageUnknownAiFiles.set(workflowStage, (stageUnknownAiFiles.get(workflowStage) ?? 0) + 1);
    }
    const stageFiles = stageAiFiles.get(workflowStage) ?? new Map<string, FileAccumulator>();
    for (const reference of distinctPerAttempt.values()) {
      addFile(globalAiFiles, reference, workflowStage, phase);
      addFile(stageFiles, reference, workflowStage, phase);
      aiFileAppearances++;
    }
    stageAiFiles.set(workflowStage, stageFiles);
  }

  for (const [stageName, files] of stageAiFiles) {
    const stage = stageMap.get(stageName)!;
    stage.aiFiles = fileRows(files).map(file => ({ ...file, appearances: file.appearances }));
    stage.aiFileCount = files.size;
    stage.aiFileAppearances = [...files.values()].reduce((sum, file) => sum + file.appearances, 0);
    stage.aiFilesTruncated = files.size > MAX_FILE_ROWS;
  }

  const physicalReadsAvailable = input.physicalReads !== null;
  const reads = input.physicalReads ?? [];
  if (physicalReadsAvailable) {
    const readsByStage = new Map<string, PhysicalSourceRead[]>();
    for (const read of reads) {
      const list = readsByStage.get('freezing_sources') ?? [];
      list.push(read);
      readsByStage.set('freezing_sources', list);
    }
    for (const [stageName, stageReads] of readsByStage) {
      const stage = stageMap.get(stageName) ?? newStage(stageName, input.stageStates?.[stageName]);
      stageMap.set(stageName, stage);
      stage.state = stageState(input.stageStates?.[stageName], true);
      addPhysicalToStage(stage, stageReads);
    }
    if (!readsByStage.has('freezing_sources')) {
      const stage = stageMap.get('freezing_sources') ?? newStage('freezing_sources', input.stageStates?.freezing_sources);
      stageMap.set('freezing_sources', stage);
      stage.physicalReadAttempts = 0;
      stage.physicalReadFileCount = 0;
      stage.physicalFiles = [];
    }
  }

  for (const [stageName, stage] of stageMap) {
    if (input.stageStates?.[stageName]) stage.state = input.stageStates[stageName];
    else if (stage.inProgressCalls > 0) stage.state = 'running';
    stage.phases.sort((a, b) => a.phase.localeCompare(b.phase));
    const files = stageAiFiles.get(stageName);
    if (!files) {
      stage.aiFiles = [];
      stage.aiFileCount = stageUnknownAiFiles.get(stageName) ? null : 0;
      stage.aiFileAppearances = stageUnknownAiFiles.get(stageName) ? null : 0;
      stage.aiFilesTruncated = false;
    } else if (stageUnknownAiFiles.get(stageName)) {
      stage.aiFileCount = null;
      stage.aiFileAppearances = null;
    }
    if (!physicalReadsAvailable) {
      stage.physicalReadAttempts = null;
      stage.physicalReadFileCount = null;
      stage.physicalFiles = [];
      stage.physicalFilesTruncated = false;
    }
  }

  const aiInventoryStatus = records.length === 0 ? 'available'
    : unknownAiFileAttempts === 0 ? 'available'
      : unknownAiFileAttempts === records.length ? 'unavailable' : 'partial';
  const physicalUnknownReads = reads.filter(read => read.source === null || read.outcome === 'in_progress').length;
  const physicalIdentitySet = new Set(reads.flatMap(read => read.source ? [sourceIdentity(read.source)] : []));
  const globalFilesTruncated = globalAiFiles.size > MAX_FILE_ROWS;
  const physicalFilesTruncated = physicalIdentitySet.size > MAX_FILE_ROWS;
  const physicalInventoryStatus = !physicalReadsAvailable ? 'unavailable'
    : physicalUnknownReads || physicalFilesTruncated ? 'partial' : 'available';
  const sourceInventoryStatus = aiInventoryStatus === 'unavailable' && physicalInventoryStatus === 'unavailable' ? 'unavailable'
    : aiInventoryStatus === 'partial' || physicalInventoryStatus === 'partial' || globalFilesTruncated ? 'partial'
      : aiInventoryStatus === 'unavailable' ? 'partial' : 'available';
  const globalFileRows = fileRows(globalAiFiles, true).map(file => ({ ...file, stages: file.stages ?? [] }));
  const exactAiCount = aiInventoryStatus === 'available' ? globalAiFiles.size : null;
  const exactAppearances = aiInventoryStatus === 'available' ? aiFileAppearances : null;
  const physicalFilesAll = physicalFiles(reads);
  const physicalByStage = physicalReadsAvailable ? [{
    stage: 'freezing_sources', readAttempts: reads.length,
    uniqueFiles: physicalIdentitySet.size,
    files: physicalFilesAll,
  }] : [];

  return {
    status: records.length === 0 ? 'available' : records.some(row => requestContext(row)) ? 'available' : 'partial',
    totalProviderReportedTokens,
    providerReportedCalls,
    unknownProviderTotalCalls,
    canonicalTotalTokens,
    unknownCanonicalTotalCalls,
    accountedTokens,
    assumedZeroNoResponseCalls,
    assumedZeroNoResponseTokens,
    byStage: [...stageMap.values()].sort((a, b) => a.stage.localeCompare(b.stage)),
    sourceInventory: {
      status: sourceInventoryStatus,
      totalUniqueFiles: exactAiCount,
      knownUniqueFiles: globalAiFiles.size,
      aiFileAppearances: exactAppearances,
      repeatedFileAppearances: exactAppearances === null ? null : Math.max(0, exactAppearances - globalAiFiles.size),
      unknownAiFileAttempts,
      files: globalFileRows,
      filesTruncated: globalFilesTruncated,
      physical: {
        status: physicalInventoryStatus,
        readAttempts: physicalReadsAvailable ? reads.length : null,
        uniqueFiles: physicalReadsAvailable && !physicalUnknownReads ? physicalIdentitySet.size : null,
        unknownReadAttempts: physicalUnknownReads,
        byStage: physicalByStage.map(stage => ({ ...stage, filesTruncated: stage.uniqueFiles > MAX_FILE_ROWS })),
      },
    },
  };
}
