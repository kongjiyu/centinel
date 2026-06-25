import { getDb } from './db.js';
import type { RepoIndex, CodeSymbol, CodeRelationship } from './repoIndex.js';
import { getIndexedFiles, getFileSymbols, getDependencies } from './repoIndex.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type RetrievedContext = {
  files: RepoIndex[];
  totalSymbols: number;
  estimatedTokens: number;
  reason: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rough token estimate: ~4 chars per token for code,
 * plus 1 token per symbol signature line.
 */
function estimateTokens(files: RepoIndex[], symbols: CodeSymbol[]): number {
  let tokens = 0;
  // Approximate file content tokens from file size (avg 4 chars per token)
  for (const f of files) {
    tokens += Math.ceil(f.fileSize / 4);
  }
  // Symbol signatures add overhead
  tokens += symbols.length * 50;
  return tokens;
}

function mapRepoIndexRow(row: unknown[]): RepoIndex {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    filePath: row[2] as string,
    parentPath: (row[3] as string) ?? '',
    fileType: (row[4] as string) ?? '',
    language: (row[5] as string) ?? '',
    fileSize: (row[6] as number) ?? 0,
    symbolCount: (row[7] as number) ?? 0,
    indexedAt: row[8] as string,
    // Mirrors repoIndex.mapRepoIndexRow: 10th column is the module
    // grouping added in Group 2c for the test plan generator.
    module: (row[9] as string) ?? '',
  };
}

// ── Review-type Strategies ─────────────────────────────────────────────────

/**
 * requirement_review: return requirement/design files + their symbols.
 */
async function buildRequirementReviewContext(
  projectId: string,
  maxTokens: number
): Promise<RetrievedContext> {
  const allFiles = await getIndexedFiles(projectId);

  // Prefer requirement/design files (markdown, txt, doc-like)
  const reqTypes = new Set(['md', 'txt']);
  const reqFiles = allFiles.filter((f) => {
    const t = f.fileType.toLowerCase();
    return reqTypes.has(t) || f.language === 'markdown' || f.language === 'text';
  });

  // Fallback: if no requirement files found, include all files sorted by symbol count
  const selected = reqFiles.length > 0 ? reqFiles : allFiles;
  const sorted = selected.sort((a, b) => b.symbolCount - a.symbolCount);

  // Collect all symbols from selected files
  const allSymbols: CodeSymbol[] = [];
  let totalTokens = 0;
  const includedFiles: RepoIndex[] = [];

  for (const file of sorted) {
    if (totalTokens >= maxTokens) break;
    includedFiles.push(file);
    const syms = await getFileSymbols(file.id);
    allSymbols.push(...syms);
    totalTokens = estimateTokens(includedFiles, allSymbols);
  }

  return {
    files: includedFiles,
    totalSymbols: allSymbols.length,
    estimatedTokens: totalTokens,
    reason: reqFiles.length > 0
      ? `Selected ${includedFiles.length} requirement/design files for requirement review`
      : `No requirement files found; included ${includedFiles.length} files sorted by symbol count`,
  };
}

/**
 * code_review: return code files grouped by directory, prioritize files with most symbols.
 */
async function buildCodeReviewContext(
  projectId: string,
  maxTokens: number
): Promise<RetrievedContext> {
  const allFiles = await getIndexedFiles(projectId);

  // Filter to code files only
  const codeExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cs', 'go', 'rb', 'php', 'rs',
    'cpp', 'c', 'h',
  ]);
  const codeFiles = allFiles.filter((f) => codeExtensions.has(f.fileType.toLowerCase()));

  // Sort by symbol count descending (most complex files first)
  const sorted = codeFiles.sort((a, b) => b.symbolCount - a.symbolCount);

  const allSymbols: CodeSymbol[] = [];
  let totalTokens = 0;
  const includedFiles: RepoIndex[] = [];

  for (const file of sorted) {
    if (totalTokens >= maxTokens) break;
    includedFiles.push(file);
    const syms = await getFileSymbols(file.id);
    allSymbols.push(...syms);
    totalTokens = estimateTokens(includedFiles, allSymbols);
  }

  return {
    files: includedFiles,
    totalSymbols: allSymbols.length,
    estimatedTokens: totalTokens,
    reason: `Selected ${includedFiles.length} code files prioritized by symbol count for code review`,
  };
}

