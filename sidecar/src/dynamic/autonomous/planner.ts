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

export type AutoTestControl = { selector: string; actions: InteractionAction[] };
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
export type AutoTestPlan = { tests: AutoTest[]; dropped: DroppedTest[] };

/** Strict structured-output schema (every property required; nullable where optional). */
export const AUTO_TEST_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tests'],
  properties: {
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
          controls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['selector', 'actions'], properties: { selector: { type: 'string' }, actions: { type: 'array', items: { type: 'string', enum: ['click', 'type', 'select_option', 'set_checked'] } } } } },
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

export function buildPlanPrompt(input: { appUrl: string; digest: RepoDigest; discovery: DiscoveryResult; maxTests?: number }): string {
  const { digest, discovery } = input;
  const selectors = knownSelectors(digest, discovery);
  const sections = [
    `Plan up to ${input.maxTests ?? MAX_AUTO_TESTS} independent browser tests for the running app at ${input.appUrl}.`,
    'Cover the most important user journeys and every stated requirement you can test through the UI. Prefer requirements that state exact messages or rules.',
    'Rules:',
    '- Each test starts from startPath (a path on the app, e.g. "/") with fresh app state; tests never depend on each other.',
    '- goal: plain step-by-step instructions a browser agent can follow, including exact text to type. Use only accounts, codes and values written in the repository (seed files, README, fixtures) or invented harmless values. Never invent real-looking secrets.',
    '- controls: every selector the agent must click or type into, chosen ONLY from "Allowed controls" below, with the actions needed.',
    '- checks: 1-5 observable outcomes after the journey, written from the requirement (what SHOULD happen), not from guesses about bugs. kinds: visible_text (expected = exact text that must appear), url (expected = path or full URL), element_visible (selector), field_value (selector + expected). selector must come from Allowed controls when used.',
    '- requirementRef: the requirement id (e.g. "REQ-1") the test verifies, or null. sourceRefs: files/lines from the digest that implement the journey.',
    '- Do not assume the app is correct or broken; write the expected behaviour.',
    '',
    `Allowed controls (selector: actions):\n${[...selectors].map(([selector, actions]) => `${selector}: ${[...actions].join(', ')}`).join('\n') || '(none found)'}`,
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
export function validatePlan(raw: unknown, input: { appUrl: string; projectId: string; digest: RepoDigest; discovery: DiscoveryResult }): AutoTestPlan {
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
    if (tests.length >= MAX_AUTO_TESTS) { drop('More tests than the limit.'); continue; }
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
      if (!actions.length || controls.some(existing => existing.selector === selector)) continue;
      controls.push({ selector, actions });
    }
    if (unknownControl && !controls.length) { drop('Used controls Centinel did not find in the app.'); continue; }
    if (controls.length > MAX_CONTROLS_PER_TEST) controls.length = MAX_CONTROLS_PER_TEST;

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
