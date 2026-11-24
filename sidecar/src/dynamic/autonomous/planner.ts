import crypto from 'node:crypto';
import type { InteractionAction } from '../browser/actionPolicy.js';
import type { DiscoveryResult } from '../environment/controlDiscovery.js';
import { validateMission } from '../service.js';
import type { CheckDefinition, MissionInput } from '../types.js';
import type { RepoDigest } from './repoDigest.js';

/**
 * Turns a repository digest plus the controls Centinel actually saw in the running app
 * into validated browser tests. The model proposes; every test is checked here before use.
 * Verdicts later come only from independent checks, never from this plan.
 */
export const MAX_AUTO_TESTS = 10;
export const AUTO_TEST_MAX_STEPS = 15;
const MAX_CONTROLS_PER_TEST = 20;
const MAX_CHECKS_PER_TEST = 5;
const PLAN_CHECK_KINDS = ['url', 'visible_text', 'element_visible', 'field_value'] as const;

/** repeatable: the steps use this control more than once (e.g. Add to cart twice); otherwise each approved control acts once. */
export type AutoTestControl = { selector: string; actions: InteractionAction[]; repeatable?: boolean };
export type AutoTest = {
  id: string;
  name: string;
  goal: string;
  rationale: string;
  startPath: string;
  requirementRef: string | null;
  sourceRefs: Array<{ path: string; line: number }>;
  controls: AutoTestControl[];
  mission: MissionInput;
};
export type DroppedTest = { name: string; reason: string };
/** A saved test definition that can be run again without planning (project conversation, 13 Nov 2026). */
export type AutoTestPreset = {
  name: string; goal: string; startPath: string; requirementRef: string | null;
  sourceRefs: Array<{ path: string; line: number }>; checks: CheckDefinition[]; controls: AutoTestControl[];
};
/** A request typed in the project conversation. History holds earlier requests so test data given before is reused. */
export type AutoTestRequest = { text: string; base: AutoTestPreset | null; history: string[] };
export const MAX_REQUEST_TESTS = 3;
export const MAX_REQUEST_CHARS = 2000;
export type AutoTestPlan = { tests: AutoTest[]; dropped: DroppedTest[] };

