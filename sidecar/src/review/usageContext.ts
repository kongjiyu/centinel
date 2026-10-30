/** Safe, additive accounting metadata for one actual Static Review request.
 * These values describe source references and character-based estimates; they
 * never represent provider-reported token usage. */
export const REVIEW_LOGICAL_PHASES = [
  'initial_analysis',
  'domain_repair',
  'citation_repair',
  'semantic_support',
  'support_repair',
  'response_repair',
  'source_indexing',
  'context_retrieval',
] as const;

export type ReviewLogicalPhase = typeof REVIEW_LOGICAL_PHASES[number];

export type ReviewSourceLineWindow = {
  startOffset: number;
  endOffsetExclusive: number;
  originalLineLength: number;
  offsetUnit: 'utf16_code_units';
  partialLine: true;
};

export type ReviewSourcePacketReference = {
  artifactId: string;
  artifactVersionId: string | null;
  contentHash: string | null;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  /** Safe source-only provenance for one exact partial original line. */
  lineWindow?: ReviewSourceLineWindow;
};

export type ReviewRequestComponents = {
  sourceCharacters?: number;
  graphCharacters?: number;
  retrievalCharacters?: number;
  authorityCharacters?: number;
  systemCharacters?: number;
  schemaCharacters?: number;
  promptCharacters?: number;
};

export type ReviewRequestEstimation = {
  inputTokens: number;
  method: 'characters_divided_by_2';
};

export type ReviewRequestUsageContext = {
  phase: ReviewLogicalPhase;
  /** References to source packets actually supplied with this request. */
  sources?: ReviewSourcePacketReference[];
  /** False when an untrusted/oversized persisted list had to be omitted. */
  sourcesComplete?: boolean;
  /** Character counts are context diagnostics, not provider token counts. */
  components?: ReviewRequestComponents;
  estimation?: ReviewRequestEstimation;
};

