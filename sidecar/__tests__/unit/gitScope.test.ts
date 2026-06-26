/**
 * gitScope (P0-4) — backend tests.
 *
 * Exercises the helper that runs `git diff --name-only` against a
 * workspace. We don't mock child_process — we run against a real temp
 * git repo so the test catches regressions in argument shape and
 * working-directory behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { getChangedFiles, GitScopeError } from '../../src/gitScope.js';

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'centinel-gitscope-'));
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  run(['init', '--initial-branch=main', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  // Initial commit on main.
  writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  run(['add', 'README.md']);
  run(['commit', '-m', 'initial', '-q']);
  return dir;
}

function commitFile(dir: string, name: string, content: string, message: string) {
  const full = path.join(dir, name);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  execFileSync('git', ['add', name], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', message, '-q'], { cwd: dir, stdio: 'pipe' });
}

describe('gitScope.getChangedFiles', () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => {
    // Best-effort cleanup. On Windows the `git` helper processes may
    // briefly hold a lock on the temp dir (e.g. .git/index.lock), and
    // rmSync will EBUSY. The OS will reclaim tempdir() entries on its
    // own, so failures here are non-fatal — the test still asserts
    // correctness.
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns empty result when either ref is empty (whole-tree review)', async () => {
    const r = await getChangedFiles(repo, '', '');
    expect(r.files).toEqual([]);
    expect(r.baseSha).toBe('');
    expect(r.headSha).toBe('');
  });

  it('returns empty files + SHAs for a no-op diff (same ref on both sides)', async () => {
    const r = await getChangedFiles(repo, 'main', 'main');
    expect(r.files).toEqual([]);
    expect(r.baseSha).not.toBe('');
    expect(r.headSha).toBe(r.baseSha);
  });

  it('lists files changed between two refs on the same branch', async () => {
    commitFile(repo, 'src/auth.ts', 'export const a = 1;\n', 'add auth');
    commitFile(repo, 'src/db.ts', 'export const b = 2;\n', 'add db');
    commitFile(repo, 'README.md', 'updated\n', 'tweak readme');

    const r = await getChangedFiles(repo, 'main~3', 'main');
    // main~3 is the initial empty commit; everything since counts.
    expect(r.files.sort()).toEqual(['README.md', 'src/auth.ts', 'src/db.ts']);
    expect(r.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.headSha).not.toBe(r.baseSha);
  });

  it('returns a deterministic subset when diffing adjacent commits', async () => {
    commitFile(repo, 'a.ts', 'a', 'add a');
    commitFile(repo, 'b.ts', 'b', 'add b');

    const r = await getChangedFiles(repo, 'main~1', 'main');
    expect(r.files).toEqual(['b.ts']);
  });

  it('throws GitScopeError with code=invalid_ref on bad ref', async () => {
    await expect(getChangedFiles(repo, 'main', 'does-not-exist')).rejects.toBeInstanceOf(GitScopeError);
    await expect(getChangedFiles(repo, 'main', 'does-not-exist')).rejects.toMatchObject({
      code: 'invalid_ref',
    });
  });

  it('throws GitScopeError with code=not_a_repo on a non-git directory', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'centinel-nogit-'));
    try {
      await expect(getChangedFiles(dir, 'main', 'HEAD')).rejects.toBeInstanceOf(GitScopeError);
      await expect(getChangedFiles(dir, 'main', 'HEAD')).rejects.toMatchObject({
        code: 'not_a_repo',
      });
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
