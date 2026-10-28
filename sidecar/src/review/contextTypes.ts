/** Context selected from immutable Supabase artifact versions for one Review. */
export type RetrievedContext = {
  files: Array<{
    id: string;
    projectId: string;
    filePath: string;
    parentPath: string;
    fileType: string;
    language: string;
    fileSize: number;
    symbolCount: number;
    indexedAt: string;
    module: string;
  }>;
  totalSymbols: number;
  estimatedTokens: number;
  reason: string;
  /** Present when a bounded durable or semantic scan may have omitted matches. */
  retrievalPartialReason?: string;
  selectedChunks?: Array<{
    artifactVersionId: string;
    filePath: string;
    ordinal: number;
    content: string;
    artifactId?: string;
    contentHash?: string;
    lineStart?: number;
    lineEnd?: number;
    startOffset?: number;
    endOffset?: number;
    kind?: 'code' | 'function' | 'class' | 'doc_section' | 'text' | string;
    symbol?: string;
    isFragment?: boolean;
    fragmentIndex?: number;
    fragmentCount?: number;
    retrievalScore?: number;
    retrievalMode?: 'hybrid' | 'semantic' | 'lexical';
    /** Durable ordinal in artifact_chunks; ordinal above is chunker-local. */
    indexOrdinal?: number;
  }>;
};
