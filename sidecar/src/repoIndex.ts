import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverseDefault from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import { getDb, saveDb } from './db.js';
import type { Artifact } from './artifacts.js';
import { readArtifactContent } from './artifacts.js';

// Handle CJS/ESM interop — @babel/traverse exports via module.exports
const traverse: typeof traverseDefault =
  typeof traverseDefault === 'function' ? traverseDefault : (traverseDefault as any).default;

// ── Types ──────────────────────────────────────────────────────────────────

export type RepoIndex = {
  id: string;
  projectId: string;
  filePath: string;
  parentPath: string;
  fileType: string;
  language: string;
  fileSize: number;
  symbolCount: number;
  indexedAt: string;
};

export type CodeSymbol = {
  id: string;
  projectId: string;
  fileId: string;
  symbolType: string;
  name: string;
  startLine: number;
  endLine: number;
  signature: string;
  exports: boolean;
};

export type CodeRelationship = {
  id: string;
  projectId: string;
  sourceFileId: string;
  targetFilePath: string;
  targetSymbol: string;
  relationshipType: string;
};

// ── Language Detection ─────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.html': 'html',
  '.css': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.txt': 'text',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'unknown';
}

// ── Non-JS/TS Symbol Extractors ───────────────────────────────────────────

function extractJsonSymbols(content: string, filePath: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relationships: ExtractedRelationship[] = [];

  try {
    const parsed = JSON.parse(content);

    // Extract top-level keys as symbols
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [key, value] of Object.entries(parsed)) {
        const symbolType = Array.isArray(value) ? 'array' :
          typeof value === 'object' && value !== null ? 'object' :
          typeof value;
        symbols.push({
          symbolType,
          name: key,
          startLine: 0,
          endLine: 0,
          signature: `${key}: ${JSON.stringify(value).slice(0, 80)}`,
          exports: false,
        });
      }
    }

    // Detect cross-file references from known JSON structures
    const fileName = path.basename(filePath).toLowerCase();

    // tsconfig references
    if (fileName.startsWith('tsconfig') && parsed.references) {
      for (const ref of parsed.references) {
        if (ref.path) {
          relationships.push({
            targetFilePath: ref.path,
            targetSymbol: '*',
            relationshipType: 'tsconfig_reference',
          });
        }
      }
    }

    // package.json dependencies
    if (fileName === 'package.json') {
      for (const depField of ['dependencies', 'devDependencies', 'peerDependencies']) {
        if (parsed[depField]) {
          for (const [pkg] of Object.entries(parsed[depField])) {
            relationships.push({
              targetFilePath: pkg,
              targetSymbol: '*',
              relationshipType: 'npm_dependency',
            });
          }
        }
      }
    }
  } catch {
    // Invalid JSON — skip extraction
  }

  return { symbols, relationships };
}

function extractMarkdownSymbols(content: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const name = headingMatch[2].trim();
      symbols.push({
        symbolType: `h${level}`,
        name,
        startLine: i + 1,
        endLine: i + 1,
        signature: `${'#'.repeat(level)} ${name}`,
        exports: false,
      });
    }
  }

  return { symbols, relationships: [] };
}

function extractCssSymbols(content: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relationships: ExtractedRelationship[] = [];

  // Extract @import relationships
  const importMatches = content.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g);
  for (const match of importMatches) {
    relationships.push({
      targetFilePath: match[1],
      targetSymbol: '*',
      relationshipType: 'css_import',
    });
  }

  // Extract selectors (class, id, element, pseudo)
  // Matches: .class, #id, element, [attr], ::pseudo
  const selectorRegex = /^([^{}\/\n][^{}]*?)(?=\s*\{)/gm;
  let match;
  const seen = new Set<string>();

  while ((match = selectorRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    // Skip @-rules, comments, and multi-selector groups — take first selector
    if (raw.startsWith('@') || raw.startsWith('/*')) continue;

    // Split grouped selectors and take each one
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      // Normalize: take just the first simple selector
      const simple = part.split(/\s+/)[0].split(':')[0].trim();
      if (!simple || simple === '*' || seen.has(simple)) continue;
      seen.add(simple);

      const isClass = simple.startsWith('.');
      const isId = simple.startsWith('#');
      const symbolType = isClass ? 'class-selector' : isId ? 'id-selector' : 'element-selector';
      const name = isClass || isId ? simple.slice(1) : simple;

      symbols.push({
        symbolType,
        name,
        startLine: 0,
        endLine: 0,
        signature: part,
        exports: false,
      });
    }
  }

  return { symbols, relationships };
}

