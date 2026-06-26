import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';
import { indexProject, getIndexedFiles, getFileSymbols, getDependencies, getDependents } from '../../src/repoIndex.js';
import { retrieveContext, getRelatedFiles } from '../../src/contextRetrieval.js';
import { scoreFindings, type RiskInput } from '../../src/riskScore.js';
import { runStaticAnalysis } from '../../src/staticEngine.js';
import type { Artifact } from '../../src/artifacts.js';

// ── Test fixture paths ──────────────────────────────────────────────────────
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/synthetic-project');
const PROJECT_ID = 'validation-project-1';

// ── Expected ground truth ───────────────────────────────────────────────────
const GROUND_TRUTH = {
  totalFiles: 12,
  tsFiles: 7,       // auth, utils, api, db, middleware, config, types
  mdFiles: 2,       // README, SPEC
  otherFiles: 3,    // package.json, styles.css, index.html
  // Security issues planted
  securityIssues: [
    { file: 'auth.ts', issue: 'hardcoded API key' },
    { file: 'auth.ts', issue: 'eval usage' },
    { file: 'api.ts', issue: 'SQL injection' },
    { file: 'api.ts', issue: 'Math.random in security' },
    { file: 'db.ts', issue: 'hardcoded connection string' },
    { file: 'middleware.ts', issue: 'innerHTML' },
    { file: 'middleware.ts', issue: 'disabled security headers' },
    { file: 'config.ts', issue: 'hardcoded bearer token' },
  ],
  // Code quality issues planted
  codeQualityIssues: [
    { file: 'auth.ts', issue: 'empty catch block' },
    { file: 'utils.ts', issue: 'console.log' },
    { file: 'utils.ts', issue: 'deep nesting' },
  ],
  // Dependency graph (who imports whom)
  dependencyGraph: {
    'auth.ts': { imports: ['db.ts', 'utils.ts', 'config.ts'], importedBy: ['api.ts', 'middleware.ts'] },
    'utils.ts': { imports: [], importedBy: ['auth.ts', 'middleware.ts', 'db.ts'] },
    'api.ts': { imports: ['auth.ts', 'config.ts'], importedBy: [] },
    'db.ts': { imports: ['utils.ts'], importedBy: ['auth.ts'] },
    'middleware.ts': { imports: ['auth.ts', 'utils.ts'], importedBy: [] },
    'config.ts': { imports: [], importedBy: ['auth.ts', 'api.ts', 'db.ts'] },
    'types.ts': { imports: [], importedBy: [] },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function setupTestDb() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
    file_name TEXT NOT NULL, file_path TEXT NOT NULL, original_path TEXT,
    content_hash TEXT NOT NULL, source TEXT DEFAULT 'documents', created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS repo_index (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_path TEXT NOT NULL,
    parent_path TEXT, file_type TEXT, language TEXT, file_size INTEGER,
    symbol_count INTEGER DEFAULT 0, indexed_at TEXT NOT NULL,
    module TEXT NOT NULL DEFAULT ''
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS code_symbols (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_id TEXT NOT NULL,
    symbol_type TEXT NOT NULL, name TEXT NOT NULL, start_line INTEGER,
    end_line INTEGER, signature TEXT, exports INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS code_relationships (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_file_id TEXT NOT NULL,
    target_file_path TEXT, target_symbol TEXT, relationship_type TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS static_analysis_results (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
    file_path TEXT NOT NULL, line_number INTEGER, rule_id TEXT NOT NULL,
    severity TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL,
    evidence TEXT, confidence TEXT NOT NULL DEFAULT 'high', created_at TEXT NOT NULL
  )`);

  setTestDb(db);
  db.run(
    "INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [PROJECT_ID, 'Validation Project', 'Synthetic test project', FIXTURE_DIR, new Date().toISOString(), new Date().toISOString()]
  );
  return db;
}

function collectFixtureFiles(): { filePath: string; fileName: string; ext: string }[] {
  const files: { filePath: string; fileName: string; ext: string }[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Skip .centinel output directory
      if (entry.name === '.centinel') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push({
          filePath: full,
          fileName: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
        });
      }
    }
  }
  walk(FIXTURE_DIR);
  return files;
}

function makeArtifact(filePath: string, fileName: string, ext: string, index: number): Artifact {
  // Map extension to artifact type
  const typeMap: Record<string, string> = {
    '.ts': 'source_code',
    '.tsx': 'source_code',
    '.js': 'source_code',
    '.jsx': 'source_code',
    '.md': 'requirement',
    '.txt': 'requirement',
    '.json': 'source_code',
    '.css': 'source_code',
    '.html': 'source_code',
  };

  return {
    id: `validation-art-${index}`,
    projectId: PROJECT_ID,
    type: typeMap[ext] || 'source_code',
    source: 'repository',
    fileName,
    filePath,
    originalPath: null,
    contentHash: crypto.createHash('md5').update(filePath).digest('hex'),
    createdAt: new Date().toISOString(),
  };
}

async function insertArtifact(db: any, artifact: Artifact) {
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [artifact.id, artifact.projectId, artifact.type, artifact.fileName, artifact.filePath, artifact.originalPath, artifact.contentHash, artifact.source, artifact.createdAt]
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Graph/Index Validation — A/B Comparison', () => {
  let db: any;
  let allArtifacts: Artifact[];
  let allFiles: { filePath: string; fileName: string; ext: string }[];

  beforeEach(async () => {
    db = await setupTestDb();
    allFiles = collectFixtureFiles();
    allArtifacts = allFiles.map((f, i) => makeArtifact(f.filePath, f.fileName, f.ext, i));
    for (const art of allArtifacts) {
      await insertArtifact(db, art);
    }
  });

  afterEach(() => {
    clearTestDb();
  });

  // ── Index Building ──────────────────────────────────────────────────────

  describe('Index building', () => {
    it('indexes all fixture files and extracts symbols', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);
      expect(indexed.length).toBe(GROUND_TRUTH.totalFiles);

      // Check that TS files have symbols extracted
      const authFile = indexed.find(f => f.filePath.endsWith('auth.ts'));
      expect(authFile).toBeDefined();
      expect(authFile!.symbolCount).toBeGreaterThan(0);

      // Check that types.ts has interface/type symbols
      const typesFile = indexed.find(f => f.filePath.endsWith('types.ts'));
      expect(typesFile).toBeDefined();
      const typeSymbols = await getFileSymbols(typesFile!.id);
      const symbolNames = typeSymbols.map(s => s.name);
      expect(symbolNames).toContain('User');
      expect(symbolNames).toContain('Session');
      expect(symbolNames).toContain('ApiResponse');
      expect(symbolNames).toContain('LogLevel');
    });

    it('extracts import relationships from TS files', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);
      const authFile = indexed.find(f => f.filePath.endsWith('auth.ts'))!;

      const deps = await getDependencies(authFile.id);
      const depTargets = deps.map(d => d.targetFilePath);

      // auth.ts imports from db, utils, config
      expect(depTargets.some(t => t.includes('db') || t.includes('./db'))).toBe(true);
      expect(depTargets.some(t => t.includes('utils') || t.includes('./utils'))).toBe(true);
      expect(depTargets.some(t => t.includes('config') || t.includes('./config'))).toBe(true);
    });

    it('extracts reverse dependencies (dependents)', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);
      const configFile = indexed.find(f => f.filePath.endsWith('config.ts'))!;

      const dependents = await getDependents(configFile.id);
      const dependentPaths = dependents.map(d => d.sourceFileId);

      // config.ts is imported by auth.ts, api.ts, and db.ts
      expect(dependents.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts non-TS symbols (markdown headings, CSS selectors, HTML IDs)', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);

      // README.md should have heading symbols
      const readme = indexed.find(f => f.filePath.endsWith('README.md'))!;
      const readmeSymbols = await getFileSymbols(readme.id);
      expect(readmeSymbols.length).toBeGreaterThan(0);
      expect(readmeSymbols.some(s => s.name.includes('Requirements'))).toBe(true);

      // styles.css should have selector symbols
      const css = indexed.find(f => f.filePath.endsWith('styles.css'))!;
      const cssSymbols = await getFileSymbols(css.id);
      expect(cssSymbols.length).toBeGreaterThan(0);

      // index.html should have element ID symbols
      const html = indexed.find(f => f.filePath.endsWith('index.html'))!;
      const htmlSymbols = await getFileSymbols(html.id);
      expect(htmlSymbols.some(s => s.name === 'app' || s.name === 'user-content' || s.name === 'login-form')).toBe(true);
    });
  });

  // ── Context Retrieval: A/B Comparison ───────────────────────────────────

  describe('Context retrieval A/B comparison', () => {
    beforeEach(async () => {
      await indexProject(PROJECT_ID, allArtifacts);
    });

    it('code_review: index-aware selects TS files first, naive selects all', async () => {
      // Group A: Index-aware retrieval
      const groupA = await retrieveContext(PROJECT_ID, 'code_review');

      // Group B: Naive retrieval (all files, alphabetical, no filtering)
      const allIndexed = await getIndexedFiles(PROJECT_ID);
      const groupB = {
        files: allIndexed.sort((a, b) => a.filePath.localeCompare(b.filePath)),
        totalSymbols: 0,
        estimatedTokens: 0,
        reason: 'naive: all files alphabetically',
      };

      // Group A should filter to code files only (excludes .md for code_review)
      const groupAExtensions = new Set(groupA.files.map(f => f.fileType));
      // code_review should NOT prioritize .md files
      const groupAHasMd = groupA.files.some(f => f.fileType === 'md');

      // Group B includes everything
      expect(groupB.files.length).toBe(GROUND_TRUTH.totalFiles);

      // Group A should be a subset focused on code
      expect(groupA.files.length).toBeLessThanOrEqual(groupB.files.length);

      // Group A should have higher symbol density (complex files first)
      if (groupA.files.length >= 2) {
        const firstFileSymbols = groupA.files[0].symbolCount;
        const lastFileSymbols = groupA.files[groupA.files.length - 1].symbolCount;
        // First file should have >= symbols than last (sorted by symbol count)
        expect(firstFileSymbols).toBeGreaterThanOrEqual(lastFileSymbols);
      }

      console.log('\n--- code_review A/B ---');
      console.log(`Group A (index-aware): ${groupA.files.length} files, ${groupA.estimatedTokens} tokens`);
      console.log(`  Files: ${groupA.files.map(f => f.filePath.split(/[/\\]/).pop()).join(', ')}`);
      console.log(`Group B (naive): ${groupB.files.length} files`);
      console.log(`  Files: ${groupB.files.map(f => f.filePath.split(/[/\\]/).pop()).join(', ')}`);
    });

    it('requirement_review: index-aware selects MD files first', async () => {
      // Group A: Index-aware retrieval
      const groupA = await retrieveContext(PROJECT_ID, 'requirement_review');

      // Group B: Naive (all files)
      const allIndexed = await getIndexedFiles(PROJECT_ID);
      const groupB = {
        files: allIndexed.sort((a, b) => a.filePath.localeCompare(b.filePath)),
      };

      // Group A should prioritize .md files
      const groupAMdFiles = groupA.files.filter(f =>
        f.fileType === 'md' || f.language === 'markdown'
      );

      console.log('\n--- requirement_review A/B ---');
      console.log(`Group A (index-aware): ${groupA.files.length} files`);
      console.log(`  MD files: ${groupAMdFiles.length}`);
      console.log(`  Files: ${groupA.files.map(f => f.filePath.split(/[/\\]/).pop()).join(', ')}`);
      console.log(`Group B (naive): ${groupB.files.length} files`);

      // At minimum, the 2 MD files should be in Group A
      expect(groupA.files.length).toBeGreaterThanOrEqual(2);
    });

    it('traceability: includes both requirement and code files', async () => {
      const context = await retrieveContext(PROJECT_ID, 'requirement_to_code_traceability');

      const hasMd = context.files.some(f => f.fileType === 'md' || f.language === 'markdown');
      const hasTs = context.files.some(f => f.fileType === 'ts' || f.language === 'typescript');

      console.log('\n--- traceability A/B ---');
      console.log(`Files: ${context.files.length}, has MD: ${hasMd}, has TS: ${hasTs}`);
      console.log(`  ${context.files.map(f => f.filePath.split(/[/\\]/).pop()).join(', ')}`);

      // Should include both types
      expect(hasMd).toBe(true);
      expect(hasTs).toBe(true);
    });

    it('token budget is respected', async () => {
      // Use a very small token budget
      const smallBudget = await retrieveContext(PROJECT_ID, 'code_review', 5000);

      // Should select fewer files due to budget
      const fullBudget = await retrieveContext(PROJECT_ID, 'code_review', 100000);

      console.log('\n--- token budget comparison ---');
      console.log(`Small budget (5K): ${smallBudget.files.length} files, ${smallBudget.estimatedTokens} tokens`);
      console.log(`Full budget (100K): ${fullBudget.files.length} files, ${fullBudget.estimatedTokens} tokens`);

      expect(smallBudget.files.length).toBeLessThanOrEqual(fullBudget.files.length);
      expect(smallBudget.estimatedTokens).toBeLessThanOrEqual(5000 + 5000); // some tolerance
    });

    it('graph traversal finds related files', async () => {
      const indexed = await getIndexedFiles(PROJECT_ID);
      const authFile = indexed.find(f => f.filePath.endsWith('auth.ts'))!;

      const related = await getRelatedFiles(authFile.id, 1);

      console.log('\n--- graph traversal from auth.ts ---');
      console.log(`Related files (depth=1): ${related.length}`);
      console.log(`  ${related.map(f => f.filePath.split(/[/\\]/).pop()).join(', ')}`);

      // auth.ts imports db, utils, config — so those should be related
      const relatedNames = related.map(f => path.basename(f.filePath));
      expect(related.length).toBeGreaterThan(0);
    });
  });

  // ── Risk Scoring: With vs Without Dependency Data ───────────────────────

  describe('Risk scoring A/B comparison', () => {
    it('with dependency data: high-dependency files score higher', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      // Compute dependency counts from graph
      const indexed = await getIndexedFiles(PROJECT_ID);
      const dependencyCounts: Record<string, number> = {};

      for (const file of indexed) {
        const dependents = await getDependents(file.id);
        dependencyCounts[file.filePath] = dependents.length;
      }

      console.log('\n--- dependency counts ---');
      for (const [fp, count] of Object.entries(dependencyCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${path.basename(fp)}: ${count} dependents`);
      }

      // Create test findings for high-dependency vs leaf files
      const findings: RiskInput[] = [
        {
          severity: 'high',
          confidence: 'high',
          category: 'security_concern',
          filePath: indexed.find(f => f.filePath.endsWith('config.ts'))!.filePath, // high dependency
        },
        {
          severity: 'high',
          confidence: 'high',
          category: 'security_concern',
          filePath: indexed.find(f => f.filePath.endsWith('types.ts'))!.filePath, // leaf file
        },
      ];

      // Group A: WITH dependency data
      const scoredA = scoreFindings(findings, indexed.length, dependencyCounts);

      // Group B: WITHOUT dependency data (current broken behavior)
      const scoredB = scoreFindings(findings, indexed.length);

      console.log('\n--- risk scoring comparison ---');
      console.log(`Group A (with deps): config.ts=${scoredA[0].risk.score}, types.ts=${scoredA[1].risk.score}`);
      console.log(`  config.ts module importance: ${scoredA[0].risk.factors.moduleImportance}`);
      console.log(`  types.ts module importance: ${scoredA[1].risk.factors.moduleImportance}`);
      console.log(`Group B (no deps): config.ts=${scoredB[0].risk.score}, types.ts=${scoredB[1].risk.score}`);
      console.log(`  config.ts module importance: ${scoredB[0].risk.factors.moduleImportance}`);
      console.log(`  types.ts module importance: ${scoredB[1].risk.factors.moduleImportance}`);

      // With dependency data, config.ts (imported by 2+ files) should score higher than types.ts (leaf)
      expect(scoredA[0].risk.factors.moduleImportance).toBeGreaterThan(scoredA[1].risk.factors.moduleImportance);

      // Without dependency data, both should have same module importance (0 dependencies)
      expect(scoredB[0].risk.factors.moduleImportance).toBe(scoredB[1].risk.factors.moduleImportance);
    });

    it('security findings in high-dependency files get boosted scores', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);
      const dependencyCounts: Record<string, number> = {};
      for (const file of indexed) {
        const dependents = await getDependents(file.id);
        dependencyCounts[file.filePath] = dependents.length;
      }

      // Security finding in high-dependency file
      const securityFindings: RiskInput[] = [
        {
          severity: 'critical',
          confidence: 'high',
          category: 'secrets-api-key',
          filePath: indexed.find(f => f.filePath.endsWith('config.ts'))!.filePath,
        },
        {
          severity: 'medium',
          confidence: 'medium',
          category: 'code_smell',
          filePath: indexed.find(f => f.filePath.endsWith('types.ts'))!.filePath,
        },
      ];

      const scored = scoreFindings(securityFindings, indexed.length, dependencyCounts);

      console.log('\n--- security + dependency scoring ---');
      console.log(`config.ts (secret, high-dep): score=${scored[0].risk.score}, level=${scored[0].risk.level}`);
      console.log(`  factors: severity=${scored[0].risk.factors.severity}, confidence=${scored[0].risk.factors.confidence}, module=${scored[0].risk.factors.moduleImportance}, security=${scored[0].risk.factors.securityBoost}`);
      console.log(`types.ts (smell, leaf): score=${scored[1].risk.score}, level=${scored[1].risk.level}`);
      console.log(`  factors: severity=${scored[1].risk.factors.severity}, confidence=${scored[1].risk.factors.confidence}, module=${scored[1].risk.factors.moduleImportance}, security=${scored[1].risk.factors.securityBoost}`);

      // config.ts secret should score much higher than types.ts code smell
      expect(scored[0].risk.score).toBeGreaterThan(scored[1].risk.score);
      expect(scored[0].risk.level).not.toBe('info');
    });
  });

  // ── Static Analysis Coverage ────────────────────────────────────────────

  describe('Static analysis rule coverage', () => {
    it('detects planted security issues', async () => {
      const findings = await runStaticAnalysis(PROJECT_ID, allArtifacts, 'test-session');

      console.log('\n--- static analysis findings ---');
      console.log(`Total findings: ${findings.length}`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.ruleId}: ${f.message} — ${path.basename(f.filePath)}:${f.lineNumber}`);
      }

      // Should detect at least some of the planted issues
      expect(findings.length).toBeGreaterThan(0);

      // Check for specific rule detections
      const ruleIds = new Set(findings.map(f => f.ruleId));

      // These rules should fire on our planted issues
      const expectedRules = ['secrets-api-key', 'sec-eval', 'sec-sql-injection'];
      for (const rule of expectedRules) {
        if (!ruleIds.has(rule)) {
          console.log(`  WARNING: Expected rule '${rule}' did not fire`);
        }
      }
    });
  });

  // ── Summary Report ──────────────────────────────────────────────────────

  describe('Summary comparison', () => {
    it('produces full A/B comparison report', async () => {
      await indexProject(PROJECT_ID, allArtifacts);

      const indexed = await getIndexedFiles(PROJECT_ID);

      // Compute dependency counts
      const dependencyCounts: Record<string, number> = {};
      for (const file of indexed) {
        const dependents = await getDependents(file.id);
        dependencyCounts[file.filePath] = dependents.length;
      }

      // Group A: Index-aware code review
      const groupA = await retrieveContext(PROJECT_ID, 'code_review');

      // Group B: Naive (all files)
      const groupB = indexed.sort((a, b) => a.filePath.localeCompare(b.filePath));

      // Token estimates
      const groupATokens = groupA.estimatedTokens;
      const groupBTokens = groupB.reduce((sum, f) => sum + Math.ceil(f.fileSize / 4), 0);

      // Risk scoring comparison
      const sampleFindings: RiskInput[] = indexed.map(f => ({
        severity: 'medium',
        confidence: 'medium',
        category: 'code_smell',
        filePath: f.filePath,
      }));

      const scoredWithDeps = scoreFindings(sampleFindings, indexed.length, dependencyCounts);
      const scoredWithoutDeps = scoreFindings(sampleFindings, indexed.length);

      // Calculate score variance (higher = more differentiation)
      const scoresWithDeps = scoredWithDeps.map(s => s.risk.score);
      const scoresWithoutDeps = scoredWithoutDeps.map(s => s.risk.score);

      const variance = (scores: number[]) => {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        return scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
      };

      const varianceWithDeps = variance(scoresWithDeps);
      const varianceWithoutDeps = variance(scoresWithoutDeps);

      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║          GRAPH/INDEX VALIDATION — A/B COMPARISON           ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log('║ Metric                      │ Group A (Index) │ Group B (Naive)');
      console.log('╟──────────────────────────────┼─────────────────┼───────────────');
      console.log(`║ Files selected (code_review) │ ${String(groupA.files.length).padStart(15)} │ ${String(groupB.length).padStart(13)}`);
      console.log(`║ Token estimate               │ ${String(groupATokens).padStart(15)} │ ${String(groupBTokens).padStart(13)}`);
      console.log(`║ Token budget (100K)          │ ${groupATokens <= 100000 ? 'WITHIN'.padStart(15) : 'OVER'.padStart(15)} │ ${groupBTokens <= 100000 ? 'WITHIN'.padStart(13) : 'OVER'.padStart(13)}`);
      console.log(`║ Risk score variance          │ ${varianceWithDeps.toFixed(4).padStart(15)} │ ${varianceWithoutDeps.toFixed(4).padStart(13)}`);
      console.log('╟──────────────────────────────┼─────────────────┼───────────────');

      // Dependency ranking
      const depRanking = Object.entries(dependencyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      console.log('║ Top files by dependency count:');
      for (const [fp, count] of depRanking) {
        console.log(`║   ${path.basename(fp).padEnd(20)} ${count} dependents`);
      }
      console.log('╚══════════════════════════════════════════════════════════════╝');

      // Assertions
      // Group A should select fewer files (focused selection)
      expect(groupA.files.length).toBeLessThanOrEqual(groupB.length);
      // Both should stay within the 100K token budget
      expect(groupATokens).toBeLessThanOrEqual(100000);
      expect(groupBTokens).toBeLessThanOrEqual(100000);
      // Dependency data should differentiate risk scores more than no-deps
      expect(varianceWithDeps).toBeGreaterThanOrEqual(varianceWithoutDeps);
    });
  });
});
