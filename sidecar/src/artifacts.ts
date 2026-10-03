import path from 'node:path';

export type ArtifactType = 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other';
export type ArtifactSource = 'documents' | 'repository' | 'directory' | 'drive';

export type Artifact = {
  id: string;
  projectId: string;
  /** Immutable Storage-backed input version selected for this Review. */
  versionId?: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

const SUPPORTED_EXTENSIONS: Record<string, ArtifactType> = {
  '.txt': 'requirement',
  '.md': 'requirement',
  '.js': 'source_code',
  '.ts': 'source_code',
  '.py': 'source_code',
  '.java': 'source_code',
  '.cs': 'source_code',
  '.jsx': 'source_code',
  '.tsx': 'source_code',
  '.json': 'other',
  '.yaml': 'other',
  '.yml': 'other',
  '.html': 'source_code',
  '.css': 'source_code',
  '.go': 'source_code',
  '.rb': 'source_code',
  '.php': 'source_code',
  '.rs': 'source_code',
  '.cpp': 'source_code',
  '.c': 'source_code',
  '.h': 'source_code',
};

export function detectArtifactType(fileName: string): ArtifactType {
  return SUPPORTED_EXTENSIONS[path.extname(fileName).toLowerCase()] ?? 'other';
}