function extractHtmlSymbols(content: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relationships: ExtractedRelationship[] = [];

  // Extract <script src="..."> references
  const scriptMatches = content.matchAll(/<script[^>]+src=["']([^"']+)["']/g);
  for (const match of scriptMatches) {
    relationships.push({
      targetFilePath: match[1],
      targetSymbol: '*',
      relationshipType: 'html_script',
    });
  }

  // Extract <link href="..."> references (stylesheets)
  const linkMatches = content.matchAll(/<link[^>]+href=["']([^"']+)["']/g);
  for (const match of linkMatches) {
    relationships.push({
      targetFilePath: match[1],
      targetSymbol: '*',
      relationshipType: 'html_link',
    });
  }

  // Extract element IDs
  const idMatches = content.matchAll(/\bid=["']([^"']+)["']/g);
  const seen = new Set<string>();
  for (const match of idMatches) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    symbols.push({
      symbolType: 'element-id',
      name: id,
      startLine: 0,
      endLine: 0,
      signature: `id="${id}"`,
      exports: false,
    });
  }

  return { symbols, relationships };
}

function extractYamlSymbols(content: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relationships: ExtractedRelationship[] = [];
  const lines = content.split('\n');

  // Extract top-level keys (lines that start at column 0 with a colon)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level key: not indented, followed by colon
    const match = line.match(/^([a-zA-Z_][\w-]*)\s*:/);
    if (match) {
      symbols.push({
        symbolType: 'key',
        name: match[1],
        startLine: i + 1,
        endLine: i + 1,
        signature: `${match[1]}:`,
        exports: false,
      });
    }
  }

  return { symbols, relationships };
}

// ── AST Helpers ────────────────────────────────────────────────────────────

function getStartLine(node: { loc?: { start: { line: number } } }): number {
  return node.loc?.start.line ?? 0;
}

function getEndLine(node: { loc?: { end: { line: number } } }): number {
  return node.loc?.end.line ?? 0;
}

function buildSignature(node: any): string {
  if (node.type === 'FunctionDeclaration') {
    const params = (node.params ?? [])
      .map((p: any) => {
        if (p.type === 'Identifier') return p.name;
        if (p.type === 'AssignmentPattern' && p.left?.type === 'Identifier') return p.left.name;
        if (p.type === 'RestElement' && p.argument?.type === 'Identifier') return `...${p.argument.name}`;
        return '...';
      })
      .join(', ');
    return `function ${node.id?.name ?? ''}(${params})`;
  }
  if (node.type === 'ClassDeclaration') {
    return `class ${node.id?.name ?? ''}`;
  }
  if (node.type === 'TSInterfaceDeclaration') {
    return `interface ${node.id?.name ?? ''}`;
  }
  if (node.type === 'TSTypeAliasDeclaration') {
    return `type ${node.id?.name ?? ''}`;
  }
  if (node.type === 'TSEnumDeclaration') {
    return `enum ${node.id?.name ?? ''}`;
  }
  return '';
}

// ── Symbol Extraction ──────────────────────────────────────────────────────

interface ExtractedSymbol {
  symbolType: string;
  name: string;
  startLine: number;
  endLine: number;
  signature: string;
  exports: boolean;
}

interface ExtractedRelationship {
  targetFilePath: string;
  targetSymbol: string;
  relationshipType: string;
}

interface ExtractionResult {
  symbols: ExtractedSymbol[];
  relationships: ExtractedRelationship[];
}

