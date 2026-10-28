/** Pure, deterministic ranking for frozen source chunks. Semantic ranks are
 * supplied by the caller only after it validates exact provenance. */

export type RetrievalRankCandidate = {
  key: string;
  content: string;
  order: number;
};

export type RetrievalRankedCandidate<T extends RetrievalRankCandidate> = {
  candidate: T;
  score: number;
  mode: 'hybrid' | 'semantic' | 'lexical';
  lexicalRank: number | null;
  semanticRank: number | null;
};

const RRF_CONSTANT = 60;
const MAX_QUERY_TERMS = 128;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could', 'do', 'does', 'for', 'i',
  'from', 'how', 'if', 'in', 'into', 'is', 'it', 'may', 'might', 'of', 'on', 'or', 'should', 'that', 'the',
  'their', 'then', 'there', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would',
]);

function words(value: string): string[] {
  const raw = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  const output: string[] = [];
  for (const part of raw) {
    // Preserve identifier terms across camelCase and acronym boundaries.
    const split = part.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    for (const token of split.split(/\s+/)) {
      const normalized = token.toLocaleLowerCase('en-US');
      if (normalized) output.push(normalized);
    }
  }
  return output;
}

export function retrievalQueryTerms(query: string): string[] {
  const unique = new Set<string>();
  for (const token of words(query)) {
    if (!STOP_WORDS.has(token)) unique.add(token);
    if (unique.size >= MAX_QUERY_TERMS) break;
  }
  return [...unique];
}

/** Reciprocal-rank-fuse lexical relevance with semantic ranks returned by the
 * configured vector search. Lexical ranking scans every supplied candidate. */
export function rankHybridChunks<T extends RetrievalRankCandidate>(
  candidates: readonly T[],
  query: string,
  semanticKeys: readonly string[] = [],
  limit = 16,
): Array<RetrievalRankedCandidate<T>> {
  if (!candidates.length || !Number.isFinite(limit) || limit <= 0) return [];

  const terms = retrievalQueryTerms(query);
  const documents = candidates.map(candidate => words(candidate.content));
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(document)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const averageLength = documents.length ? documents.reduce((sum, document) => sum + document.length, 0) / documents.length : 0;
  const lexicalScores = candidates.map((candidate, index) => {
    const document = documents[index];
    const frequencies = new Map<string, number>();
    for (const term of document) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const frequency = frequencies.get(term) ?? 0;
      if (!frequency) continue;
      const count = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(1 + (candidates.length - count + 0.5) / (count + 0.5));
      const lengthFactor = averageLength > 0 ? document.length / averageLength : 1;
      score += inverseFrequency * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * lengthFactor));
    }
    return { candidate, score };
  }).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.order - right.candidate.order || left.candidate.key.localeCompare(right.candidate.key));

  const lexicalRanks = new Map<string, number>();
  lexicalScores.forEach(({ candidate }, index) => {
    if (!lexicalRanks.has(candidate.key)) lexicalRanks.set(candidate.key, index + 1);
  });
  const semanticRanks = new Map<string, number>();
  semanticKeys.forEach((key, index) => {
    if (!semanticRanks.has(key)) semanticRanks.set(key, index + 1);
  });

  const lexicalScoreByKey = new Map(lexicalScores.map(item => [item.candidate.key, item.score]));
  const unique = new Map<string, T>();
  for (const candidate of candidates) if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
  const ranked: Array<RetrievalRankedCandidate<T>> = [];
  for (const [key, candidate] of unique) {
    const lexicalRank = lexicalRanks.get(key) ?? null;
    const semanticRank = semanticRanks.get(key) ?? null;
    if (lexicalRank === null && semanticRank === null) continue;
    const score = (lexicalRank === null ? 0 : 1 / (RRF_CONSTANT + lexicalRank))
      + (semanticRank === null ? 0 : 1 / (RRF_CONSTANT + semanticRank));
    ranked.push({
      candidate,
      score,
      mode: lexicalRank !== null && semanticRank !== null ? 'hybrid' : semanticRank !== null ? 'semantic' : 'lexical',
      lexicalRank,
      semanticRank,
    });
  }
  return ranked.sort((left, right) => right.score - left.score
    || (lexicalScoreByKey.get(right.candidate.key) ?? 0) - (lexicalScoreByKey.get(left.candidate.key) ?? 0)
    || (left.semanticRank ?? Number.MAX_SAFE_INTEGER) - (right.semanticRank ?? Number.MAX_SAFE_INTEGER)
    || left.candidate.order - right.candidate.order
    || left.candidate.key.localeCompare(right.candidate.key))
    .slice(0, Math.floor(limit));
}
