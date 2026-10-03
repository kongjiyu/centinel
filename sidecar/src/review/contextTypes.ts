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
  selectedChunks?: Array<{
    artifactVersionId: string;
    filePath: string;
    ordinal: number;
    content: string;
  }>;
};
