/**
 * Git diff scope (P0-4).
 *
 * For a project with a workspace that's a git repo, compute the set of
 * files that changed between two refs. The result is what the static
 * engine will review; everything else is skipped. This:
 *   - keeps the review focused on the PR / commit range, not the whole
 *     codebase (a 5x cost on token spend is typical for re-runs)
 *   - lets the UI show the review's "blast radius" up front
 *   - pairs with re-review (P1-5) to give a meaningful "what changed
 *     since last review" diff
 *
 * All filesystem access is funneled through this module so a future
 * swap to libgit2 (no exec) is local. For now: spawn git with the
 * workspace as the cwd and a tight argument list — no shell expansion.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 8 * 1024 * 1024; // 8 MiB — plenty for a name list.

export type ChangedFilesResult = {
  /** Files changed between base and head (added, modified, renamed). */
  files: string[];
  /** Resolved commit SHA at `head`, or empty if the ref doesn't resolve. */
  headSha: string;
  /** Resolved commit SHA at `base`, or empty if the ref doesn't resolve. */
  baseSha: string;
};

export class GitScopeError extends Error {
  constructor(message: string, readonly code: 'not_a_repo' | 'invalid_ref' | 'unknown') {
    super(message);
    this.name = 'GitScopeError';
  }
}

/**
 * List files changed between `baseRef` and `headRef` in the workspace.
 * Uses `git diff --name-only` (no rename detection — keep it simple).
 * Returns empty file list (and empty SHAs) when either ref is empty;
 * callers should treat that as "review the whole tree".
 */
export async function getChangedFiles(
  workspacePath: string,
  baseRef: string,
  headRef: string
): Promise<ChangedFilesResult> {
  if (!baseRef || !headRef) {
    return { files: [], baseSha: '', headSha: '' };
  }
  try {
    const [diffResult, baseSha, headSha] = await Promise.all([
      execFileAsync(
        'git',
        ['diff', '--name-only', `${baseRef}..${headRef}`],
        { cwd: workspacePath, maxBuffer: MAX_BUFFER, windowsHide: true }
      ),
      revParse(workspacePath, baseRef),
      revParse(workspacePath, headRef),
    ]);
    const files = diffResult.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    return { files, baseSha, headSha };
  } catch (e: unknown) {
    const err = e as { code?: string; stderr?: string; message?: string };
    if (err.code === 'ENOENT') {
      // git isn't on PATH
      throw new GitScopeError('git executable not found on PATH', 'not_a_repo');
    }
    const msg = err.stderr ?? err.message ?? 'git command failed';
    if (/Not a git repository/i.test(msg)) {
      throw new GitScopeError(`Workspace is not a git repo: ${workspacePath}`, 'not_a_repo');
    }
    if (/bad revision|unknown revision|ambiguous/i.test(msg)) {
      throw new GitScopeError(`Invalid ref: ${msg.trim()}`, 'invalid_ref');
    }
    throw new GitScopeError(msg, 'unknown');
  }
}

async function revParse(workspacePath: string, ref: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--verify', `${ref}^{commit}`],
      { cwd: workspacePath, maxBuffer: 1024, windowsHide: true }
    );
    return stdout.trim();
  } catch {
    return '';
  }
}
