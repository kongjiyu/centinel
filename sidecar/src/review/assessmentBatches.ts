import crypto from 'node:crypto';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import type { ReviewAnalysisMap, ReviewAnalysisFeature } from './featurePathAnalysis.js';
import { ModelProviderError } from './retry.js';
import type { StaticFindingInput, ReviewAuditEvent } from './types.js';
import type { RetrievedContext } from './contextTypes.js';
import { isReadablePlainText } from './plainTextLogic.js';
import { addCommonJsDependencyContext } from './commonJsContext.js';
import {
  createEvidencePacketSelector,
  selectEvidencePackets,
  type EvidencePacketFallbackReason,
  type EvidencePacketMethod,
  type EvidencePacketSelectionPlan,
} from './evidencePacketSelection.js';

export const REVIEW_FEATURE_BATCH_SIZE = 8;
export const REVIEW_SOURCE_BATCH_CHARACTERS = 64_000;
const SOURCE_SEGMENT_CHARACTERS = 24_000;
export const MAX_ASSESSMENT_BATCHES = 256;
export const MAX_OPTIONAL_PACKET_CHARACTERS = 8_000;
export const MAX_OPTIONAL_CALLER_UNITS = 8;
export type AssessmentSourceLineWindow = {
  /** Inclusive UTF-16 code-unit offset in the original frozen line. */
  startOffset: number;
  /** Exclusive UTF-16 code-unit offset in the original frozen line. */
  endOffsetExclusive: number;
  originalLineLength: number;
  offsetUnit: 'utf16_code_units';
  partialLine: true;
};
export type AssessmentSourceSegment = EvidenceArtifact & {
  content: string;
  lineStart: number;
  lineEnd: number;
  /** Present only when this segment is an exact partial window of one original line. */
  lineWindow?: AssessmentSourceLineWindow;
};
export type AssessmentPacketDiagnostics = {
  schemaVersion: 1;
  method: EvidencePacketMethod | 'mixed';
  fallbackReasonCounts: Partial<Record<EvidencePacketFallbackReason, number>>;
  sourceCharacters: number;
  retainedCharacters: number;
  selectedUnitCount: number;
  retainedRangeCount: number;
  addedRetrievedUnitCount: number;
  addedCallerUnitCount: number;
  omittedCallerUnitCount: number;
  omittedRetrievedUnitCount: number;
  addedCommonJsDependencyCount: number;
  omittedCommonJsDependencyCount: number;
};
export type AssessmentBatch = {
  id: string;
  features: ReviewAnalysisFeature[];
  sources: AssessmentSourceSegment[];
  /** Safe, bounded metadata; never contains source text, paths, or provider data. */
  packetDiagnostics?: AssessmentPacketDiagnostics;
};

const DUPLICATE_RETRIEVAL_REFERENCE = 'Exact text is included in the numbered frozen source below; use that source for evidence.';

/** Ranking aids must not introduce a different version or unseen segment. */
export function contextForAssessmentBatch(context: RetrievedContext | null, sources: AssessmentSourceSegment[]): RetrievedContext | null {
  return context ? { ...context, selectedChunks: context.selectedChunks?.filter(chunk => sources.some(source =>
    source.artifact.filePath === chunk.filePath && source.artifact.versionId === chunk.artifactVersionId
    && chunk.content.length > 0 && source.content.includes(chunk.content))).slice(0, 8).map(chunk => ({
      ...chunk,
      // The full numbered frozen source is already supplied below. Keep the
      // trusted retrieval identity and ordering, not a second copy of its text.
      content: DUPLICATE_RETRIEVAL_REFERENCE,
    })) } : null;
}

/**
 * Project the canonical map to the current prompt packet. Keep global coverage
 * counts, flags and limitations, but avoid repeating unrelated artifact lists
 * in every request. This projection is prompt-only; persist and validate using
 * the complete map.
 */
