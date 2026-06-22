import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Shared mock functions - passed to executeTool via deps parameter
const mockSearchSymbols = vi.fn();
const mockGetSymbolBody = vi.fn();

import { executeTool, SymbolNotFound } from '../../src/tools';

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

describe('executeTool — fetch_files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-ff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns per-path results, including errors for missing files', async () => {
    const good = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(good, 'A');
    const bad = path.join(tmpDir, 'missing.txt');
    const result = await executeTool('fetch_files', { paths: [good, bad] }, tmpDir);
    const parsed = JSON.parse(result);
    expect(parsed.results[good].content).toBe('A');
    expect(parsed.results[bad].error).toMatch(/ENOENT|no such file/);
  });

  it('throws when ALL paths fail', async () => {
    await expect(
      executeTool('fetch_files', { paths: ['/no/such/a', '/no/such/b'] }, tmpDir)
    ).rejects.toThrow();
  });
});

describe('executeTool — get_symbol_body and search_symbols', () => {
  it('get_symbol_body returns the symbol body JSON', async () => {
    mockGetSymbolBody.mockResolvedValue({
      name: 'foo',
      symbolType: 'function',
      filePath: '/x.ts',
      startLine: 1,
      endLine: 3,
      body: 'function foo() {}',
      fileTotalLines: 10,
    });
    const result = await executeTool('get_symbol_body', { file: '/x.ts', name: 'foo' }, '/', 'proj-1', {
      getSymbolBody: mockGetSymbolBody,
    });
    const parsed = JSON.parse(result);
    expect(parsed.body).toBe('function foo() {}');
    expect(parsed.startLine).toBe(1);
  });

  it('get_symbol_body propagates SymbolNotFound as a thrown error', async () => {
    mockGetSymbolBody.mockRejectedValue(new SymbolNotFound('/x.ts', 'nope'));
    await expect(
      executeTool('get_symbol_body', { file: '/x.ts', name: 'nope' }, '/', 'proj-1', {
        getSymbolBody: mockGetSymbolBody,
      })
    ).rejects.toThrow(SymbolNotFound);
  });

  it('search_symbols returns the matches JSON', async () => {
    mockSearchSymbols.mockResolvedValue({
      matches: [{ symbolId: 's1', name: 'authenticate', symbolType: 'function', filePath: '/a.ts', signature: 'fn', startLine: 1, endLine: 2 }],
      totalMatches: 1,
    });
    const result = await executeTool('search_symbols', { query: 'auth' }, '/', 'proj-1', {
      searchSymbols: mockSearchSymbols,
    });
    const parsed = JSON.parse(result);
    expect(parsed.matches[0].name).toBe('authenticate');
  });

  it('throws for an unknown tool name', async () => {
    await expect(
      executeTool('hack_the_planet', {}, '/', 'proj-1')
    ).rejects.toThrow(/Unknown tool/);
  });
});