function extractFromAst(
  ast: ReturnType<typeof parse>,
  filePath: string,
  exportedNames: Set<string>
): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relationships: ExtractedRelationship[] = [];
  const localExportNames = new Set<string>();

  traverse(ast, {
    // ── Functions ──
    FunctionDeclaration(path: NodePath) {
      const node = path.node as any;
      if (!node.id) return;
      symbols.push({
        symbolType: 'function',
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature: buildSignature(node),
        exports: false,
      });
    },

    // ── Arrow / function expressions assigned to variables ──
    VariableDeclarator(path: NodePath) {
      const node = path.node as any;
      if (node.id?.type !== 'Identifier') return;
      const init = node.init;
      let symbolType = '';
      let signature = '';

      if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') {
        symbolType = 'function';
        const params = (init.params ?? [])
          .map((p: any) => {
            if (p.type === 'Identifier') return p.name;
            if (p.type === 'AssignmentPattern' && p.left?.type === 'Identifier') return p.left.name;
            return '...';
          })
          .join(', ');
        signature = `const ${node.id.name} = (${params}) => { ... }`;
      } else if (init?.type === 'CallExpression') {
        symbolType = 'variable';
        signature = `const ${node.id.name} = ${init.callee?.type === 'Identifier' ? init.callee.name : 'call'}(...)`;
      } else {
        return; // skip plain constants
      }

      symbols.push({
        symbolType,
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature,
        exports: false,
      });
    },

    // ── Classes ──
    ClassDeclaration(path: NodePath) {
      const node = path.node as any;
      if (!node.id) return;
      symbols.push({
        symbolType: 'class',
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature: buildSignature(node),
        exports: false,
      });

      // Extract methods
      for (const member of node.body?.body ?? []) {
        if (member.type === 'ClassMethod' && member.key) {
          const name = member.key.type === 'Identifier' ? member.key.name :
                       member.key.type === 'StringLiteral' ? member.key.value : '';
          if (!name) continue;
          const kind = member.kind === 'constructor' ? 'constructor' :
                       member.kind === 'get' ? 'getter' :
                       member.kind === 'set' ? 'setter' : 'method';
          symbols.push({
            symbolType: kind,
            name: `${node.id.name}.${name}`,
            startLine: getStartLine(member),
            endLine: getEndLine(member),
            signature: `${kind} ${node.id.name}.${name}()`,
            exports: false,
          });
        }
      }
    },

    // ── TypeScript interfaces ──
    TSInterfaceDeclaration(path: NodePath) {
      const node = path.node as any;
      if (!node.id) return;
      symbols.push({
        symbolType: 'interface',
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature: buildSignature(node),
        exports: false,
      });
    },

    // ── TypeScript type aliases ──
    TSTypeAliasDeclaration(path: NodePath) {
      const node = path.node as any;
      if (!node.id) return;
      symbols.push({
        symbolType: 'type',
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature: buildSignature(node),
        exports: false,
      });
    },

    // ── TypeScript enums ──
    TSEnumDeclaration(path: NodePath) {
      const node = path.node as any;
      if (!node.id) return;
      symbols.push({
        symbolType: 'enum',
        name: node.id.name,
        startLine: getStartLine(node),
        endLine: getEndLine(node),
        signature: buildSignature(node),
        exports: false,
      });
    },

    // ── Imports ──
    ImportDeclaration(path: NodePath) {
      const node = path.node as any;
      const source = node.source?.value;
      if (!source) return;

      const specifiers = node.specifiers ?? [];
      if (specifiers.length === 0) {
        // Side-effect import: import './foo'
        relationships.push({
          targetFilePath: source,
          targetSymbol: '*',
          relationshipType: 'side_effect_import',
        });
        return;
      }

      for (const spec of specifiers) {
        let symbolName = '*';
        if (spec.type === 'ImportSpecifier') {
          symbolName = spec.local?.name ?? spec.imported?.name ?? '*';
        } else if (spec.type === 'ImportDefaultSpecifier') {
          symbolName = 'default';
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          symbolName = '*';
        }

        relationships.push({
          targetFilePath: source,
          targetSymbol: symbolName,
          relationshipType: 'import',
        });
      }
    },

    // ── Named exports ──
    ExportNamedDeclaration(path: NodePath) {
      const node = path.node as any;

      // export function foo() ...
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'FunctionDeclaration' && decl.id) {
          localExportNames.add(decl.id.name);
        } else if (decl.type === 'ClassDeclaration' && decl.id) {
          localExportNames.add(decl.id.name);
        } else if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations ?? []) {
            if (d.id?.type === 'Identifier') {
              localExportNames.add(d.id.name);
            }
          }
        }
      }

      // export { a, b }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          const exported = spec.exported;
          const local = spec.local;
          const name = exported?.type === 'Identifier' ? exported.name : local?.name ?? '';
          if (name) localExportNames.add(name);
        }
      }
    },

    // ── Default exports ──
    ExportDefaultDeclaration(path: NodePath) {
      const node = path.node as any;
      if (node.declaration?.id?.type === 'Identifier') {
        localExportNames.add(node.declaration.id.name);
      }
    },
  });

  // Mark exported symbols
  for (const sym of symbols) {
    if (localExportNames.has(sym.name)) {
      sym.exports = true;
    }
  }

  // Also add export symbols for re-exports
  for (const name of localExportNames) {
    if (!symbols.some((s) => s.name === name)) {
      symbols.push({
        symbolType: 'export',
        name,
        startLine: 0,
        endLine: 0,
        signature: `export { ${name} }`,
        exports: true,
      });
    }
  }

  return { symbols, relationships };
}

