/**
 * Test plan generator (Group 2c, Stage 5).
 *
 * Runs after Stage 4 (Summarize) completes successfully. Takes the
 * session's findings + the project's module structure, and produces a
 * list of test items grouped by module:
 *
 *   - For each finding: 1-3 test items derived from the finding's
 *     evidence. Rationale column = the finding id. Inherits the
 *     finding's severity so the dashboard can sort by importance.
 *
 *   - For each module with zero findings: 1 smoke test that exercises
 *     the public surface. Rationale = 'smoke'. Severity = 'low'
 *     (these are nice-to-have, not blockers).
 *
 * The generator is the same shape as the review stages: a prompt +
 * a parser + a per-item creator. It's deliberately NOT part of the
 * ReviewStageId union — the user-visible stage list stays at 4
 * (Understanding → Code → Traceability → Summarize) and the test
 * plan is its own "sidecar" step that runs after the dashboard
 * already shows the review as 'success'.
 */

import { callAi } from './staticReview.js';
import { listStaticFindings } from './staticSessions.js';
import { getDb } from './db.js';
import {
  createTestItem,
  clearTestItemsForSession,
  isValidKind,
  isValidSeverity,
  type TestItemKind,
  type TestItemSeverity,
} from './testPlan.js';

const TEST_PLAN_PROMPT = {
  system: `You are a test planner working from a static-review finding. Given one finding at a time, suggest 1-3 test items a QA engineer would write to verify the fix.

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning as you read the finding
- items: array of test items, each with:
  - title: short, imperative ("Verify login rejects empty password")
  - description: 1-3 sentences explaining the scenario, preconditions, and expected outcome
  - kind: one of "unit" | "integration" | "e2e" | "smoke"
  - severity: one of "critical" | "high" | "medium" | "low" | "info" — typically equal to the finding's severity, but drop one level for "info"-tier findings (rarely worth a test on its own)

Aim for one strong test per finding; a second only if the finding covers multiple distinct scenarios. Empty items array [] is acceptable when the finding is too vague to act on.

Return ONLY the JSON object, no other text.`,
  build: (finding: { title: string; description: string; severity: string; filePath: string; lineNumber: number | null; evidence: string; category: string; recommendation: string }) => `## Finding to plan tests for

Title: ${finding.title}
Severity: ${finding.severity}
Category: ${finding.category}
File: ${finding.filePath}${finding.lineNumber != null ? ':' + finding.lineNumber : ''}

Description:
${finding.description}

Evidence:
${finding.evidence || '(none)'}

Recommendation:
${finding.recommendation || '(none)'}

Suggest test items that would catch a regression of this issue or verify the fix.`,
};

const SMOKE_TEST_PROMPT = {
  system: `You are a test planner. Given a module (a folder of source files) that has no findings, suggest ONE smoke test that exercises the module's main public surface.

The smoke test should be fast, dependency-light, and fail loudly if the module is broken on import or if its top-level exports are inaccessible. It's a regression canary, not a thorough test.

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning
- items: array with EXACTLY ONE test item:
  - title: short, imperative
  - description: 2-3 sentences; preconditions + expected outcome
  - kind: MUST be "smoke"
  - severity: MUST be "low" (these are canaries, not blockers)

Return ONLY the JSON object, no other text.`,
  build: (module: string, fileCount: number, sampleFiles: string[]) => `## Module under test

Module: ${module}
Files: ${fileCount}
Sample paths:
${sampleFiles.map(f => '  - ' + f).join('\n')}

The module has no findings from the static review. Suggest a single smoke test that would catch a regression on the public surface.`,
};

type AiTestItem = {
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  severity?: unknown;
};

