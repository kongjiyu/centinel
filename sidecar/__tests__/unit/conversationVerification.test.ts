import { expect, it } from 'vitest';
import { browserTargets, validateBrowserTargets } from '../../src/conversation/verification.js';
import type { AutoTest } from '../../src/dynamic/autonomous/planner.js';

const evidence = [{ id: 'finding:order', text: JSON.stringify({ path: 'orders.ts', requirement: { description: 'Show “Access denied” for another account’s order.' } }), hash: 'h' }];
const test = (path = 'orders.ts', expected = 'Access denied') => ({
  id: 'test', startPath: '/orders', sourceRefs: [{ path, line: 12 }],
  controls: [{ selector: '#open-order', actions: ['click'] }],
  mission: { checks: [{ kind: 'visible_text', expected, description: 'Access is denied' }] },
} as AutoTest);
it('admits a test only when it binds the selected source to an independent expected result', () => {
  const targets = browserTargets(evidence, 'Run this browser check');
  expect(() => validateBrowserTargets([test()], targets)).not.toThrow();
  expect(() => validateBrowserTargets([test('login.ts')], targets)).toThrow();
  expect(() => validateBrowserTargets([test('orders.ts', 'Order details')], targets)).toThrow();
  expect(() => validateBrowserTargets([], targets)).toThrow();
});
it('requires explicit expected behavior for a code problem without a saved criterion', () => {
  const missing = [{ ...evidence[0], text: JSON.stringify({ path: 'orders.ts' }) }];
  expect(() => browserTargets(missing, 'Test this problem')).toThrow('expected');
  expect(browserTargets(missing, 'Test that the page shows "Access denied"')).toMatchObject([{ expected: ['Access denied'] }]);
});
it('does not treat quoted input values as expected results or admit unrelated tests in the same source', () => {
  const missing = [{ ...evidence[0], text: JSON.stringify({ path: 'orders.ts' }) }];
  const targets = browserTargets(missing, 'Test login with username "alice"; the page must show "Invalid password"');
  expect(targets[0].expected).toEqual(['Invalid password']);
  expect(() => validateBrowserTargets([test('orders.ts', 'alice')], targets)).toThrow();
  expect(() => validateBrowserTargets([test('orders.ts', 'Invalid password'), test('orders.ts', 'alice')], targets)).toThrow('scope');
});
it('refuses to invert negative expectations while accepting a positive message containing the word not', () => {
  const missing = [{ ...evidence[0], text: JSON.stringify({ path: 'orders.ts' }) }];
  expect(() => browserTargets(missing, 'Verify the page must not show "Error"')).toThrow('polarity');
  expect(() => browserTargets(missing, "Verify the page shouldn't show 'Error'")).toThrow('polarity');
  expect(browserTargets(missing, 'Verify the page shows "Not found"')[0].expected).toEqual(['Not found']);
});
it('keeps saved browser assertions and control scope intact', () => {
  const original = test();
  const saved = [{ id: 'browser:session', hash: 'h', text: JSON.stringify({ tests: [{
    id: 'original', name: 'Order access', goal: 'Open another account’s order', startPath: original.startPath,
    sources: original.sourceRefs, definitions: original.mission.checks, controls: original.controls,
  }] }) }];
  const targets = browserTargets(saved, 'Run the test again');
  expect(() => validateBrowserTargets([original], targets)).not.toThrow();
  expect(() => validateBrowserTargets([{ ...original, controls: [{ selector: '#different', actions: ['click'] }] }], targets)).toThrow();
});