// ── Parse Helpers ──────────────────────────────────────────────────────────

function tryParse(content: string, filePath: string): ReturnType<typeof parse> | null {
  const ext = path.extname(filePath).toLowerCase();
  const isTS = ext === '.ts' || ext === '.tsx';
  const isJSX = ext === '.jsx' || ext === '.tsx';

  const plugins: any[] = [];
  if (isTS) plugins.push('typescript');
  if (isJSX) plugins.push('jsx');

  try {
    return parse(content, {
      sourceType: 'module',
      plugins,
    });
  } catch {
    // If standard parse fails, try without plugins for plain JS files
    if (plugins.length > 0) {
      try {
        return parse(content, { sourceType: 'module' });
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── DB Helpers ─────────────────────────────────────────────────────────────

function insertRepoIndex(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  entry: RepoIndex
): void {
  db.run(
    `INSERT INTO repo_index (id, project_id, file_path, parent_path, file_type, language, file_size, symbol_count, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.projectId,
      entry.filePath,
      entry.parentPath,
      entry.fileType,
      entry.language,
      entry.fileSize,
      entry.symbolCount,
      entry.indexedAt,
    ]
  );
}

function insertCodeSymbol(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  sym: CodeSymbol
): void {
  db.run(
    `INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sym.id,
      sym.projectId,
      sym.fileId,
      sym.symbolType,
      sym.name,
      sym.startLine,
      sym.endLine,
      sym.signature,
      sym.exports ? 1 : 0,
    ]
  );
}

function insertCodeRelationship(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  rel: CodeRelationship
): void {
  db.run(
    `INSERT INTO code_relationships (id, project_id, source_file_id, target_file_path, target_symbol, relationship_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      rel.id,
      rel.projectId,
      rel.sourceFileId,
      rel.targetFilePath,
      rel.targetSymbol,
      rel.relationshipType,
    ]
  );
}

// ── Row Mappers ────────────────────────────────────────────────────────────

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
  };
}

function mapSymbolRow(row: unknown[]): CodeSymbol {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    fileId: row[2] as string,
    symbolType: row[3] as string,
    name: row[4] as string,
    startLine: (row[5] as number) ?? 0,
    endLine: (row[6] as number) ?? 0,
    signature: (row[7] as string) ?? '',
    exports: (row[8] as number) === 1,
  };
}

function mapRelationshipRow(row: unknown[]): CodeRelationship {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    sourceFileId: row[2] as string,
    targetFilePath: (row[3] as string) ?? '',
    targetSymbol: (row[4] as string) ?? '',
    relationshipType: row[5] as string,
  };
}

// ── Main Functions ─────────────────────────────────────────────────────────

/**
 * Index an entire project's artifacts into the repo_index, code_symbols,
 * and code_relationships tables. For each artifact, file content is read,
 * parsed with @babel/parser, and symbols/relationships are extracted.
 * Files that fail to parse are skipped silently.
 */
export async function indexProject(
  projectId: string,
  artifacts: Artifact[]
): Promise<void> {
  const db = await getDb();

  // Get workspace path
  const projStmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
  projStmt.bind([projectId]);
  let workspacePath = '';
  if (projStmt.step()) {
    workspacePath = (projStmt.get() as unknown[])[0] as string;
  }
  projStmt.free();

  // Clear previous index for this project
  db.run('DELETE FROM code_relationships WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM code_symbols WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM repo_index WHERE project_id = ?', [projectId]);

  const now = new Date().toISOString();
  const jsExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  ]);

  // Non-JS/TS extractors by extension
  const nonJsExtractors: Record<string, (content: string, filePath: string) => ExtractionResult> = {
    '.json': extractJsonSymbols,
    '.md': (c) => extractMarkdownSymbols(c),
    '.css': (c) => extractCssSymbols(c),
    '.html': (c) => extractHtmlSymbols(c),
    '.yml': (c) => extractYamlSymbols(c),
    '.yaml': (c) => extractYamlSymbols(c),
  };

  // Collect workspace output
  const wsFiles: any[] = [];
  const wsSymbols: any[] = [];
  const wsEdges: any[] = [];

  for (const artifact of artifacts) {
    try {
      const ext = path.extname(artifact.filePath).toLowerCase();
      const lang = detectLanguage(artifact.filePath);
      const fileSize = fs.statSync(artifact.filePath).size;
      const parentPath = path.dirname(artifact.filePath);
      const fileRecordId = crypto.randomUUID();

      // ── JS/TS: parse with Babel ──
      if (jsExtensions.has(ext)) {
        const content = await readArtifactContent(artifact.id);
        const ast = tryParse(content, artifact.filePath);

        if (!ast) {
          // File could not be parsed — record with 0 symbols
          const repoEntry: RepoIndex = {
            id: fileRecordId,
            projectId,
            filePath: artifact.filePath,
            parentPath,
            fileType: ext.replace('.', ''),
            language: lang,
            fileSize,
            symbolCount: 0,
            indexedAt: now,
          };
          insertRepoIndex(db, repoEntry);
          wsFiles.push({ id: fileRecordId, path: artifact.filePath, type: ext.replace('.', ''), language: lang, size: fileSize, symbols: [] });
          continue;
        }

        const { symbols, relationships } = extractFromAst(ast, artifact.filePath, new Set());

        // Insert repo_index record
        const repoEntry: RepoIndex = {
          id: fileRecordId,
          projectId,
          filePath: artifact.filePath,
          parentPath,
          fileType: ext.replace('.', ''),
          language: lang,
          fileSize,
          symbolCount: symbols.length,
          indexedAt: now,
        };
        insertRepoIndex(db, repoEntry);

        // Collect workspace symbols
        const fileSymbols = symbols.map(s => ({
          name: s.name,
          type: s.symbolType,
          line: s.startLine,
          endLine: s.endLine,
          signature: s.signature,
          exported: s.exports,
        }));
        wsSymbols.push(...fileSymbols.map(s => ({ ...s, file: artifact.filePath })));

        // Insert symbols
        for (const sym of symbols) {
          const symbolRecord: CodeSymbol = {
            id: crypto.randomUUID(),
            projectId,
            fileId: fileRecordId,
            symbolType: sym.symbolType,
            name: sym.name,
            startLine: sym.startLine,
            endLine: sym.endLine,
            signature: sym.signature,
            exports: sym.exports,
          };
          insertCodeSymbol(db, symbolRecord);
        }

        // Collect workspace edges
        for (const rel of relationships) {
          wsEdges.push({
            from: artifact.filePath,
            to: rel.targetFilePath,
            type: rel.relationshipType,
            symbol: rel.targetSymbol,
          });
        }

        // Insert relationships
        for (const rel of relationships) {
          const relRecord: CodeRelationship = {
            id: crypto.randomUUID(),
            projectId,
            sourceFileId: fileRecordId,
            targetFilePath: rel.targetFilePath,
            targetSymbol: rel.targetSymbol,
            relationshipType: rel.relationshipType,
          };
          insertCodeRelationship(db, relRecord);
        }

        wsFiles.push({
          id: fileRecordId,
          path: artifact.filePath,
          type: ext.replace('.', ''),
          language: lang,
          size: fileSize,
          symbols: fileSymbols,
        });
        continue;
      }

      // ── Non-JS/TS: use language-specific extractors ──
      {
        const extractor = nonJsExtractors[ext];
        let symbols: ExtractedSymbol[] = [];
        let relationships: ExtractedRelationship[] = [];

        if (extractor) {
          const content = await readArtifactContent(artifact.id);
          const result = extractor(content, artifact.filePath);
          symbols = result.symbols;
          relationships = result.relationships;
        }

        // Insert repo_index record
        const repoEntry: RepoIndex = {
          id: fileRecordId,
          projectId,
          filePath: artifact.filePath,
          parentPath,
          fileType: ext.replace('.', ''),
          language: lang,
          fileSize,
          symbolCount: symbols.length,
          indexedAt: now,
        };
        insertRepoIndex(db, repoEntry);

        // Collect and insert symbols
        const fileSymbols = symbols.map(s => ({
          name: s.name,
          type: s.symbolType,
          line: s.startLine,
          endLine: s.endLine,
          signature: s.signature,
          exported: s.exports,
        }));
        wsSymbols.push(...fileSymbols.map(s => ({ ...s, file: artifact.filePath })));

        for (const sym of symbols) {
          const symbolRecord: CodeSymbol = {
            id: crypto.randomUUID(),
            projectId,
            fileId: fileRecordId,
            symbolType: sym.symbolType,
            name: sym.name,
            startLine: sym.startLine,
            endLine: sym.endLine,
            signature: sym.signature,
            exports: sym.exports,
          };
          insertCodeSymbol(db, symbolRecord);
        }

        // Collect and insert relationships
        for (const rel of relationships) {
          wsEdges.push({
            from: artifact.filePath,
            to: rel.targetFilePath,
            type: rel.relationshipType,
            symbol: rel.targetSymbol,
          });
        }

        for (const rel of relationships) {
          const relRecord: CodeRelationship = {
            id: crypto.randomUUID(),
            projectId,
            sourceFileId: fileRecordId,
            targetFilePath: rel.targetFilePath,
            targetSymbol: rel.targetSymbol,
            relationshipType: rel.relationshipType,
          };
          insertCodeRelationship(db, relRecord);
        }

        wsFiles.push({
          id: fileRecordId,
          path: artifact.filePath,
          type: ext.replace('.', ''),
          language: lang,
          size: fileSize,
          symbols: fileSymbols,
        });
      }
    } catch (e) {
      // Skip unparseable or unreadable files
      console.error('[index] Error processing artifact:', artifact.filePath, e);
    }
  }

  saveDb();

  // Write workspace JSON files for visualization
  if (workspacePath) {
    const wsDir = path.join(workspacePath, '.centinel');
    fs.mkdirSync(wsDir, { recursive: true });

    fs.writeFileSync(path.join(wsDir, 'index.json'), JSON.stringify({
      projectId,
      indexedAt: now,
      fileCount: wsFiles.length,
      symbolCount: wsSymbols.length,
      edgeCount: wsEdges.length,
      files: wsFiles,
    }, null, 2));

    fs.writeFileSync(path.join(wsDir, 'graph.json'), JSON.stringify({
      nodes: wsFiles.map(f => ({
        id: f.id,
        path: f.path,
        type: f.type,
        language: f.language,
        symbolCount: f.symbols.length,
      })),
      edges: wsEdges,
    }, null, 2));

    console.log(`[index] Workspace files written to ${wsDir}`);
  }
}

/**
 * List all indexed files for a project.
 */
export async function getIndexedFiles(projectId: string): Promise<RepoIndex[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, file_path, parent_path, file_type, language, file_size, symbol_count, indexed_at FROM repo_index WHERE project_id = ? ORDER BY file_path'
  );
  stmt.bind([projectId]);
  const rows: RepoIndex[] = [];
  while (stmt.step()) {
    rows.push(mapRepoIndexRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

/**
 * Get all symbols for a specific indexed file.
 */
export async function getFileSymbols(fileId: string): Promise<CodeSymbol[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports FROM code_symbols WHERE file_id = ? ORDER BY start_line'
  );
  stmt.bind([fileId]);
  const rows: CodeSymbol[] = [];
  while (stmt.step()) {
    rows.push(mapSymbolRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

/**
 * Get what a file imports (dependencies).
 */
export async function getDependencies(fileId: string): Promise<CodeRelationship[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, project_id, source_file_id, target_file_path, target_symbol, relationship_type
     FROM code_relationships
     WHERE source_file_id = ? AND relationship_type IN ('import', 'side_effect_import')
     ORDER BY target_file_path`
  );
  stmt.bind([fileId]);
  const rows: CodeRelationship[] = [];
  while (stmt.step()) {
    rows.push(mapRelationshipRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

/**
 * Get what imports this file (dependents / reverse dependencies).
 */
export async function getDependents(fileId: string): Promise<CodeRelationship[]> {
  const db = await getDb();
  // First, resolve the file path from the fileId
  const fileStmt = db.prepare('SELECT file_path FROM repo_index WHERE id = ?');
  fileStmt.bind([fileId]);
  let filePath = '';
  if (fileStmt.step()) {
    filePath = (fileStmt.get() as unknown[])[0] as string;
  }
  fileStmt.free();

  if (!filePath) return [];

  // Find all relationships that point to this file path
  const stmt = db.prepare(
    `SELECT id, project_id, source_file_id, target_file_path, target_symbol, relationship_type
     FROM code_relationships
     WHERE target_file_path = ? AND relationship_type IN ('import', 'side_effect_import')
     ORDER BY source_file_id`
  );
  stmt.bind([filePath]);
  const rows: CodeRelationship[] = [];
  while (stmt.step()) {
    rows.push(mapRelationshipRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

// ── Symbol Search & Fetch ─────────────────────────────────────────────────

export async function searchSymbols(
  projectId: string,
  query: string,
  limit: number = 50
): Promise<{
  matches: Array<{
    symbolId: string;
    name: string;
    symbolType: string;
    filePath: string;
    signature: string;
    startLine: number;
    endLine: number;
  }>;
  totalMatches: number;
}> {
  const db = await getDb();
  const pattern = `%${query}%`;

  // Count first (so totalMatches reflects the true total, not the LIMIT)
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM code_symbols WHERE project_id = ? AND name LIKE ?`
  );
  countStmt.bind([projectId, pattern]);
  let totalMatches = 0;
  if (countStmt.step()) {
    totalMatches = (countStmt.get() as unknown[])[0] as number;
  }
  countStmt.free();

  // Then fetch the page
  const stmt = db.prepare(
    `SELECT cs.id, cs.symbol_type, cs.name, cs.signature, cs.start_line, cs.end_line, r.file_path
     FROM code_symbols cs
     JOIN repo_index r ON r.id = cs.file_id
     WHERE cs.project_id = ? AND cs.name LIKE ?
     ORDER BY cs.name
     LIMIT ?`
  );
  stmt.bind([projectId, pattern, limit]);

  const matches: Array<{
    symbolId: string;
    name: string;
    symbolType: string;
    filePath: string;
    signature: string;
    startLine: number;
    endLine: number;
  }> = [];
  while (stmt.step()) {
    const row = stmt.get() as unknown[];
    matches.push({
      symbolId: row[0] as string,
      symbolType: row[1] as string,
      name: row[2] as string,
      signature: (row[3] as string) ?? '',
      startLine: (row[4] as number) ?? 0,
      endLine: (row[5] as number) ?? 0,
      filePath: (row[6] as string) ?? '',
    });
  }
  stmt.free();

  return { matches, totalMatches };
}

export class SymbolNotFound extends Error {
  constructor(filePath: string, symbolName: string) {
    super(`SymbolNotFound: "${symbolName}" not found in ${filePath}`);
    this.name = 'SymbolNotFound';
  }
}

export async function getSymbolBody(
  projectId: string,
  filePath: string,
  symbolName: string
): Promise<{
  name: string;
  symbolType: string;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  fileTotalLines: number;
}> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT cs.name, cs.symbol_type, cs.start_line, cs.end_line
     FROM code_symbols cs
     JOIN repo_index r ON r.id = cs.file_id
     WHERE cs.project_id = ? AND r.file_path = ? AND cs.name = ?
     LIMIT 1`
  );
  stmt.bind([projectId, filePath, symbolName]);

  if (!stmt.step()) {
    stmt.free();
    throw new SymbolNotFound(filePath, symbolName);
  }
  const row = stmt.get() as unknown[];
  stmt.free();

  const name = row[0] as string;
  const symbolType = row[1] as string;
  const startLine = (row[2] as number) ?? 0;
  const endLine = (row[3] as number) ?? 0;

  // Read the file and slice by line range. The DB stores 1-indexed lines.
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const body = lines.slice(startLine - 1, endLine).join('\n');

  return {
    name,
    symbolType,
    filePath,
    startLine,
    endLine,
    body,
    fileTotalLines: lines.length,
  };
}
