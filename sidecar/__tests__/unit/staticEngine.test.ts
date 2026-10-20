import { describe, expect, it, vi } from 'vitest';
import { runStaticAnalysis } from '../../src/staticEngine.js';
import type { Artifact } from '../../src/artifacts.js';
import { ReviewHarness } from '../../src/review/harness.js';
import type { ReviewAuditEvent } from '../../src/review/types.js';

function makeArtifact(fileName = 'test.ts'): Artifact {
  return {
    id: 'test-artifact-1',
    projectId: 'test-project-1',
    type: 'source_code',
    source: 'repository',
    fileName,
    filePath: `src/${fileName}`,
    originalPath: null,
    contentHash: 'abc123',
    createdAt: '2026-09-23T00:00:00Z',
  };
}

async function analyze(content: string, artifact = makeArtifact()) {
  const contentReader = vi.fn(async () => content);
  const findings = await runStaticAnalysis('test-project-1', [artifact], 'review-1', { contentReader });
  expect(contentReader).toHaveBeenCalledWith(artifact, undefined);
  return findings;
}

describe('authenticated deterministic static analysis', () => {
  it('audits every applicable rule, including zero-finding checks', async () => {
    const events: Array<Omit<ReviewAuditEvent, 'createdAt'>> = [];
    const harness = new ReviewHarness({ reviewId: 'review', projectId: 'project' }, async event => { events.push(event); });
    await runStaticAnalysis('project', [makeArtifact()], 'review', { contentReader: async () => 'const answer = 42;', harness });
    const completed = events.filter(event => event.event === 'harness_step_completed');
    expect(completed.length).toBeGreaterThan(1);
    expect(completed.every(event => event.detail?.step === 'check_rule' && typeof event.detail?.output === 'object')).toBe(true);
    expect(events.filter(event => event.event === 'harness_step_started').every(event => (event.detail?.input as Record<string, unknown>).artifactId === 'test-artifact-1')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('const answer');
  });
  it('detects hardcoded API and AWS keys from supplied frozen content', async () => {
    const findings = await analyze(`
      const apiKey = "sk-1234567890abcdef";
      const password = "hunter2";
      const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
    `);
    expect(findings.map(finding => finding.ruleId)).toEqual(expect.arrayContaining(['secrets-api-key', 'secrets-aws-key']));
  });

  it('detects TODO/FIXME comments', async () => {
    const findings = await analyze('// TODO: fix this later\n// FIXME: broken\nfunction hello() { return "world"; }');
    expect(findings.map(finding => finding.ruleId)).toContain('cq-todo-comments');
  });

  it('does not interpret fixture filenames as TODO comments', async () => {
    const findings = await analyze("request(app).get('/todo.txt');\nassert.equal(file, 'todo.html');\nconst path = '/fixtures/FIXME.json';");
    expect(findings.filter(finding => finding.ruleId === 'cq-todo-comments')).toEqual([]);
  });

  it('retains task markers with a note or at end of line', async () => {
    const findings = await analyze('// TODO\n// FIXME correct the boundary\n// HACK: temporary adapter');
    expect(findings.filter(finding => finding.ruleId === 'cq-todo-comments').map(finding => finding.lineNumber)).toEqual([1, 2, 3]);
  });

  it('detects empty catch blocks', async () => {
    const findings = await analyze('try {\n doSomething();\n} catch (error) {\n // empty\n}');
    expect(findings.map(finding => finding.ruleId)).toContain('cq-empty-catch');
  });

  it('detects eval usage', async () => {
    const findings = await analyze('const code = "1 + 1";\nconst result = eval(code);');
    expect(findings.map(finding => finding.ruleId)).toContain('sec-eval');
  });

  it('skips files without applicable rules without reading their content', async () => {
    const contentReader = vi.fn(async () => '{ "key": "value" }');
    const findings = await runStaticAnalysis('test-project-1', [makeArtifact('test.png')], 'review-1', { contentReader });
    expect(findings).toEqual([]);
    expect(contentReader).not.toHaveBeenCalled();
  });

  it('propagates cancellation through the frozen-content reader', async () => {
    const controller = new AbortController();
    const contentReader = vi.fn(async (_artifact: Artifact, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    await expect(runStaticAnalysis('test-project-1', [makeArtifact()], 'review-1', {
      signal: controller.signal, contentReader,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('skips one unreadable frozen artifact without falling back to a local file', async () => {
    const contentReader = vi.fn(async () => { throw new Error('Storage unavailable'); });
    const findings = await runStaticAnalysis('test-project-1', [makeArtifact()], 'review-1', { contentReader });
    expect(findings).toEqual([]);
    expect(contentReader).toHaveBeenCalledTimes(1);
  });
});
