import type { Page } from 'playwright';
import type { CheckDefinition, CheckResult, CheckVerdict } from './types.js';

/** Checks use configured expectations, never a model's terminal declaration. */
export async function checkPage(page: Page, definitions: CheckDefinition[], evidenceIds: string[], signal?: AbortSignal): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of definitions) {
    const result: CheckResult = { checkId: check.id, criterionId: check.criterionId, verdict: 'uncertain', observed: null, reason: '', evidenceIds: [...evidenceIds], checkedAt: new Date().toISOString() };
    if (signal?.aborted || page.isClosed()) {
      result.reason = 'Page unavailable or execution stopped before verification.';
    } else {
      try {
        let pass: boolean;
        if (check.kind === 'url') {
          result.observed = page.url();
          pass = result.observed === check.expected;
        } else if (check.kind === 'visible_text') {
          const text = await page.locator('body').innerText({ timeout: 3000 });
          // Store the expectation/match only, not arbitrary page text or secrets.
          pass = text.includes(check.expected);
          result.observed = pass ? 'Expected visible text found.' : 'Expected visible text absent.';
        } else {
          const locator = page.locator(check.selector);
          const count = await locator.count();
          if (count > 1) throw new Error('ambiguous');
          pass = count === 1 && await locator.isVisible();
          result.observed = pass ? 'One visible element found.' : 'No visible matching element found.';
        }
        if (signal?.aborted || page.isClosed()) throw new Error('stopped');
        result.verdict = pass ? 'passed' : 'failed';
        result.reason = pass ? 'Configured criterion matched the observed page.' : 'Configured criterion did not match the observed page.';
      } catch {
        result.reason = 'The checker could not obtain an unambiguous observation.';
      }
    }
    results.push(result);
  }
  return results;
}

export function aggregateChecks(definitions: CheckDefinition[], results: CheckResult[]): CheckVerdict {
  const required = definitions.filter(check => check.required);
  if (!required.length) return 'not_tested';
  const verdicts = required.map(check => {
    const matches = results.filter(result => result.checkId === check.id && result.criterionId === check.criterionId);
    return matches.length === 1 ? matches[0].verdict : 'uncertain';
  });
  if (verdicts.includes('failed')) return 'failed';
  return verdicts.every(verdict => verdict === 'passed') ? 'passed' : 'uncertain';
}
