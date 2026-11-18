import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { browserTargets, validateBrowserTargets } from '../../src/conversation/verification.js';
import { aggregateChecks, checkPage } from '../../src/dynamic/checker.js';
import type { AutoTest } from '../../src/dynamic/autonomous/planner.js';
import type { CheckDefinition } from '../../src/dynamic/types.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });
const definitions: CheckDefinition[] = [{
  id: 'owner-access', criterionId: 'owner-access', kind: 'visible_text', expected: 'Access denied',
  description: 'The order page denies access to another account’s order.', required: true,
}];
const test = {
  id: 'order-test', sourceRefs: [{ path: 'orders.ts', line: 12 }], startPath: '/orders',
  controls: [{ selector: '#open-order', actions: ['click'] }], mission: { checks: definitions },
} as AutoTest;
const evidence = [{ id: 'finding:order-access', hash: 'fixture-v1',
  text: JSON.stringify({ path: 'orders.ts', requirement: { description: 'Show “Access denied” for another account’s order.' } }) }];

it('binds the selected problem to the independent assertion that fails on a planted defect and passes on its repaired fixture', async () => {
  validateBrowserTargets([test], browserTargets(evidence, 'Test order access'));
  const page = await browser.newPage();
  try {
    for (const [fixed, verdict] of [[false, 'failed'], [true, 'passed']] as const) {
      await page.setContent('<button id="open-order">Open order</button><output></output>');
      await page.evaluate(repaired => {
        document.querySelector('button')!.addEventListener('click', () => {
          document.querySelector('output')!.textContent = repaired ? 'Access denied' : 'Order details for another account';
        });
      }, fixed);
      await page.locator('#open-order').click();
      const results = await checkPage(page, definitions, []);
      expect(aggregateChecks(definitions, results)).toBe(verdict);
      expect(results[0].verdict).toBe(verdict);
    }
  } finally { await page.close(); }
});
