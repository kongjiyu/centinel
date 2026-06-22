/**
 * staticReviewToolPath.test.ts — End-to-end integration test for the tool-use path.
 *
 * Verifies the full dispatcher -> tool-path pipeline with a mocked provider:
 *   - A real workspace on disk with .centinel/index.json + .centinel/graph.json
 *   - A real (sql.js) test DB with a project row pointing at that workspace
 *   - A 300KB artifact (forces the tool path: 300KB > 200KB threshold)
 *   - Mocked fetch returns end_turn immediately with valid stage JSON
 *   - The pipeline completes without throwing
 *   - fetch was invoked (proving the tool-path loop ran)
 *
 * The test mocks the heavy modules that the tool path touches so we can
 * assert against the dispatcher wiring without exercising the real
 * parseStageResponse / scoreFindings / runStaticAnalysis internals.
 *
 * Companion to sidecar/__tests__/unit/staticReview.test.ts, which covers
 * the dispatcher's routing rules and the prefetch path in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock the modules that runStaticReview pulls in. We mock BEFORE importing
// the module under test so the mock factory hoists into place.
vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

vi.mock('../../src/artifacts.js', () => ({
  readArtifactContent: vi.fn(),
  listArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/staticSessions.js', () => ({
  updateStaticSessionStatus: vi.fn().mockResolvedValue(undefined),
  updateStaticSessionProgress: vi.fn().mockResolvedValue(undefined),
  createFinding: vi.fn().mockResolvedValue({} as any),
  createReviewArtifact: vi.fn().mockResolvedValue({} as any),
}));

// Static analysis is a pre-flight step that the dispatcher runs before
// routing. Returning [] keeps the dispatcher happy without touching real
// rule engines.
vi.mock('../../src/staticEngine.js', () => ({
  runStaticAnalysis: vi.fn().mockResolvedValue([]),
}));

// indexProject writes to the repo_index / code_symbols / code_relationships
// tables and reads artifacts from disk. The test DB doesn't carry those
// tables, and we don't want this integration test to depend on real AST
// parsing of the 300KB file. Mock it out so the dispatcher's pre-flight
// passes cleanly.
vi.mock('../../src/repoIndex.js', () => ({
  indexProject: vi.fn().mockResolvedValue(undefined),
}));

// scoreFindings is called per-stage to normalize severity/risk. We pass
// findings through with a stub risk object so createFinding gets called.
vi.mock('../../src/riskScore.js', () => ({
  scoreFindings: vi.fn().mockImplementation((findings: any[]) =>
    findings.map((f) => ({
      ...f,
      risk: { score: 0.5, level: f.severity || 'medium', factors: {} },
    }))
  ),
}));

import { getRawAiSetting } from '../../src/settings';
import { runStaticReview } from '../../src/staticReview';
import { setTestDb, clearTestDb } from '../../src/db';
import { createTestDb, closeTestDb, insertTestProject } from '../helpers/testHelpers';
import type { StaticSession } from '../../src/staticSessions';
import type { Artifact } from '../../src/artifacts';

describe('staticReview tool path — integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-int-'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    clearTestDb();
    closeTestDb();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('completes a tool-path review end-to-end with mocked provider', async () => {
    // Create a real workspace on disk with the .centinel/ navigation files
    // the tool path reads at startup. Without these the tool path falls
    // back to {} — the test still passes, but the files make the setup
    // faithful to a real indexing pass.
    const centinelDir = path.join(tmpDir, '.centinel');
    fs.mkdirSync(centinelDir, { recursive: true });
    fs.writeFileSync(path.join(centinelDir, 'index.json'), JSON.stringify({ files: [] }));
    fs.writeFileSync(path.join(centinelDir, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));

    // Real DB with a project pointing at our workspace.
    const db = await createTestDb();
    insertTestProject(db, 'p1', tmpDir);
    setTestDb(db);

    // Provider configured; we don't care about the real model — fetch is mocked.
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk',
      baseUrl: 'https://example.test',
      model: 'm',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    } as any);

    // Mock the provider to return end_turn immediately with valid stage JSON.
    // The dispatcher always sends 4 stages of tool turns (3 of which become
    // Stage 1/2/4; Stage 3 is skipped when there are no requirement artifacts).
    // We register enough resolved values to cover the 4 stages.
    const stageJson = JSON.stringify({
      thoughts: ['done'],
      findings: [],
      projectSummary: 'test',
      artifactInventory: [],
      userIntent: 'test',
    });
    const anthropicResponse = {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: stageJson }],
      }),
    } as Response;
    fetchSpy
      .mockResolvedValueOnce(anthropicResponse)
      .mockResolvedValueOnce(anthropicResponse)
      .mockResolvedValueOnce(anthropicResponse)
      .mockResolvedValueOnce(anthropicResponse);

    // 300 KB single artifact — comfortably over the 200 KB tool-path threshold.
    const big = path.join(tmpDir, 'big.ts');
    fs.writeFileSync(big, 'x'.repeat(300_000));

    const session: StaticSession = {
      id: 's1',
      projectId: 'p1',
      name: 't',
      reviewType: 'code_review',
      status: 'pending',
      configJson: '{}',
      progressJson: '{}',
      remarks: '',
      finalSummary: '',
      failureReason: '',
      createdAt: '',
      updatedAt: '',
    };
    const artifacts: Artifact[] = [
      {
        id: 'a1',
        projectId: 'p1',
        type: 'source_code',
        source: 'repository',
        fileName: 'big.ts',
        filePath: big,
        originalPath: null,
        contentHash: 'h',
        createdAt: '',
      },
    ];

    // The tool path must reach success without throwing. The mocked fetch
    // returns end_turn on the first turn of each stage, so the tool loop
    // never has to invoke a tool.
    await expect(runStaticReview(session, artifacts)).resolves.not.toThrow();

    // Tool path was used: the dispatcher pulled the model into a tool loop,
    // which is the only path that calls fetch with tools in the schema.
    expect(fetchSpy).toHaveBeenCalled();
    // Every fetch body should include the `tools` field — that's the marker
    // that distinguishes the tool path from the legacy prefetch path
    // (callAi sends no tools field).
    const allCallsHaveTools = fetchSpy.mock.calls.every((call) => {
      const init = call[1] as RequestInit | undefined;
      if (!init?.body) return false;
      try {
        const body = JSON.parse(init.body as string);
        return Array.isArray(body.tools);
      } catch {
        return false;
      }
    });
    expect(allCallsHaveTools).toBe(true);
  });
});