export function analysisMapForBatchPrompt(map: ReviewAnalysisMap, sources: AssessmentSourceSegment[]): ReviewAnalysisMap {
  const sourceArtifactIds = new Set(sources.map(source => source.artifact.id));
  return {
    ...map,
    coverage: {
      ...map.coverage,
      declarationArtifacts: map.coverage.declarationArtifacts?.filter(item => sourceArtifactIds.has(item.artifactId)),
      nonExecutableArtifacts: map.coverage.nonExecutableArtifacts?.filter(item => sourceArtifactIds.has(item.artifactId)),
      unsupportedArtifacts: map.coverage.unsupportedArtifacts.filter(item => sourceArtifactIds.has(item.artifactId)),
    },
  };
}

/** Full inventories are stored once; small validated deltas update live coverage. */
export function analysisMapFromEvents(events: ReviewAuditEvent[]): ReviewAnalysisMap | null {
  let map: ReviewAnalysisMap | null = null;
  for (const event of events) {
    if (event.event === 'review_analysis_map_saved' && event.detail?.analysisMap) map = structuredClone(event.detail.analysisMap) as ReviewAnalysisMap;
    if (map && ['review_analysis_batch_saved', 'review_analysis_batch_unverified'].includes(event.event) && Array.isArray(event.detail?.features)) {
      const updates = new Map((event.detail.features as ReviewAnalysisFeature[]).map(feature => [feature.id, feature]));
      map.features = map.features.map(feature => updates.get(feature.id) ?? feature);
      map.status = map.features.length && map.features.every(feature => feature.assessments.every(item => item.status === 'assessed')) ? 'assessed'
        : map.features.some(feature => feature.assessments.some(item => item.status === 'assessed')) ? 'partial' : 'unverified';
    }
  }
  return map;
}

export function findingsWithinBatch(findings: StaticFindingInput[], sources: AssessmentSourceSegment[]) {
  return findings.filter(finding => [finding, ...(finding.relatedLocations ?? [])].every(ref => {
    if (!ref.lineNumber) return false;
    const end = ref.lineNumber + ref.evidence.replace(/\r\n/g, '\n').split('\n').length - 1;
    return sources.some(source => {
      if (source.artifact.id !== ref.artifactId || ref.lineNumber! < source.lineStart || end > source.lineEnd) return false;
      if (!source.lineWindow) return true;
      const window = source.lineWindow;
      const metadataValid = Number.isSafeInteger(window.startOffset) && window.startOffset >= 0
        && Number.isSafeInteger(window.endOffsetExclusive) && window.endOffsetExclusive > window.startOffset
        && Number.isSafeInteger(window.originalLineLength) && window.originalLineLength >= window.endOffsetExclusive
        && (window.startOffset > 0 || window.endOffsetExclusive < window.originalLineLength)
        && window.offsetUnit === 'utf16_code_units' && window.partialLine === true
        && source.lineStart === source.lineEnd && ref.lineNumber === source.lineStart && end === source.lineEnd
        && source.content.length === window.endOffsetExclusive - window.startOffset;
      const excerpt = ref.evidence.replace(/\r\n/g, '\n');
      return metadataValid && !excerpt.includes('\n') && source.content.replace(/\r\n/g, '\n').includes(excerpt);
    });
  }));
}

const CONFIGURATION_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.html', '.css']);

function configurationOrMarkup(item: EvidenceArtifact, parserExcludedConfigurationIds: ReadonlySet<string>): boolean {
  const name = item.artifact.fileName.toLowerCase();
  const extension = name.slice(name.lastIndexOf('.'));
  const isConfiguration = parserExcludedConfigurationIds.has(item.artifact.id) || CONFIGURATION_EXTENSIONS.has(extension);
  return isConfiguration && typeof item.content === 'string' && isReadablePlainText(item.content);
}

function isHighSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