type AiResponse = {
  thoughts?: unknown;
  items?: unknown;
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isAiResponse(v: unknown): v is AiResponse {
  return typeof v === 'object' && v !== null;
}

async function generateForFinding(
  projectId: string,
  sessionId: string,
  finding: {
    id: string;
    title: string;
    description: string;
    severity: string;
    filePath: string;
    lineNumber: number | null;
    evidence: string;
    category: string;
    recommendation: string;
  }
): Promise<number> {
  const response = await callAi(
    TEST_PLAN_PROMPT.build(finding),
    TEST_PLAN_PROMPT.system
  );
  let parsed: unknown = null;
  try { parsed = JSON.parse(response); } catch { return 0; }
  if (!isAiResponse(parsed)) return 0;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  let created = 0;
  for (const raw of items) {
    if (!isAiResponse(raw)) continue;
    const item = raw as AiTestItem;
    const title = asString(item.title).trim();
    const description = asString(item.description).trim();
    const kind = isValidKind(item.kind) ? item.kind : 'unit';
    const severity: TestItemSeverity = isValidSeverity(item.severity)
      ? item.severity
      : isValidSeverity(finding.severity)
        ? finding.severity
        : 'medium';
    if (!title || !description) continue;
    await createTestItem({
      sessionId,
      projectId,
      module: deriveModuleFromPath(finding.filePath),
      filePath: finding.filePath,
      lineNumber: finding.lineNumber,
      title,
      description,
      rationale: finding.id,
      kind,
      severity,
    });
    created++;
  }
  return created;
}

async function generateForModule(
  projectId: string,
  sessionId: string,
  module: string,
  sampleFiles: string[]
): Promise<number> {
  if (sampleFiles.length === 0) return 0;
  const response = await callAi(
    SMOKE_TEST_PROMPT.build(module, sampleFiles.length, sampleFiles.slice(0, 6)),
    SMOKE_TEST_PROMPT.system
  );
  let parsed: unknown = null;
  try { parsed = JSON.parse(response); } catch { return 0; }
  if (!isAiResponse(parsed)) return 0;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  let created = 0;
  for (const raw of items) {
    if (!isAiResponse(raw)) continue;
    const item = raw as AiTestItem;
    const title = asString(item.title).trim();
    const description = asString(item.description).trim();
    const kind: TestItemKind = isValidKind(item.kind) ? item.kind : 'smoke';
    if (!title || !description) continue;
    if (kind !== 'smoke') continue; // smoke-only by design for this prompt
    await createTestItem({
      sessionId,
      projectId,
      module,
      title,
      description,
      rationale: 'smoke',
      kind: 'smoke',
      severity: 'low',
    });
    created++;
  }
  return created;
}

/**
 * Top-level orchestrator. Wipes any existing test items for the
 * session (the user's regenerate call) and re-runs the full pipeline:
 *
 *   1. Pull all findings for the session (unified + static-rule).
 *   2. Group by module (via deriveModuleFromPath on filePath).
 *   3. For each finding: AI-generate 1-3 items, rationale=id.
 *   4. For each module with no findings: 1 smoke test.
 *   5. For each module that has no repo files at all: skip (we have
 *      no signal about what to test).
 *
 * Returns counts so the caller can log progress and the API can
 * surface a useful summary in the response.
 */
export async function generateTestPlanForSession(
  sessionId: string,
  projectId: string
): Promise<{ findings: number; items: number; smoke: number }> {
  // Step 0: clear any prior plan so the result reflects only this run.
  await clearTestItemsForSession(sessionId);

  // Step 1: pull all findings for the session.
  // listStaticFindings queries the unified `findings` table for this
  // session — the post-dedup view that contains both AI findings and
  // mirrored static-rule findings. Using the raw static_analysis_results
  // here would double-count every static finding (the engine mirrors
  // them into `findings` already).
  const findings = await listStaticFindings(projectId, sessionId);
  type FindingLike = {
    id: string;
    title: string;
    description: string;
    severity: string;
    filePath: string;
    lineNumber: number | null;
    evidence: string;
    category: string;
    recommendation: string;
  };
  const allFindings: FindingLike[] = findings.map(f => ({
    id: f.id,
    title: f.title,
    description: f.description,
    severity: f.severity,
    filePath: f.filePath,
    lineNumber: f.lineNumber,
    evidence: f.evidenceText,
    category: f.category,
    recommendation: f.recommendation,
  }));

  // Step 2: group by module.
  const byModule = new Map<string, FindingLike[]>();
  for (const f of allFindings) {
    const m = f.filePath ? deriveModuleFromPath(f.filePath) : '(root)';
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push(f);
  }

  // Step 3: per-finding items.
  let totalItems = 0;
  for (const f of allFindings) {
    if (!f.filePath) continue;
    try {
      totalItems += await generateForFinding(projectId, sessionId, f);
    } catch (e) {
      console.warn(
        `[test-plan] finding-item generation failed finding=${f.id}: ${(e as Error).message}`
      );
    }
  }

  // Step 4: smoke tests for modules with no findings. Pull the list
  // of modules from repo_index (which has the module column we just
  // added in Group 2c). The session-scoped `repo_index` rows are the
  // ground truth for "this module exists in the project".
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT DISTINCT module FROM repo_index
     WHERE project_id = ? AND module != ''`
  );
  stmt.bind([projectId]);
  const projectModules = new Set<string>();
  while (stmt.step()) {
    const r = stmt.get() as unknown[];
    projectModules.add(r[0] as string);
  }
  stmt.free();

  let smokeCount = 0;
  for (const module of projectModules) {
    if (byModule.has(module)) continue; // already has items
    // Pull a sample of files in this module to give the AI some
    // grounding. Cheap: 3 paths is enough to convey "auth/login.ts,
    // auth/session.ts, auth/oauth.ts" — the AI doesn't need them all.
    const filesStmt = db.prepare(
      `SELECT file_path FROM repo_index
       WHERE project_id = ? AND module = ?
       ORDER BY file_path
       LIMIT 6`
    );
    filesStmt.bind([projectId, module]);
    const sampleFiles: string[] = [];
    while (filesStmt.step()) {
      const r = filesStmt.get() as unknown[];
      sampleFiles.push(r[0] as string);
    }
    filesStmt.free();
    try {
      smokeCount += await generateForModule(projectId, sessionId, module, sampleFiles);
    } catch (e) {
      console.warn(
        `[test-plan] smoke generation failed module=${module}: ${(e as Error).message}`
      );
    }
  }

  return { findings: allFindings.length, items: totalItems, smoke: smokeCount };
}

// Inlined from repoIndex.ts to avoid a circular import (repoIndex would
// need testPlan, testPlan would need repoIndex). The convention matches
// what repoIndex.deriveModuleFromPath does — keep them in sync.
function deriveModuleFromPath(filePath: string): string {
  if (!filePath) return '(root)';
  let p = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('src/')) p = p.slice(4);
  else if (p.startsWith('lib/')) p = p.slice(4);
  const first = p.split('/').filter(Boolean)[0];
  if (!first) return '(root)';
  if (!p.includes('/')) return first.replace(/\.[^.]+$/, '');
  return first;
}
