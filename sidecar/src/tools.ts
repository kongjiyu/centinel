import fs from 'fs';
import path from 'path';
import { searchSymbols as _searchSymbols, getSymbolBody as _getSymbolBody, SymbolNotFound } from './repoIndex.js';

// ── Tool schemas (Anthropic-compatible shape; aiClient.ts converts per-provider) ──

export const TOOL_SCHEMAS = [
  {
    name: 'fetch_file',
    description: 'Read the full content of a single file by its path. Use when you need to inspect a file\'s complete source.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "File path relative to workspace root, e.g. 'src/auth/login.ts'" },
      },
      required: ['path'],
    },
  },
  {
    name: 'fetch_files',
    description: 'Read multiple files in one batch. More efficient than calling fetch_file repeatedly.',
    input_schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['paths'],
    },
  },
  {
    name: 'get_symbol_body',
    description: 'Return only one symbol (function/class/interface) by name, not the whole file. Cheaper than fetch_file when you know the symbol name.',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        name: { type: 'string', description: 'Symbol name' },
      },
      required: ['file', 'name'],
    },
  },
  {
    name: 'search_symbols',
    description: 'Search the symbol index by name. Returns matching symbols with their file paths and signatures. Use to locate candidates before fetching.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to match against symbol names' },
      },
      required: ['query'],
    },
  },
] as const;

export type ToolName = 'fetch_file' | 'fetch_files' | 'get_symbol_body' | 'search_symbols';

// ── Path normalization ─────────────────────────────────────────────────────────

/**
 * Resolve a user-provided path against the workspace root, then normalize.
 * On Windows, comparison is case-insensitive. Returns the absolute path.
 */
function resolvePath(input: string, workspacePath: string): string {
  // If absolute, use as-is; otherwise resolve relative to workspace
  const absolute = path.isAbsolute(input) ? input : path.resolve(workspacePath, input);
  // Normalize separators and resolve any '..' / '.'
  return path.normalize(absolute);
}

// ── Truncation ─────────────────────────────────────────────────────────────────

const TRUNCATION_MARKER = '\n\n[... truncated, use get_symbol_body for a specific symbol ...]';

function getMaxResultChars(): number {
  const fromEnv = Number(process.env.STATIC_REVIEW_MAX_TOOL_RESULT_CHARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 25_000;
}

function maybeTruncate(text: string): { content: string; truncated: boolean } {
  const max = getMaxResultChars();
  if (text.length <= max) return { content: text, truncated: false };
  const cut = max - TRUNCATION_MARKER.length;
  return { content: text.substring(0, cut) + TRUNCATION_MARKER, truncated: true };
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolFetchFile(args: Record<string, unknown>, workspacePath: string): Promise<string> {
  const p = resolvePath(String(args.path), workspacePath);
  const raw = fs.readFileSync(p, 'utf-8');
  const { content, truncated } = maybeTruncate(raw);
  return JSON.stringify({ content, path: p, truncated });
}

async function toolFetchFiles(args: Record<string, unknown>, workspacePath: string): Promise<string> {
  const paths = (args.paths as unknown[]).map(String);
  const results: Record<string, unknown> = {};
  let successCount = 0;
  let lastError: Error | null = null;

  for (const p of paths) {
    try {
      const absolute = resolvePath(p, workspacePath);
      const raw = fs.readFileSync(absolute, 'utf-8');
      const { content, truncated } = maybeTruncate(raw);
      results[p] = { content, truncated };
      successCount++;
    } catch (err) {
      results[p] = { error: err instanceof Error ? err.message : String(err) };
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Throw only if ALL paths failed
  if (successCount === 0 && paths.length > 0) {
    throw lastError ?? new Error('All paths failed');
  }

  return JSON.stringify({ results });
}

// ── Public dispatch ───────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspacePath: string,
  projectId?: string,
  deps?: {
    getSymbolBody?: typeof _getSymbolBody;
    searchSymbols?: typeof _searchSymbols;
  }
): Promise<string> {
  // Use injected deps if provided (for testing), otherwise fall back to real imports
  const getSymbolBody = deps?.getSymbolBody ?? _getSymbolBody;
  const searchSymbolsFn = deps?.searchSymbols ?? _searchSymbols;

  switch (name) {
    case 'fetch_file':
      return toolFetchFile(args, workspacePath);
    case 'fetch_files':
      return toolFetchFiles(args, workspacePath);
    case 'get_symbol_body': {
      if (!projectId) throw new Error('get_symbol_body requires projectId');
      const filePath = resolvePath(String(args.file), workspacePath);
      const symbolName = String(args.name);
      const result = await getSymbolBody(projectId, filePath, symbolName);
      // maybeTruncate returns { content, truncated }; rename content→body so the
      // spread picks it up under the same key (otherwise JSON.stringify drops it).
      const { content: body, truncated } = maybeTruncate(result.body);
      return JSON.stringify({ ...result, body, truncated });
    }
    case 'search_symbols': {
      if (!projectId) throw new Error('search_symbols requires projectId');
      const query = String(args.query);
      const result = await searchSymbolsFn(projectId, query);
      return JSON.stringify(result);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Re-export SymbolNotFound so callers can identify the error
export { SymbolNotFound };