const MAX_SOURCE_REFERENCES = 1_024;
const MAX_TEXT_LENGTH = 2_048;
const COMPONENT_KEYS: Array<keyof ReviewRequestComponents> = [
  'sourceCharacters', 'graphCharacters', 'retrievalCharacters', 'authorityCharacters',
  'systemCharacters', 'schemaCharacters', 'promptCharacters',
];

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) return null;
  return value;
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeLine(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function safeLineWindow(value: unknown, lineStart: number | null, lineEnd: number | null): ReviewSourceLineWindow | null {
  if (!record(value) || lineStart === null || lineEnd === null || lineStart !== lineEnd
    || value.offsetUnit !== 'utf16_code_units' || value.partialLine !== true) return null;
  const startOffset = safeCount(value.startOffset);
  const endOffsetExclusive = safeCount(value.endOffsetExclusive);
  const originalLineLength = safeCount(value.originalLineLength);
  if (startOffset === null || endOffsetExclusive === null || originalLineLength === null
    || endOffsetExclusive <= startOffset || endOffsetExclusive > originalLineLength
    || startOffset === 0 && endOffsetExclusive === originalLineLength) return null;
  return { startOffset, endOffsetExclusive, originalLineLength, offsetUnit: 'utf16_code_units', partialLine: true };
}

const phaseSet = new Set<string>(REVIEW_LOGICAL_PHASES);

/** Convert untrusted persisted JSON into bounded, allowlisted request metadata. */
export function sanitizeReviewRequestUsageContext(value: unknown): ReviewRequestUsageContext | undefined {
  if (!record(value) || typeof value.phase !== 'string' || !phaseSet.has(value.phase)) return undefined;

  const sources: ReviewSourcePacketReference[] = [];
  // Persisted contexts can already be partial (for example after a previous
  // sanitizer dropped invalid or over-limit references). Never upgrade that
  // evidence back to complete when the bounded list is sanitized again.
  let sourcesComplete = value.sourcesComplete !== false;
  if (Array.isArray(value.sources)) {
    if (value.sources.length > MAX_SOURCE_REFERENCES) sourcesComplete = false;
    for (const raw of value.sources.slice(0, MAX_SOURCE_REFERENCES)) {
      if (!record(raw)) { sourcesComplete = false; continue; }
      const artifactId = safeText(raw.artifactId, 256);
      const filePath = safeText(raw.filePath);
      const contentHash = safeText(raw.contentHash, 256);
      const artifactVersionId = safeText(raw.artifactVersionId, 256);
      if (!artifactId || !filePath || !contentHash || (raw.artifactVersionId != null && !artifactVersionId)) { sourcesComplete = false; continue; }
      const start = safeLine(raw.lineStart);
      const end = safeLine(raw.lineEnd);
      if (start !== null && end !== null && end < start) { sourcesComplete = false; continue; }
      if ((raw.lineStart != null && start === null) || (raw.lineEnd != null && end === null)) sourcesComplete = false;
      if ((start === null) !== (end === null)) sourcesComplete = false;
      let lineWindow: ReviewSourceLineWindow | null = null;
      if (raw.lineWindow != null) {
        lineWindow = safeLineWindow(raw.lineWindow, start, end);
        if (!lineWindow) { sourcesComplete = false; continue; }
      }
      sources.push({
        artifactId,
        artifactVersionId,
        contentHash,
        filePath,
        lineStart: start,
        lineEnd: end,
        ...(lineWindow ? { lineWindow } : {}),
      });
    }
  }

  let components: ReviewRequestComponents | undefined;
  if (record(value.components)) {
    const normalized: ReviewRequestComponents = {};
    for (const key of COMPONENT_KEYS) {
      const count = safeCount(value.components[key]);
      if (count !== null) normalized[key] = count;
    }
    if (Object.keys(normalized).length) components = normalized;
  }

  let estimation: ReviewRequestEstimation | undefined;
  if (record(value.estimation) && value.estimation.method === 'characters_divided_by_2') {
    const inputTokens = safeCount(value.estimation.inputTokens);
    if (inputTokens !== null) estimation = { inputTokens, method: 'characters_divided_by_2' };
  }

  return {
    phase: value.phase as ReviewLogicalPhase,
    ...(Array.isArray(value.sources) ? { sources: deduplicateSourcePacketReferences(sources) } : {}),
    ...(Array.isArray(value.sources) ? { sourcesComplete } : {}),
    ...(components ? { components } : {}),
    ...(estimation ? { estimation } : {}),
  };
}

function referenceKey(reference: ReviewSourcePacketReference): string {
  return [reference.artifactId, reference.artifactVersionId ?? '', reference.contentHash ?? '',
    reference.filePath.replace(/\\/g, '/').toLowerCase(), reference.lineStart ?? '', reference.lineEnd ?? '',
    reference.lineWindow ? `${reference.lineWindow.startOffset}:${reference.lineWindow.endOffsetExclusive}:${reference.lineWindow.originalLineLength}` : 'full'].join('\u0000');
}

/** Keep ranges distinct while removing duplicate references within one request. */
export function deduplicateSourcePacketReferences(references: ReviewSourcePacketReference[]): ReviewSourcePacketReference[] {
  const seen = new Set<string>();
  return references.filter(reference => {
    const key = referenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Map trusted batch source segments to safe references without source bodies. */
export function sourcePacketReferencesFromBatch(sources: readonly {
  artifact: { id: string; versionId?: string | null; contentHash?: string | null; filePath: string };
  lineStart?: number | null;
  lineEnd?: number | null;
  lineWindow?: ReviewSourceLineWindow;
}[]): ReviewSourcePacketReference[] {
  const references = sources.map(source => {
    const lineStart = safeLine(source.lineStart);
    const lineEnd = safeLine(source.lineEnd);
    const lineWindow = source.lineWindow ? safeLineWindow(source.lineWindow, lineStart, lineEnd) : null;
    return {
      artifactId: source.artifact.id,
      artifactVersionId: source.artifact.versionId ?? null,
      contentHash: source.artifact.contentHash ?? null,
      filePath: source.artifact.filePath,
      lineStart,
      lineEnd,
      ...(lineWindow ? { lineWindow } : {}),
    };
  }).filter(reference => Boolean(reference.artifactId && reference.filePath));
  return deduplicateSourcePacketReferences(references);
}

/** Build a bounded descriptor for the frozen manifest; never copy artifact content. */
export function sourceManifestReference(value: unknown): ReviewSourcePacketReference | null {
  if (!record(value)) return null;
  const metadata = record(value.metadata) ? value.metadata : {};
  const artifactId = safeText(value.id, 256);
  const filePathValues = [value.filePath, value.path].filter((item): item is string => typeof item === 'string' && !!item.trim());
  const hashValues = [value.contentHash, metadata.contentHash].filter((item): item is string => typeof item === 'string' && !!item.trim());
  const versionValues = [value.artifactVersionId, value.versionId, value.version_id]
    .filter((item): item is string => typeof item === 'string' && !!item.trim());
  const filesAgree = new Set(filePathValues.map(filePath => filePath.replace(/\\/g, '/').toLowerCase())).size <= 1;
  const hashesAgree = new Set(hashValues.map(hash => hash.toLowerCase())).size <= 1;
  const versionsAgree = new Set(versionValues).size <= 1;
  if (!filesAgree || !hashesAgree || !versionsAgree) return null;
  const filePath = safeText(filePathValues[0]);
  const contentHash = safeText(hashValues[0], 256);
  const artifactVersionId = safeText(versionValues[0], 256);
  if (!artifactId || !filePath || !contentHash || (versionValues.length > 0 && !artifactVersionId)) return null;
  return {
    artifactId,
    artifactVersionId,
    contentHash,
    filePath,
    lineStart: null,
    lineEnd: null,
  };
}

/** The full versioned file identity is used for counts across stages. */
export function reviewSourceFileIdentity(reference: ReviewSourcePacketReference): string {
  return [reference.artifactId, reference.artifactVersionId ?? '', reference.contentHash ?? '',
    reference.filePath.replace(/\\/g, '/').toLowerCase()].join('\u0000');
}
