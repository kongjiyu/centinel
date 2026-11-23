import fs from 'node:fs';
import path from 'node:path';
import { runVitestWorkspace, type VerifiedUnitWorkspace } from '../unit/runner.js';
import type { UnitExecutionResult, UnitOutcome } from '../unit/types.js';
import { inspectWorkspace, type WorkspaceInspection } from '../workspace/registry.js';

/**
 * A full check also runs the project's own unit tests (18 Nov 2026, user decision). This extends the
 * 12 Nov automatic-start amendment to one more fixed command: the installed Vitest CLI, started by the
 * existing bounded runner, for a package script that is exactly `vitest`, `vitest run` or `vitest --run`.
 * No shell text, no extra flags and no repository `.env` values are used. Other frameworks are reported
 * as not supported; nothing is counted as passed unless Vitest's own report says so.
 */
export const UNIT_TIMEOUT_MS = 300_000;
const PLAIN_VITEST = /^vitest(?:\s+(?:--run|run))?\s*$/;

export type UnitSummary = {
  outcome: UnitOutcome | 'unsupported';
  script: string | null;
  framework: string | null;
  counts: { total: number; passed: number; failed: number; skipped: number } | null;
  /** At most ten failing tests or suites, with redacted, shortened messages. */
  failures: Array<{ file: string; name: string; message: string }>;
  reason: string;
  /** False when the project has no unit tests at all; that is not a gap in the check (19 Nov 2026). */
  present?: boolean;
};

/** The script to run: a plain Vitest script, preferring names that say unit or ci. */
export function vitestScript(inspection: Pick<WorkspaceInspection, 'scriptNames' | 'scriptDefinitions'>): string | null {
  const plain = inspection.scriptNames.filter(name => PLAIN_VITEST.test(inspection.scriptDefinitions[name] ?? ''));
  const score = (name: string) => (/unit/i.test(name) ? 2 : 0) + (/ci|run/i.test(name) || /run/.test(inspection.scriptDefinitions[name]) ? 1 : 0) + (name === 'test' ? 1 : 0);
  return plain.sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0] ?? null;
}

function otherFramework(inspection: Pick<WorkspaceInspection, 'scriptDefinitions'>): string | null {
  const text = Object.values(inspection.scriptDefinitions).join('\n');
  for (const [name, pattern] of [['Jest', /\bjest\b/], ['Mocha', /\bmocha\b/], ['Vitest with extra options', /\bvitest\b/]] as const) if (pattern.test(text)) return name;
  return null;
}

function packageManager(directory: string): VerifiedUnitWorkspace['authorization']['packageManager'] {
  if (fs.existsSync(path.join(directory, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(directory, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function unitSummary(result: UnitExecutionResult): UnitSummary {
  const assessment = result.assessment;
  const failures = [
    ...(assessment?.suiteErrors ?? []).map(error => ({ file: error.file, name: 'Test file could not run', message: error.message })),
    ...(assessment?.tests ?? []).filter(test => test.status === 'failed').map(test => ({ file: test.file, name: test.name, message: test.failureMessages[0] ?? '' })),
  ].slice(0, 10).map(item => ({ file: item.file.slice(0, 300), name: item.name.slice(0, 300), message: item.message.replace(/\s+/g, ' ').trim().slice(0, 400) }));
  const counts = assessment ? { total: assessment.counts.total, passed: assessment.counts.passed, failed: assessment.counts.failed, skipped: assessment.counts.pending + assessment.counts.todo } : null;
  return { outcome: result.outcome, script: result.command.script, framework: result.framework.version ? `Vitest ${result.framework.version}` : 'Vitest', counts, failures, reason: result.reason };
}

/** Runs the project's plain Vitest script, or says why it cannot. Never throws for a missing setup. */
export async function runProjectUnitTests(input: { folder: string; receiptRoot: string; ownerId: string; projectId: string; signal: AbortSignal }): Promise<UnitSummary> {
  const none = (reason: string, present: boolean): UnitSummary => ({ outcome: 'unsupported', script: null, framework: null, counts: null, failures: [], reason, present });
  let inspection: WorkspaceInspection;
  try { inspection = inspectWorkspace(input.folder); } catch { return none('The project has no package.json, so it has no unit tests Centinel can find.', false); }
  const script = vitestScript(inspection);
  if (!script) {
    const other = otherFramework(inspection);
    return other ? none(`The project's tests use ${other}. Centinel can only run a plain Vitest script for now.`, true) : none('The project has no unit tests.', false);
  }
  const authorization: VerifiedUnitWorkspace['authorization'] = {
    directory: inspection.directory, packageManager: packageManager(inspection.directory), runtimeBinDirectory: '',
    scripts: { unit: script }, fingerprint: inspection.fingerprint, authorizedAt: new Date().toISOString(),
  };
  const result = await runVitestWorkspace({
    verified: { authorization, inspection, script }, ownerId: input.ownerId, projectId: input.projectId, environmentId: 'autotest',
    receiptRoot: input.receiptRoot, timeoutMs: UNIT_TIMEOUT_MS, signal: input.signal,
  });
  return unitSummary(result);
}

export function unitState(summary: UnitSummary): 'passed' | 'failed' | 'blocked' | 'not_tested' | 'cancelled' {
  switch (summary.outcome) {
    case 'passed': return 'passed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'unsupported': case 'no_tests': case 'not_tested': return 'not_tested';
    default: return 'blocked';
  }
}
