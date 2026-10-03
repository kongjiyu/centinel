import { describe, expect, it, vi } from 'vitest';
import { runStaticAnalysis } from '../../src/staticEngine.js';
import type { Artifact } from '../../src/artifacts.js';

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