/** Split a parser-excluded long line at exact UTF-16 boundaries without losing any source characters. */
function oversizedConfigurationLine(item: EvidenceArtifact, line: string, lineNumber: number): AssessmentSourceSegment[] {
  const result: AssessmentSourceSegment[] = [];
  let startOffset = 0;
  while (startOffset < line.length) {
    let endOffsetExclusive = Math.min(startOffset + SOURCE_SEGMENT_CHARACTERS, line.length);
    // String offsets and slices use UTF-16 code units. Keep a surrogate pair together at each boundary.
    if (endOffsetExclusive < line.length && endOffsetExclusive > startOffset
      && isHighSurrogate(line.charCodeAt(endOffsetExclusive - 1)) && isLowSurrogate(line.charCodeAt(endOffsetExclusive))) {
      endOffsetExclusive--;
    }
    if (endOffsetExclusive <= startOffset) throw contextLimit();
    const content = line.slice(startOffset, endOffsetExclusive);
    const lineWindow: AssessmentSourceLineWindow = {
      startOffset,
      endOffsetExclusive,
      originalLineLength: line.length,
      offsetUnit: 'utf16_code_units',
      partialLine: true,
    };
    // Recheck the declared offsets against the original frozen line before admitting the packet.
    if (content !== line.slice(lineWindow.startOffset, lineWindow.endOffsetExclusive)
      || content.length !== lineWindow.endOffsetExclusive - lineWindow.startOffset
      || (lineWindow.endOffsetExclusive < line.length
        && isHighSurrogate(line.charCodeAt(lineWindow.endOffsetExclusive - 1))
        && isLowSurrogate(line.charCodeAt(lineWindow.endOffsetExclusive)))) throw contextLimit();
    result.push({ ...item, content, lineStart: lineNumber, lineEnd: lineNumber, lineWindow });
    startOffset = endOffsetExclusive;
  }
  if (result.map(segment => segment.content).join('') !== line) throw contextLimit();
  return result;
}

/** Preserve the existing line-segment contract and every readable source line; never truncate. */
function segments(item: EvidenceArtifact, allowConfigurationWindows = false): AssessmentSourceSegment[] {
  if (typeof item.content !== 'string' || item.state && item.state !== 'available') return [];
  const lines = item.content.split('\n');
  const result: AssessmentSourceSegment[] = [];
  let start = 0, size = 0;
  const flush = (endExclusive: number) => {
    if (endExclusive <= start) return;
    result.push({ ...item, content: lines.slice(start, endExclusive).join('\n'), lineStart: start + 1, lineEnd: endExclusive });
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.length > REVIEW_SOURCE_BATCH_CHARACTERS && !allowConfigurationWindows) throw contextLimit();
    if (allowConfigurationWindows && line.length > SOURCE_SEGMENT_CHARACTERS) {
      flush(index);
      result.push(...oversizedConfigurationLine(item, line, index + 1));
      start = index + 1;
      size = 0;
      continue;
    }
    if (size && size + lines[index]!.length + 1 > SOURCE_SEGMENT_CHARACTERS) {
      flush(index);
      start = index; size = 0;
    }
    size += lines[index]!.length + 1;
  }
  flush(lines.length);
  if (!result.length) result.push({ ...item, content: '', lineStart: 1, lineEnd: 1 });
  return result;
}
function contextLimit() {
  return new ModelProviderError('The selected assessment unit exceeds the bounded source context. Reduce its scope; omitted context cannot qualify as assessed.', { code: 'context_limit', retryable: false });
}
const sourceKey = (source: AssessmentSourceSegment) => `${source.artifact.id}:${source.artifact.contentHash}:${source.lineStart}:${source.lineEnd}:`
  + (source.lineWindow ? `utf16:${source.lineWindow.startOffset}:${source.lineWindow.endOffsetExclusive}:${source.lineWindow.originalLineLength}` : 'full');
const sourceSize = (sources: AssessmentSourceSegment[]) => sources.reduce((sum, source) => sum + source.content.length, 0);