/**
 * requirement_to_code_traceability: return requirement files + code files separately.
 */
async function buildTraceabilityContext(
  projectId: string,
  maxTokens: number
): Promise<RetrievedContext> {
  const allFiles = await getIndexedFiles(projectId);

  const reqTypes = new Set(['md', 'txt']);
  const reqFiles = allFiles.filter((f) => {
    const t = f.fileType.toLowerCase();
    return reqTypes.has(t) || f.language === 'markdown' || f.language === 'text';
  });

  const codeExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cs', 'go', 'rb', 'php', 'rs',
    'cpp', 'c', 'h',
  ]);
  const codeFiles = allFiles.filter((f) => codeExtensions.has(f.fileType.toLowerCase()));

  // Combine: requirement files first, then code files by symbol count
  const codeSorted = codeFiles.sort((a, b) => b.symbolCount - a.symbolCount);
  const combined = [...reqFiles, ...codeSorted];

  const allSymbols: CodeSymbol[] = [];
  let totalTokens = 0;
  const includedFiles: RepoIndex[] = [];

  for (const file of combined) {
    if (totalTokens >= maxTokens) break;
    includedFiles.push(file);
    const syms = await getFileSymbols(file.id);
    allSymbols.push(...syms);
    totalTokens = estimateTokens(includedFiles, allSymbols);
  }

  return {
    files: includedFiles,
    totalSymbols: allSymbols.length,
    estimatedTokens: totalTokens,
    reason: `Traceability context: ${reqFiles.length} requirement files + ${includedFiles.length - reqFiles.length} code files`,
  };
}

/**
 * cross_artifact_consistency: return summaries of all files (path + symbol names).
 */
