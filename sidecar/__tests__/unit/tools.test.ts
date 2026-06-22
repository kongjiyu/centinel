import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

vi.mock('../../src/repoIndex.js', () => ({
  searchSymbols: vi.fn(),
  getSymbolBody: vi.fn(),
}));

import { searchSymbols, getSymbolBody } from '../../src/repoIndex';
import { executeTool } from '../../src/tools';

describe('executeTool — fetch_file', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-tools-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns the file content as a JSON string', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await executeTool('fetch_file', { path: filePath }, tmpDir);
    expect(JSON.parse(result)).toMatchObject({ content: 'hello world', path: filePath });
  });

  it('throws ENOENT for a missing file', async () => {
    await expect(
      executeTool('fetch_file', { path: path.join(tmpDir, 'nope.txt') }, tmpDir)
    ).rejects.toThrow(/ENOENT|no such file/);
  });

  it('resolves relative paths against the workspace', async () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir);
    const filePath = path.join(subDir, 'auth.ts');
    fs.writeFileSync(filePath, 'export const x = 1;');
    const result = await executeTool('fetch_file', { path: 'src/auth.ts' }, tmpDir);
    expect(JSON.parse(result).content).toBe('export const x = 1;');
  });

  it('truncates output at STATIC_REVIEW_MAX_TOOL_RESULT_CHARS (default 25K)', async () => {
    const filePath = path.join(tmpDir, 'big.txt');
    const content = 'x'.repeat(30_000);
    fs.writeFileSync(filePath, content);
    const result = await executeTool('fetch_file', { path: filePath }, tmpDir);
    const parsed = JSON.parse(result);
    expect(parsed.content.length).toBeLessThan(30_000);
    expect(parsed.content).toContain('[... truncated');
    expect(parsed.truncated).toBe(true);
  });
});