function packetSources(
  artifacts: EvidenceArtifact[],
  selections: ReturnType<typeof selectEvidencePackets>['byArtifactId'],
  parserExcludedConfigurationIds: ReadonlySet<string>,
): AssessmentSourceSegment[] {
  const byId = new Map(artifacts.map(item => [item.artifact.id, item]));
  const result: AssessmentSourceSegment[] = [];
  for (const [artifactId, selection] of selections) {
    const item = byId.get(artifactId);
    if (!item || typeof item.content !== 'string' || item.state && item.state !== 'available') throw contextLimit();
    const lines = item.content.split('\n');
    const allowConfigurationWindows = configurationOrMarkup(item, parserExcludedConfigurationIds);
    for (const range of selection.ranges) {
      if (!Number.isInteger(range.lineStart) || !Number.isInteger(range.lineEnd)
        || range.lineStart < 1 || range.lineEnd < range.lineStart || range.lineEnd > lines.length) throw contextLimit();
      let start = range.lineStart - 1;
      for (let index = start; index < range.lineEnd; index++) {
        const line = lines[index]!;
        if (line.length > REVIEW_SOURCE_BATCH_CHARACTERS && !allowConfigurationWindows) throw contextLimit();
        if (!allowConfigurationWindows || line.length <= SOURCE_SEGMENT_CHARACTERS) continue;
        if (index > start) result.push({ ...item, content: lines.slice(start, index).join('\n'), lineStart: start + 1, lineEnd: index });
        result.push(...oversizedConfigurationLine(item, line, index + 1));
        start = index + 1;
      }
      if (start < range.lineEnd) result.push({ ...item, content: lines.slice(start, range.lineEnd).join('\n'), lineStart: start + 1, lineEnd: range.lineEnd });
    }
  }
  return result;
}

function retainedPacketCharacters(plan: EvidencePacketSelectionPlan): number {
  return [...plan.byArtifactId.values()].reduce((sum, value) => sum + value.diagnostics.retainedCharacters, 0);
}