/** Strict structured-output schema (every property required; nullable where optional). */
export const AUTO_TEST_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'tests'],
  properties: {
    reply: { type: 'string' },
    tests: {
      type: 'array', maxItems: MAX_AUTO_TESTS,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'goal', 'rationale', 'startPath', 'requirementRef', 'sourceRefs', 'controls', 'checks'],
        properties: {
          name: { type: 'string' },
          goal: { type: 'string' },
          rationale: { type: 'string' },
          startPath: { type: 'string' },
          requirementRef: { type: ['string', 'null'] },
          sourceRefs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'line'], properties: { path: { type: 'string' }, line: { type: 'integer' } } } },
          controls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['selector', 'actions', 'repeatable'], properties: { selector: { type: 'string' }, actions: { type: 'array', items: { type: 'string', enum: ['click', 'type', 'select_option', 'set_checked'] } }, repeatable: { type: 'boolean' } } } },
          checks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['kind', 'description', 'expected', 'selector'],
              properties: {
                kind: { type: 'string', enum: [...PLAN_CHECK_KINDS] },
                description: { type: 'string' },
                expected: { type: ['string', 'null'] },
                selector: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const AUTO_TEST_SYSTEM_PROMPT = 'You are a senior QA engineer planning end-to-end browser tests for a web app you have only read, not run. Return JSON only.';

/** Selectors a test may act on: what the scan saw, plus form fields declared in source. */
export function knownSelectors(digest: Pick<RepoDigest, 'forms'>, discovery: DiscoveryResult): Map<string, Set<InteractionAction>> {
  const known = new Map<string, Set<InteractionAction>>();
  const add = (selector: string, actions: InteractionAction[]) => {
    const set = known.get(selector) ?? new Set<InteractionAction>();
    actions.forEach(action => set.add(action));
    known.set(selector, set);
  };
  for (const control of discovery.controls) add(control.selector, control.actions);
  for (const form of digest.forms) {
    for (const field of form.fields) {
      const selector = field.id ? `#${field.id}` : field.name ? `[name="${field.name}"]` : null;
      if (!selector || !/^[#[][\w\-="[\] .:]+$/.test(selector)) continue;
      if (field.tag === 'button' || field.type === 'submit' || field.type === 'button') add(selector, ['click']);
      else if (field.tag === 'select') add(selector, ['select_option', 'click']);
      else if (field.type === 'checkbox' || field.type === 'radio') add(selector, ['set_checked', 'click']);
      else add(selector, ['type', 'click']);
    }
    if (form.id) add(`#${form.id} button[type="submit"]`, ['click']);
    if (form.id) add(`#${form.id} button`, ['click']);
  }
  return known;
}

function describePreset(preset: AutoTestPreset): string {
  return [`Name: ${preset.name}`, `Start page: ${preset.startPath}`, `Steps: ${preset.goal}`,
    `Checks:\n${preset.checks.map(check => `- ${check.kind}${'selector' in check && check.selector ? ` ${check.selector}` : ''}${'expected' in check && check.expected ? ` = ${check.expected}` : ''} (${check.description})`).join('\n')}`,
    `Controls: ${preset.controls.map(control => `${control.selector} (${control.actions.join(', ')})`).join('; ') || 'none'}`].join('\n');
}

export function buildPlanPrompt(input: { appUrl: string; digest: RepoDigest; discovery: DiscoveryResult; maxTests?: number; request?: AutoTestRequest | null }): string {
  const { digest, discovery, request } = input;
  const selectors = knownSelectors(digest, discovery);
  const labels = new Map(discovery.controls.map(control => [control.selector, control.label]));
  const intro = request ? [
    `A person working on this app wrote, in their own words: \"\"\"${request.text}\"\"\"`,
    request.base
      ? `They are talking about this existing test. Return ONE complete revised test that keeps what they did not ask to change:\n${describePreset(request.base)}`
      : `Write up to ${MAX_REQUEST_TESTS} browser tests (usually one) for the running app at ${input.appUrl} that verify exactly what they asked. Do not add unrelated tests.`,
    request.history.length ? `Earlier messages in this project (they may contain test accounts or values to reuse):\n${request.history.map(text => `- ${text}`).join('\n')}` : '',
    'reply: one or two plain sentences to the person. If the message is a question or cannot be tested through the browser, explain that in reply and return no tests. Never claim a test passed or failed; Centinel decides that from its own checks.',
    'Accounts, codes and values the person typed may be used as test data; they are test accounts for this local app.',
  ].filter(Boolean) : [
    `Plan up to ${input.maxTests ?? MAX_AUTO_TESTS} independent browser tests for the running app at ${input.appUrl}.`,
    'Cover the most important user journeys and every stated requirement you can test through the UI. Prefer requirements that state exact messages or rules.',
    'reply: an empty string.',
  ];
  const sections = [
    ...intro,
    'Rules:',
    '- Each test starts from startPath (a path on the app, e.g. "/") with fresh app state; tests never depend on each other.',
    `- goal: plain step-by-step instructions a browser agent can follow, including exact text to type, one step per line. Use only accounts, codes and values written in the repository (seed files, README, fixtures)${request ? ', given by the person' : ''} or invented harmless values. Never invent real-looking secrets.`,
    '- controls: every selector the agent must click or type into, chosen ONLY from "Allowed controls" below, with the actions needed. repeatable: true only when the steps use that same control more than once (for example clicking Add to cart twice); otherwise false.',
    '- checks: 1-5 observable outcomes after the journey, written from the requirement (what SHOULD happen), not from guesses about bugs. kinds: visible_text (expected = exact text that must appear), url (expected = path or full URL), element_visible (selector), field_value (selector + expected). selector must come from Allowed controls when used.',
    '- requirementRef: the requirement id (e.g. "REQ-1") the test verifies, or null. sourceRefs: files/lines from the digest that implement the journey.',
    '- Do not assume the app is correct or broken; write the expected behaviour.',
    // 19 Nov 2026: a test once expected "Sign in to view orders." from an API route the page never calls.
    '- Every expected text must be something the page itself shows during the journey you describe, reached only through the allowed controls. Do not expect error messages from server routes the page never calls, and do not test pages or routes that no allowed control leads to.',
    '- Say exactly how many times to press each control (for example "click Add to cart for Ceramic Mug twice"), and make checks match those counts.',
    '',
    `Allowed controls (selector: actions — visible label):\n${[...selectors].map(([selector, actions]) => `${selector}: ${[...actions].join(', ')}${labels.get(selector) ? ` — ${labels.get(selector)}` : ''}`).join('\n') || '(none found)'}`,
    `Pages scanned:\n${discovery.pages.map(page => `${new URL(page.finalUrl).pathname} (${page.controls} controls${page.redirected ? ', redirected' : ''})`).join('\n')}`,
    `Detected routes:\n${digest.routes.slice(0, 80).map(route => `${route.method ?? ''} ${route.path} [${route.kind}] ${route.file}:${route.line}`.trim()).join('\n') || '(none)'}`,
    digest.requirementsText ? `Requirements:\n${digest.requirementsText}` : 'Requirements: none written; infer expected behaviour from the README and code.',
    `Repository excerpts:\n${digest.entries.map(entry => `--- ${entry.path}:${entry.startLine}-${entry.endLine} (${entry.kind})\n${entry.text}`).join('\n')}`,
  ];
  return sections.join('\n\n');
}

const SECRET_LIKE = /(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abp]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function resolvePath(appUrl: string, value: string): string | null {
  try {
    const url = new URL(value || '/', appUrl);
    return url.origin === new URL(appUrl).origin ? url.href : null;
  } catch {
    return null;
  }
}

/** Validate the model's plan. Unsafe or unusable tests are dropped with a reason, never repaired by guessing. */
export function validatePlan(raw: unknown, input: { appUrl: string; projectId: string; digest: RepoDigest; discovery: DiscoveryResult; maxTests?: number }): AutoTestPlan {
  const limit = input.maxTests ?? MAX_AUTO_TESTS;
  const dropped: DroppedTest[] = [];
  const tests: AutoTest[] = [];
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { tests?: unknown }).tests) ? (raw as { tests: unknown[] }).tests : [];
  const selectors = knownSelectors(input.digest, input.discovery);
  const digestPaths = new Set([...input.digest.entries.map(entry => entry.path), ...input.digest.routes.map(route => route.file), ...input.digest.forms.map(form => form.file)]);
  const names = new Set<string>();
  for (const item of list.slice(0, MAX_AUTO_TESTS * 2)) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = clean(row.name, 120) || 'Untitled test';
    const drop = (reason: string) => { dropped.push({ name, reason }); };
    if (tests.length >= limit) { drop('More tests than the limit.'); continue; }
    if (names.has(name.toLowerCase())) { drop('Duplicate test name.'); continue; }
    const goal = clean(row.goal, 2000);
    if (!goal) { drop('No instructions.'); continue; }
    if (SECRET_LIKE.test(JSON.stringify(row))) { drop('Contained a value that looks like a real secret.'); continue; }
    const target = resolvePath(input.appUrl, clean(row.startPath, 500));
    if (!target) { drop('Start page is not on the app.'); continue; }

    const controls: AutoTestControl[] = [];
    let unknownControl = false;
    for (const control of Array.isArray(row.controls) ? row.controls : []) {
      const selector = clean((control as { selector?: unknown })?.selector, 500);
      const allowed = selectors.get(selector);
      if (!allowed) { unknownControl = true; continue; }
      const wanted = Array.isArray((control as { actions?: unknown }).actions) ? (control as { actions: unknown[] }).actions : [];
      const actions = [...new Set(wanted.filter((action): action is InteractionAction => typeof action === 'string' && allowed.has(action as InteractionAction)))];
      if (!actions.length || actions.length !== wanted.length || controls.some(existing => existing.selector === selector)) { unknownControl = true; continue; }
      // The action policy allows repeatable only on clickable grants.
      controls.push({ selector, actions, ...((control as { repeatable?: unknown }).repeatable === true && actions.includes('click') ? { repeatable: true } : {}) });
    }
    if (unknownControl) { drop('A required control or action was unavailable or duplicated.'); continue; }
    if (controls.length > MAX_CONTROLS_PER_TEST) { drop('More controls than one test can use.'); continue; }

    const testId = crypto.randomUUID();
    const criterionId = clean(row.requirementRef, 60) || `auto-${tests.length + 1}`;
    const checks: CheckDefinition[] = [];
    for (const rawCheck of (Array.isArray(row.checks) ? row.checks : []).slice(0, MAX_CHECKS_PER_TEST)) {
      const check = (rawCheck ?? {}) as Record<string, unknown>;
      const kind = check.kind as typeof PLAN_CHECK_KINDS[number];
      const description = clean(check.description, 500) || 'Expected outcome';
      const expected = typeof check.expected === 'string' ? check.expected.trim().slice(0, 1000) : '';
      const selector = clean(check.selector, 500);
      const base = { id: `${testId.slice(0, 8)}-c${checks.length + 1}`, criterionId, description, required: true };
      if (kind === 'visible_text' && expected) checks.push({ ...base, kind, expected });
      else if (kind === 'url' && expected) { const url = resolvePath(input.appUrl, expected); if (url) checks.push({ ...base, kind, expected: url }); }
      else if (kind === 'element_visible' && selectors.has(selector)) checks.push({ ...base, kind, selector });
      else if (kind === 'field_value' && selectors.has(selector)) checks.push({ ...base, kind, selector, expected });
    }
    if (!checks.length) { drop('No usable independent check.'); continue; }

    const mission = { name, goal, targetUrl: target, maxSteps: AUTO_TEST_MAX_STEPS, checks, context: null, contextAcknowledged: false, mode: 'guided' as const };
    let validated: MissionInput;
    try {
      validated = validateMission(mission, input.projectId);
    } catch (error) {
      drop(error instanceof Error ? error.message : 'Invalid test.');
      continue;
    }
    const sourceRefs = (Array.isArray(row.sourceRefs) ? row.sourceRefs : [])
      .map(ref => ({ path: clean((ref as { path?: unknown })?.path, 500), line: Number((ref as { line?: unknown })?.line) }))
      .filter(ref => digestPaths.has(ref.path) && Number.isInteger(ref.line) && ref.line > 0)
      .slice(0, 5);
    names.add(name.toLowerCase());
    tests.push({
      id: testId, name, goal, rationale: clean(row.rationale, 600), startPath: new URL(target).pathname,
      requirementRef: clean(row.requirementRef, 60) || null, sourceRefs, controls, mission: validated,
    });
  }
  return { tests, dropped };
}

