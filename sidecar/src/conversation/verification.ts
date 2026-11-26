import type { Evidence } from './service.js';
import type { ConversationRequest } from './types.js';
import type { AutoTest, AutoTestPreset } from '../dynamic/autonomous/planner.js';

export type BrowserTarget = {
  evidenceId: string;
  paths: string[];
  expected: string[];
  checks?: unknown[];
  controls?: unknown[];
  startPath?: string;
};
const expectedMessages = (text: string) => [...text.matchAll(/\b(?:shows?|displays?|contains?|says?|reads?)\s+(?:(?:the|an?)\s+(?:message|text|error)\s+)?(?:"([^"\r\n]{2,200})"|“([^”\r\n]{2,200})”|'([^'\r\n]{2,200})')/gi)]
  .map(match => match[1] ?? match[2] ?? match[3]);
const negative = (text: string) => /\b(?:not|never|without|cannot)\b|\b\w+n['’]t\b/i.test(text.replace(/"[^"]*"|“[^”]*”|(?<!\w)'[^']*'/g, ''));

export function clarifiedBrowserTarget(record: ConversationRequest): BrowserTarget | undefined {
  const answer = record.continuation;
  if (record.input.mode !== 'browser' || record.input.references.length || record.input.replyToTurnId
    || answer?.answerKind !== 'custom' || answer.automatic) return undefined;
  return visibleTextTarget(answer.answer, `clarification:${answer.questionId}`);
}

function visibleTextTarget(text: string, evidenceId: string): BrowserTarget | undefined {
  if (negative(text) || /(?:https?:\/\/|\b(?:exploit|bypass|inject|brute[- ]?force)\b)/i.test(text)) return undefined;
  const expected = [...new Set(expectedMessages(text))];
  const startPath = /\bhome\s*page\b/i.test(text.replace(/"[^"]*"|“[^”]*”|(?<!\w)'[^']*'/g, '')) ? '/' : undefined;
  return expected.length === 1 ? { evidenceId, paths: [], expected, ...(startPath ? { startPath } : {}) } : undefined;
}
const path = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');
const normalizedCheck = (value: unknown) => {
  const row = value as Record<string, unknown>;
  let expected = row.expected;
  if (row.kind === 'url' && typeof expected === 'string') {
    try { const url = new URL(expected); expected = url.pathname + url.search; } catch { /* preserved for exact comparison */ }
  }
  return JSON.stringify({ kind: row.kind, expected: expected ?? null, selector: row.selector ?? null, required: row.required === true });
};
const controlKey = (value: unknown) => {
  const row = value as { selector: string; actions: string[]; repeatable?: boolean };
  return JSON.stringify({ selector: row.selector, actions: [...row.actions].sort(), repeatable: row.repeatable === true });
};
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function browserTargets(evidence: Evidence[], request: string, clarification?: BrowserTarget): BrowserTarget[] {
  const targets: BrowserTarget[] = [];
  const attachedSource = (item: Evidence) => item.id.startsWith('artifact:') && !!item.artifactId && !item.unavailable;
  if (evidence.some(item => item.id.startsWith('finding:') || item.id.startsWith('browser:') || attachedSource(item)) && negative(request)) {
    throw new Error('This request needs an explicit assertion polarity. Use a saved test or specify a positive expected message.');
  }
  for (const item of evidence) {
    const data = JSON.parse(item.text);
    if (item.id.startsWith('finding:') || attachedSource(item)) {
      const requirement = [data.requirement?.title, data.requirement?.description].filter(Boolean).join('\n');
      if (negative(requirement)) throw new Error('A negated requirement needs an independently defined saved browser test.');
      const requested = [...new Set(expectedMessages(request))];
      const required = [...new Set(expectedMessages(requirement))];
      if (requested.length && required.length && !same(requested, required)) throw new Error('The requested messages conflict with the saved requirement.');
      const expected = requested.length ? requested : required;
      if (!data.path || !expected.length) throw new Error('A browser check for this code problem needs an explicit expected message or a saved browser test. State what the page should show in quotation marks.');
      targets.push({ evidenceId: item.id, paths: [path(data.path)], expected });
    }
    if (item.id.startsWith('browser:')) {
      if (data.moreTests > 0) throw new Error('This saved Browser Check exceeds the verification scope limit. Select an individual test.');
      for (const test of data.tests) {
        if (!test.definitions?.length || !Array.isArray(test.controls) || !test.startPath) throw new Error('This historical browser test lacks reusable assertions or a saved action boundary. State a new verification goal.');
        targets.push({ evidenceId: item.id + ':' + test.id, paths: (test.sources ?? []).map((ref: { path: string }) => path(ref.path)),
          expected: [], checks: test.definitions, controls: test.controls, startPath: test.startPath });
      }
    }
  }
  if (!targets.length && clarification) return [clarification];
  if (!targets.length && evidence.length === 1 && evidence[0].id.startsWith('project:')) {
    const target = visibleTextTarget(request, evidence[0].id);
    if (target) return [target];
  }
  if (!targets.length) throw new Error('Browser verification needs a saved browser test or a source with an explicit expected message.');
  return targets;
}

export function validateBrowserTargets(tests: AutoTest[], targets: BrowserTarget[]) {
  const matches = (test: AutoTest, target: BrowserTarget) => {
    if ((target.evidenceId.startsWith('project:') || target.evidenceId.startsWith('clarification:')) && test.controls.length) return false;
    if (target.paths.length && !test.sourceRefs.some(ref => target.paths.includes(path(ref.path)))) return false;
    if (target.checks) {
      return test.startPath === target.startPath
        && same(test.mission.checks.map(normalizedCheck), target.checks.map(normalizedCheck))
        && same(test.controls.map(controlKey), (target.controls ?? []).map(controlKey));
    }
    if (target.startPath && test.startPath !== target.startPath) return false;
    return test.mission.checks.length === target.expected.length
      && target.expected.every(expected => test.mission.checks.some(check => check.required && check.kind === 'visible_text' && check.expected === expected));
  };
  for (const target of targets) {
    if (!tests.some(test => matches(test, target))) throw new Error('The proposed browser tests do not cover the selected evidence with independent expected behavior.');
  }
  if (targets.length && tests.some(test => !targets.some(target => matches(test, target)))) {
    throw new Error('A proposed test exceeds the selected problem scope.');
  }
}

/** A user-specified homepage assertion needs no second model to rewrite its text or add interactions. */
export function visibleTextPreset(targets: BrowserTarget[]): AutoTestPreset | undefined {
  const [target] = targets;
  if (targets.length !== 1 || target.checks || target.paths.length || target.startPath !== '/' || target.expected.length !== 1) return undefined;
  const [expected] = target.expected;
  return { name: `Home page shows ${expected}`.slice(0, 120), goal: 'Check the requested text on the home page.', startPath: '/', requirementRef: null, sourceRefs: [], controls: [],
    checks: [{ id: 'requested-text', criterionId: 'requested-visible-text', description: 'The requested text appears on the home page',
      kind: 'visible_text', expected, required: true }] };
}

export function savedBrowserPresets(evidence: Evidence[]): AutoTestPreset[] {
  const presets = new Map<string, AutoTestPreset>();
  for (const item of evidence.filter(row => row.id.startsWith('browser:'))) {
    const data = JSON.parse(item.text);
    for (const test of data.tests) presets.set(test.id, {
      name: test.name, goal: test.goal, startPath: test.startPath, requirementRef: test.requirementRef ?? null,
      sourceRefs: test.sources ?? [], checks: test.definitions, controls: test.controls,
    });
  }
  return [...presets.values()];
}