function packetDiagnostics(
  plan: EvidencePacketSelectionPlan,
  omittedCallerUnitCount = plan.omittedCallerUnitCount,
  omittedRetrievedUnitCount = 0,
): AssessmentPacketDiagnostics {
  const values = [...plan.byArtifactId.values()];
  const methods = new Set(values.map(value => value.diagnostics.method));
  const fallbackReasonCounts: AssessmentPacketDiagnostics['fallbackReasonCounts'] = {};
  for (const value of values) if (value.diagnostics.fallbackReason) {
    const reason = value.diagnostics.fallbackReason;
    fallbackReasonCounts[reason] = (fallbackReasonCounts[reason] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    method: methods.size === 1 ? values[0]!.diagnostics.method : 'mixed',
    fallbackReasonCounts,
    sourceCharacters: values.reduce((sum, value) => sum + value.diagnostics.sourceCharacters, 0),
    retainedCharacters: values.reduce((sum, value) => sum + value.diagnostics.retainedCharacters, 0),
    selectedUnitCount: values.reduce((sum, value) => sum + value.diagnostics.selectedUnitCount, 0),
    retainedRangeCount: values.reduce((sum, value) => sum + value.diagnostics.retainedRangeCount, 0),
    addedRetrievedUnitCount: plan.retrievedUnitCount,
    addedCallerUnitCount: plan.callerUnitCount,
    omittedCallerUnitCount,
    omittedRetrievedUnitCount,
    addedCommonJsDependencyCount: 0,
    omittedCommonJsDependencyCount: 0,
  };
}

/** Inventory feature checks and independent source sweeps, including files with no mapped operation. */
export function planAssessmentBatches(map: ReviewAnalysisMap, artifacts: EvidenceArtifact[], context?: RetrievedContext | null): AssessmentBatch[] {
  const parserExcludedConfigurationIds = new Set(map.coverage.unsupportedArtifacts
    .filter(item => item.parserExclusion === 'configuration').map(item => item.artifactId));
  const all = artifacts.flatMap(item => segments(item, configurationOrMarkup(item, parserExcludedConfigurationIds)));
  const textLogicIds = new Set(map.features.filter(feature => feature.analysisKind === 'plain_text_logic').flatMap(feature => feature.entryPoints.map(ref => ref.artifactId)));
  const selectPackets = createEvidencePacketSelector(artifacts);
  const batches: AssessmentBatch[] = [];
  const covered = new Set<string>();
  const add = (features: ReviewAnalysisFeature[], sources: AssessmentSourceSegment[], diagnostics?: AssessmentPacketDiagnostics) => {
    if (!sources.length && !features.length) return;
    if (batches.length >= MAX_ASSESSMENT_BATCHES || sourceSize(sources) > REVIEW_SOURCE_BATCH_CHARACTERS) throw contextLimit();
    const id = crypto.createHash('sha256').update(JSON.stringify([features.map(feature => feature.id), sources.map(sourceKey)])).digest('hex').slice(0, 16);
    batches.push({ id, features, sources, ...(diagnostics ? { packetDiagnostics: diagnostics } : {}) });
    sources.forEach(source => covered.add(sourceKey(source)));
  };
  const addFeatureGroup = (features: ReviewAnalysisFeature[]) => {
    const requiredSelection = selectPackets(features, undefined, { includeCallers: false });
    let selection = requiredSelection;
    let sources = packetSources(artifacts, requiredSelection.byArtifactId, parserExcludedConfigurationIds);
    const sourceIds = new Set(sources.map(source => source.artifact.id));
    for (const feature of features) for (const reference of [...feature.entryPoints, ...feature.paths.flatMap(path => path.evidence)]) {
      if (!sourceIds.has(reference.artifactId) || !sources.some(source => source.artifact.id === reference.artifactId
        && reference.lineNumber >= source.lineStart && reference.lineNumber <= source.lineEnd)) throw contextLimit();
    }
    if (sourceSize(sources) > REVIEW_SOURCE_BATCH_CHARACTERS) {
      if (features.length <= 1) throw contextLimit();
      const middle = Math.ceil(features.length / 2);
      addFeatureGroup(features.slice(0, middle));
      addFeatureGroup(features.slice(middle));
      return;
    }
    let omittedCallerCount = requiredSelection.omittedCallerUnitCount;
    let omittedRetrievedCount = 0;
    const optionalSelection = selectPackets(features, context ?? undefined, {
      includeCallers: true, maxCallerUnits: MAX_OPTIONAL_CALLER_UNITS,
    });
    const optionalSources = packetSources(artifacts, optionalSelection.byArtifactId, parserExcludedConfigurationIds);
    const requiredRetained = retainedPacketCharacters(requiredSelection);
    const optionalRetained = retainedPacketCharacters(optionalSelection);
    const optionalCharacters = Math.max(0, optionalRetained - requiredRetained);
    const containsRequiredRanges = [...requiredSelection.byArtifactId].every(([artifactId, required]) => {
      const candidate = optionalSelection.byArtifactId.get(artifactId);
      return !!candidate && required.ranges.every(range => candidate.ranges.some(optional =>
        optional.lineStart <= range.lineStart && optional.lineEnd >= range.lineEnd));
    });
    const optionalFits = containsRequiredRanges && optionalCharacters <= MAX_OPTIONAL_PACKET_CHARACTERS
      && sourceSize(optionalSources) <= REVIEW_SOURCE_BATCH_CHARACTERS;
    if (optionalFits) {
      selection = optionalSelection;
      sources = optionalSources;
      omittedCallerCount = optionalSelection.omittedCallerUnitCount;
    } else {
      omittedCallerCount = optionalSelection.callerUnitCount + optionalSelection.omittedCallerUnitCount;
      omittedRetrievedCount = optionalSelection.retrievedUnitCount;
    }
    add(features, sources, packetDiagnostics(selection, omittedCallerCount, omittedRetrievedCount));
  };
  for (let index = 0; index < map.features.length; index += REVIEW_FEATURE_BATCH_SIZE) {
    const group = map.features.slice(index, index + REVIEW_FEATURE_BATCH_SIZE);
    const parsedFeatures = group.filter(feature => feature.analysisKind !== 'plain_text_logic');
    if (parsedFeatures.length) addFeatureGroup(parsedFeatures);
    // Text-logic units have no AST boundaries. Retain the whole exact segment,
    // rather than sending only the first/last anchor selected by syntax ranking.
    let textFeatures: ReviewAnalysisFeature[] = [];
    let textSources: AssessmentSourceSegment[] = [];
    for (const feature of group.filter(item => item.analysisKind === 'plain_text_logic')) {
      const reference = feature.entryPoints[0];
      const range = feature.sourceRange;
      const source = reference && artifacts.find(item => item.artifact.id === reference.artifactId
        && item.artifact.filePath === reference.filePath && item.artifact.contentHash === reference.sourceVersion);
      if (!source || typeof source.content !== 'string' || source.state && source.state !== 'available'
        || !range || !Number.isInteger(range.lineStart) || !Number.isInteger(range.lineEnd)
        || range.lineStart < 1 || range.lineEnd < range.lineStart) throw contextLimit();
      const lines = source.content.split('\n');
      if (range.lineEnd > lines.length) throw contextLimit();
      const segment: AssessmentSourceSegment = { ...source, content: lines.slice(range.lineStart - 1, range.lineEnd).join('\n'),
        lineStart: range.lineStart, lineEnd: range.lineEnd };
      if (segment.content.length > REVIEW_SOURCE_BATCH_CHARACTERS) throw contextLimit();
      if (textSources.length && sourceSize([...textSources, segment]) > REVIEW_SOURCE_BATCH_CHARACTERS) {
        add(textFeatures, textSources); textFeatures = []; textSources = [];
      }
      textFeatures.push(feature); textSources.push(segment);
    }
    add(textFeatures, textSources);
  }
  // Every selected source-code segment also gets an independent semantic sweep.
  // These empty-feature batches can produce findings but never domain coverage.
  let sweep: AssessmentSourceSegment[] = [];
  for (const source of all.filter(source => source.artifact.type === 'source_code' || textLogicIds.has(source.artifact.id))) {
    if (sweep.length && sourceSize([...sweep, source]) > REVIEW_SOURCE_BATCH_CHARACTERS) { add([], sweep); sweep = []; }
    sweep.push(source);
  }
  add([], sweep);
  // Keep non-code documents available to an independent sweep if no feature
  // batch already included them as bounded shared context.
  sweep = [];
  for (const source of all.filter(source => source.artifact.type !== 'source_code' && !textLogicIds.has(source.artifact.id) && !covered.has(sourceKey(source)))) {
    if (sweep.length && sourceSize([...sweep, source]) > REVIEW_SOURCE_BATCH_CHARACTERS) { add([], sweep); sweep = []; }
    sweep.push(source);
  }
  add([], sweep);
  // Add original documents as shared context when they fit; remaining documents still have their own sweep.
  const documents = all.filter(source => source.artifact.type !== 'source_code' && !textLogicIds.has(source.artifact.id));
  for (const batch of batches.filter(batch => batch.features.length)) {
    for (const document of documents) {
      if (batch.sources.some(source => sourceKey(source) === sourceKey(document))) continue;
      if (sourceSize([...batch.sources, document]) <= REVIEW_SOURCE_BATCH_CHARACTERS) batch.sources.push(document);
    }
  }
  // Append bounded, complete one-hop CommonJS dependency modules only after
  // the original feature packets and shared documents have been finalized.
  for (const batch of batches.filter(batch => batch.features.length && batch.features.every(feature => feature.analysisKind !== 'plain_text_logic'))) {
    const context = addCommonJsDependencyContext(artifacts, batch.sources,
      REVIEW_SOURCE_BATCH_CHARACTERS - sourceSize(batch.sources));
    batch.sources = context.sources;
    if (batch.packetDiagnostics) {
      batch.packetDiagnostics.addedCommonJsDependencyCount = context.addedCount;
      batch.packetDiagnostics.omittedCommonJsDependencyCount = context.omittedCount;
    }
  }
  for (const batch of batches) batch.id = crypto.createHash('sha256')
    .update(JSON.stringify([batch.features.map(feature => feature.id), batch.sources.map(sourceKey)])).digest('hex').slice(0, 16);
  return batches;
}