/** The model's plain-language reply in a conversation request (never a verdict). */
export function planReply(raw: unknown): string | null {
  const reply = raw && typeof raw === 'object' ? (raw as { reply?: unknown }).reply : null;
  return typeof reply === 'string' && reply.trim() ? reply.trim().slice(0, 1000) : null;
}

/** Rebuild a saved test against the app's current address; it is validated again like a new plan. */
export function presetToTest(preset: AutoTestPreset, input: { appUrl: string; projectId: string }): AutoTest | null {
  const target = resolvePath(input.appUrl, preset.startPath);
  // Empty controls are valid for saved assertion-only tests; checks still need validation below.
  if (!target || !Array.isArray(preset.controls) || !preset.checks.length) return null;
  const origin = new URL(input.appUrl).origin;
  const checks = preset.checks.map(check => check.kind === 'url' ? { ...check, expected: new URL(new URL(check.expected).pathname + new URL(check.expected).search, origin).href } : check);
  try {
    const mission = validateMission({ name: preset.name, goal: preset.goal, targetUrl: target, maxSteps: AUTO_TEST_MAX_STEPS, checks, context: null, contextAcknowledged: false, mode: 'guided' }, input.projectId);
    return { id: crypto.randomUUID(), name: preset.name, goal: preset.goal, rationale: 'Saved test.', startPath: new URL(target).pathname,
      requirementRef: preset.requirementRef, sourceRefs: preset.sourceRefs, controls: preset.controls, mission };
  } catch {
    return null;
  }
}