async function buildConsistencyContext(
  projectId: string,
  maxTokens: number
): Promise<RetrievedContext> {
  const allFiles = await getIndexedFiles(projectId);

  // For consistency, we want a broad view — include all files but lighter detail
  const sorted = allFiles.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const allSymbols: CodeSymbol[] = [];
  let totalTokens = 0;
  const includedFiles: RepoIndex[] = [];

  for (const file of sorted) {
    if (totalTokens >= maxTokens) break;
    includedFiles.push(file);
    const syms = await getFileSymbols(file.id);
    allSymbols.push(...syms);
    totalTokens = estimateTokens(includedFiles, allSymbols);
  }

  return {
    files: includedFiles,
    totalSymbols: allSymbols.length,
    estimatedTokens: totalTokens,
    reason: `Cross-artifact consistency: ${includedFiles.length} files with ${allSymbols.length} total symbols`,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Retrieve relevant context for a review session based on review type.
 * Different review types prioritize different subsets of the indexed repository.
 *
 * @param projectId - The project to retrieve context for
 * @param reviewType - One of: 'requirement_review', 'code_review',
 *   'requirement_to_code_traceability', 'cross_artifact_consistency'
 * @param maxTokens - Approximate token budget (default: 100000)
 */
export async function retrieveContext(
  projectId: string,
  reviewType: string,
  maxTokens: number = 100_000
): Promise<RetrievedContext> {
  switch (reviewType) {
    case 'requirement_review':
      return buildRequirementReviewContext(projectId, maxTokens);
    case 'code_review':
      return buildCodeReviewContext(projectId, maxTokens);
    case 'requirement_to_code_traceability':
      return buildTraceabilityContext(projectId, maxTokens);
    case 'cross_artifact_consistency':
      return buildConsistencyContext(projectId, maxTokens);
    default:
      // Fallback: return all files sorted by symbol count
      return buildCodeReviewContext(projectId, maxTokens);
  }
}

/**
 * Search indexed files and symbols by keyword.
 * Matches against file paths and symbol names (case-insensitive).
 *
 * @param projectId - The project to search in
 * @param query - Search keyword
 */
export async function searchByKeyword(
  projectId: string,
  query: string
): Promise<RepoIndex[]> {
  const db = await getDb();
  const pattern = `%${query}%`;

  // Search file paths
  const fileStmt = db.prepare(
    `SELECT id, project_id, file_path, parent_path, file_type, language, file_size, symbol_count, indexed_at
     FROM repo_index
     WHERE project_id = ? AND file_path LIKE ?
     ORDER BY file_path`
  );
  fileStmt.bind([projectId, pattern]);
  const files: RepoIndex[] = [];
  while (fileStmt.step()) {
    files.push(mapRepoIndexRow(fileStmt.get() as unknown[]));
  }
  fileStmt.free();

  // Also search symbol names and get their parent files
  const symStmt = db.prepare(
    `SELECT DISTINCT r.id, r.project_id, r.file_path, r.parent_path, r.file_type, r.language, r.file_size, r.symbol_count, r.indexed_at
     FROM code_symbols cs
     JOIN repo_index r ON r.id = cs.file_id
     WHERE cs.project_id = ? AND cs.name LIKE ?
     ORDER BY r.file_path`
  );
  symStmt.bind([projectId, pattern]);
  while (symStmt.step()) {
    const row = mapRepoIndexRow(symStmt.get() as unknown[]);
    if (!files.some((f) => f.id === row.id)) {
      files.push(row);
    }
  }
  symStmt.free();

  return files;
}

/**
 * Get files related to a given file by traversing the dependency graph.
 * Follows imports outward to find transitive dependencies.
 *
 * @param fileId - The starting file ID
 * @param depth - How many levels of dependencies to traverse (default: 1)
 */
export async function getRelatedFiles(
  fileId: string,
  depth: number = 1
): Promise<RepoIndex[]> {
  const db = await getDb();
  const visited = new Set<string>();
  const relatedFiles: RepoIndex[] = [];

  async function traverse(currentFileId: string, currentDepth: number) {
    if (currentDepth > depth || visited.has(currentFileId)) return;
    visited.add(currentFileId);

    const deps = await getDependencies(currentFileId);

    for (const dep of deps) {
      // Resolve the target file path to a file ID
      const fileStmt = db.prepare(
        'SELECT id, project_id, file_path, parent_path, file_type, language, file_size, symbol_count, indexed_at, module FROM repo_index WHERE file_path = ? OR file_path LIKE ?'
      );
      // Try exact match and also match as relative path (strip leading ./ etc.)
      const targetPath = dep.targetFilePath;
      fileStmt.bind([targetPath, `%${targetPath}`]);
      while (fileStmt.step()) {
        const row = mapRepoIndexRow(fileStmt.get() as unknown[]);
        if (!visited.has(row.id)) {
          relatedFiles.push(row);
          // Recurse to next depth
          await traverse(row.id, currentDepth + 1);
        }
      }
      fileStmt.free();
    }

    // Also get reverse dependencies (files that import this file)
    const reverseStmt = db.prepare(
      `SELECT DISTINCT r.id, r.project_id, r.file_path, r.parent_path, r.file_type, r.language, r.file_size, r.symbol_count, r.indexed_at
       FROM code_relationships cr
       JOIN repo_index r ON r.id = cr.source_file_id
       WHERE cr.target_file_path = (
         SELECT file_path FROM repo_index WHERE id = ?
       )
       AND cr.relationship_type IN ('import', 'side_effect_import')`
    );
    reverseStmt.bind([currentFileId]);
    while (reverseStmt.step()) {
      const row = mapRepoIndexRow(reverseStmt.get() as unknown[]);
      if (!visited.has(row.id)) {
        relatedFiles.push(row);
        await traverse(row.id, currentDepth + 1);
      }
    }
    reverseStmt.free();
  }

  await traverse(fileId, 1);
  return relatedFiles;
}
