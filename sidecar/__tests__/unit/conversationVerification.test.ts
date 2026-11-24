import { expect, it } from 'vitest';
import { browserTargets, validateBrowserTargets } from '../../src/conversation/verification.js';
import type { AutoTest } from '../../src/dynamic/autonomous/planner.js';
import { presetToTest } from '../../src/dynamic/autonomous/planner.js';
import { savedBrowserPresets } from '../../src/conversation/verification.js';

const evidence = [{ id: 'finding:order', text: JSON.stringify({ path: 'orders.ts', requirement: { description: 'Show “Access denied” for another account’s order.' } }), hash: 'h' }];
const test = (path = 'orders.ts', expected = 'Access denied') => ({
  id: 'test', startPath: '/orders', sourceRefs: [{ path, line: 12 }],
  controls: [{ selector: '#open-order', actions: ['click'] }],
  mission: { checks: [{ kind: 'visible_text', expected, description: 'Access is denied', required: true }] },
} as AutoTest);
it('admits a test only when it binds the selected source to an independent expected result', () => {
  const targets = browserTargets(evidence, 'Run this browser check');
  expect(() => validateBrowserTargets([test()], targets)).not.toThrow();
  expect(() => validateBrowserTargets([test('login.ts')], targets)).toThrow();
  expect(() => validateBrowserTargets([test('orders.ts', 'Order details')], targets)).toThrow();
  expect(() => validateBrowserTargets([], targets)).toThrow();
  const valid = test();
  const [check] = valid.mission.checks;
  expect(() => validateBrowserTargets([{ ...valid, mission: { ...valid.mission, checks: [check, { ...check, id: 'unrelated', expected: 'Unrelated' }] } }], targets)).toThrow();
  expect(() => validateBrowserTargets([{ ...valid, mission: { ...valid.mission, checks: [{ ...check, required: false }] } }], targets)).toThrow();
});

it('binds an explicitly quoted message to an attached source and rejects missing evidence', () => {
  const request = 'Verify the page shows "Welcome"';
  expect(() => browserTargets([], request)).toThrow('needs a saved browser test or a source');
  const source = [{ id: 'artifact:signin', hash: 'h', artifactId: 'signin', text: JSON.stringify({ path: 'signin.tsx' }) }];
  expect(browserTargets(source, request)).toMatchObject([{ paths: ['signin.tsx'], expected: ['Welcome'] }]);
  expect(() => browserTargets(source, 'Verify the page looks correct')).toThrow('expected');
});

it('rebuilds a saved assertion-only Browser run without granting any controls', () => {
  const data = { tests: [{ id: 'signin', name: 'Sign-in smoke', goal: 'Observe the sign-in heading', startPath: '/signin',
    definitions: [{ id: 'c', criterionId: 'c', description: 'Heading visible', kind: 'visible_text', expected: 'Sign in', required: true }],
    controls: [], sources: [] }] };
  const evidence = [{ id: 'browser:signin', text: JSON.stringify(data), hash: 'h' }];
  const targets = browserTargets(evidence, 'Rerun the saved test');
  const [preset] = savedBrowserPresets(evidence);
  const rebuilt = presetToTest(preset, { appUrl: 'http://localhost:3000', projectId: 'project' })!;
  expect(rebuilt.controls).toEqual([]);
  expect(() => validateBrowserTargets([rebuilt], targets)).not.toThrow();
  expect(() => validateBrowserTargets([{ ...rebuilt, controls: [{ selector: '#signin', actions: ['click'] }] }], targets)).toThrow();
  expect(() => browserTargets([{ ...evidence[0], text: JSON.stringify({ tests: [{ ...data.tests[0], controls: undefined }] }) }], 'Rerun the saved test')).toThrow('saved action boundary');
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
  expect(() => validateBrowserTargets([{ ...original, mission: { ...original.mission, checks: original.mission.checks.map(check => ({ ...check, required: false })) } }], targets)).toThrow();
});
