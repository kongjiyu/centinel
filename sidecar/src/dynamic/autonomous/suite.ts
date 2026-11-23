import crypto from 'node:crypto';
import type { DiscoveryResult } from '../environment/controlDiscovery.js';
import type { ExplorationSnapshot } from '../browser/exploration.js';
import { validateMission } from '../service.js';
import type { CheckDefinition } from '../types.js';
import type { UsabilityAssessment, UsabilityConfig } from '../usability/types.js';
import type { AutoTest, AutoTestControl } from './planner.js';

/**
 * The fixed test kinds a full check adds to the planned browser tests (18 Nov 2026, user request):
 * - smoke: every scanned page opens without a server error or a script error. Deterministic, no AI;
 *   read from the page scan Centinel already does.
 * - exploratory: one bounded exploratory Run over the controls the scan saw. It reports where it
 *   went and what it did not try; visiting a screen is never a pass.
 * - usability: one Run on the first page that applies the existing rule-based checks (labels,
 *   keyboard reach, focus). Persona simulation is not a user study.
 * None of these asks the model for a verdict.
 */
export type AutoTestKind = 'smoke' | 'exploratory' | 'usability' | 'unit';
export type AutoTestSuite = { smoke: boolean; exploratory: boolean; usability: boolean; unit?: boolean };
export const FULL_SUITE: AutoTestSuite = { smoke: true, exploratory: true, usability: true, unit: true };

export type SmokePage = { path: string; status: number | null; ok: boolean; problem: string | null };
export type SmokeResult = { pages: SmokePage[] };
/** untried: distinct controls the run was allowed to press but did not; outOfScope: distinct controls it may not press (typing, orders, payment). */
export type ExplorationSummary = { screens: number; actions: number; untried: number; truncated: boolean; outOfScope?: number; seen?: number };
export type UsabilityFailure = { rule: string; expected: string; observed: string; count: number };
export type UsabilitySummary = { sampled: number; failures: UsabilityFailure[]; uncertain: number; limitations: string[] };

export const EXPLORATORY_MAX_STEPS = 25;
export const USABILITY_MAX_STEPS = 3;
const MAX_POLICY_CONTROLS = 20;
/** Controls an unattended exploration must not press: they end the session, delete, pay or send. */
const RISKY_LABEL = /\b(log ?out|sign ?out|delete|remove|destroy|clear|reset|pay|payment|purchase|buy|checkout|place (?:an )?order|order now|book|reserve|send|transfer|submit|confirm|save|publish|post|unsubscribe|deactivate|cancel (?:my )?(?:account|subscription))\b/i;

/**
 * Repeat clicks in Auto test (19 Nov 2026, user decision). Every test runs on a fresh copy of the app
 * Centinel started itself, so ordinary buttons (Add to cart, tabs, Next) may be pressed more than once.
 * Buttons that place orders, pay, delete, send, save or submit keep the one-click rule, as do submit
 * buttons whose name is unknown. The model's own repeatable mark is kept as before.
 */
export function autoRepeatable(control: { selector: string; actions: readonly string[] }, label: string | undefined): boolean {
  if (!control.actions.includes('click')) return false;
  const name = label ?? '';
  if (RISKY_LABEL.test(name) || RISKY_LABEL.test(control.selector)) return false;
  if (!label && /type=["']?submit|\bsubmit\b/i.test(control.selector)) return false;
  return true;
}

/** Page health → one smoke entry. A page fails on a 5xx status, a script error or a 5xx response it made. */
export function smokeResult(discovery: DiscoveryResult): SmokeResult {
  return {
    pages: discovery.pages.filter(page => page.health).map(page => {
      const health = page.health!;
      const path = safePath(page.url);
      const reasons = [
        health.status !== null && health.status >= 500 ? `The page answered with HTTP ${health.status}.` : null,
        health.status === null && page.redirected && page.controls === 0 ? 'The page did not finish loading.' : null,
        health.pageErrors ? `${health.pageErrors} script error${health.pageErrors === 1 ? '' : 's'} on the page.` : null,
        health.serverErrors ? `${health.serverErrors} request${health.serverErrors === 1 ? '' : 's'} to the app failed with a server error.` : null,
      ].filter((value): value is string => !!value);
      const detail = reasons.length && health.messages.length ? ` First message: ${health.messages[0]}` : '';
      return { path, status: health.status, ok: !reasons.length, problem: reasons.length ? reasons.join(' ') + detail : null };
    }),
  };
}

/** True when the first page itself is broken, so the other browser tests cannot tell anything useful. */
export function smokeBlocksTesting(smoke: SmokeResult): boolean {
  const first = smoke.pages[0];
  return !!first && !first.ok && first.status !== null && first.status >= 500;
}

function safePath(url: string): string {
  try { return new URL(url).pathname || '/'; } catch { return '/'; }
}

const bodyCheck = (prefix: string, description: string): CheckDefinition =>
  ({ id: `${prefix}-c1`, criterionId: `${prefix}-1`, kind: 'element_visible', selector: 'body', description, required: true });

export const MAX_EXPLORATIONS = 3;
const SHARED_LINKS = 8;

/**
 * Up to three exploratory Runs over safe, clickable controls the scan saw (19 Nov 2026, user request:
 * cover more of the app). Each run may press the same navigation links but a different set of the other
 * buttons, so the runs cannot all spend their steps on the same controls. Page text never enters the
 * instructions; the split is done only through each run's allowed controls.
 */
export function exploratoryTests(input: { appUrl: string; projectId: string; discovery: DiscoveryResult }): AutoTest[] {
  const seen = new Set<string>();
  const usable = input.discovery.controls
    .filter(control => control.actions.includes('click') && !RISKY_LABEL.test(control.label) && !seen.has(control.selector) && seen.add(control.selector));
  if (!usable.length) return [];
  const links = usable.filter(control => control.kind === 'Link').slice(0, SHARED_LINKS);
  const others = usable.filter(control => !links.includes(control));
  const room = MAX_POLICY_CONTROLS - links.length;
  const groups: typeof usable[] = [];
  for (let index = 0; index < others.length && groups.length < MAX_EXPLORATIONS; index += room) groups.push(others.slice(index, index + room));
  if (!groups.length) groups.push([]);
  // Fewer buttons than one run can hold: split them so each run still starts on different ones.
  if (groups.length === 1 && others.length >= MAX_EXPLORATIONS * 2) {
    const size = Math.ceil(others.length / MAX_EXPLORATIONS);
    groups.splice(0, 1, ...Array.from({ length: MAX_EXPLORATIONS }, (_, part) => others.slice(part * size, (part + 1) * size)));
  }
  const total = groups.length;
  return groups.flatMap((group, part) => {
    const allowed = [...links, ...group];
    if (!allowed.length) return [];
    const startPage = group[0]?.page ?? allowed[0].page ?? '/';
    const startPath = startPage.startsWith('/') ? startPage : '/';
    const name = total > 1 ? `Explore the app (${part + 1} of ${total})` : 'Explore the app';
    const id = crypto.randomUUID();
    try {
      const mission = validateMission({
        name, mode: 'exploratory', targetUrl: new URL(startPath, input.appUrl).href, maxSteps: EXPLORATORY_MAX_STEPS, context: null, contextAcknowledged: false,
        goal: 'Explore the app from this page. Try every control you are allowed to press that you have not tried yet, one at a time, and open the screens they lead to. Note anything that looks broken. Do not type into forms, sign out, delete or send anything.',
        checks: [bodyCheck(`explore-${id.slice(0, 8)}`, 'The app still shows a page after exploring (it did not go blank or crash).')],
      }, input.projectId);
      return [{ id, name, goal: mission.goal, rationale: 'Exploratory test: looks for screens and controls the written tests did not cover.', startPath, requirementRef: null, sourceRefs: [],
        controls: allowed.map(control => ({ selector: control.selector, actions: ['click'], repeatable: true })), mission }];
    } catch {
      return [];
    }
  });
}

/** One Run on the first page that applies the rule-based usability checks. */
export function usabilityTest(input: { appUrl: string; projectId: string }): AutoTest | null {
  const id = crypto.randomUUID();
  const check = bodyCheck(`usability-${id.slice(0, 8)}`, 'The first page opens.');
  const usability: UsabilityConfig = { schemaVersion: 1, persona: 'first_time', rules: ['labels', 'keyboard', 'focus'], feedbackCheckIds: [], errorRecoveryCheckIds: [] };
  try {
    const mission = validateMission({
      name: 'Usability of the first page', mode: 'guided', targetUrl: new URL('/', input.appUrl).href, maxSteps: USABILITY_MAX_STEPS, context: null, contextAcknowledged: false,
      goal: 'Open the first page and wait until it has loaded. Do not click or type anything; ORIN then checks control labels, keyboard reach and focus on its own.',
      checks: [check], usability,
    }, input.projectId);
    return { id, name: 'Usability of the first page', goal: mission.goal, rationale: 'Rule-based usability checks: labels, keyboard reach and visible focus.', startPath: '/', requirementRef: null, sourceRefs: [], controls: [], mission: { ...mission, usability } };
  } catch {
    return null;
  }
}

/**
 * Counts distinct controls (19 Nov 2026): the journal lists a control once per screen it appeared on, so
 * the same button on five screens counted five times. A control is keyed by its selector, or by role and
 * name when it has none. Controls the run was not allowed to press are reported apart from untried ones.
 */
export function explorationSummary(snapshot: ExplorationSnapshot | undefined, allowedSelectors: readonly string[] = []): ExplorationSummary | undefined {
  if (!snapshot) return undefined;
  const key = (control: { selector?: string; role: string; name: string }) => control.selector ?? `${control.role}:${control.name}`;
  const seen = new Set<string>();
  const pressed = new Set<string>();
  for (const state of snapshot.states) for (const control of state.controls ?? []) seen.add(key(control));
  for (const action of snapshot.actions) {
    if (action.status !== 'dispatched' || !action.targetRef) continue;
    const control = snapshot.states.find(state => state.id === action.beforeStateId)?.controls?.find(item => item.ref === action.targetRef);
    if (control) pressed.add(key(control));
  }
  const allowed = new Set(allowedSelectors);
  const notPressed = [...seen].filter(item => !pressed.has(item));
  const untried = allowed.size ? notPressed.filter(item => allowed.has(item)).length : notPressed.length;
  return {
    screens: snapshot.states.length, actions: snapshot.actions.filter(action => action.status === 'dispatched').length,
    untried, ...(allowed.size ? { outOfScope: notPressed.length - untried } : {}), seen: seen.size, truncated: snapshot.truncated,
  };
}

const RULE_TEXT: Record<string, { expected: string; observed: (count: number) => string }> = {
  labels: { expected: 'Every button, link and field has a name people and screen readers can see.', observed: count => `${count} control${count === 1 ? ' has' : 's have'} no label or name.` },
  keyboard: { expected: 'Every control can be reached with the Tab key.', observed: count => `${count} control${count === 1 ? ' was' : 's were'} not reached with the Tab key.` },
};

/** Only deterministic rule failures count; uncertain focus results stay uncertain. */
export function usabilitySummary(assessment: UsabilityAssessment | undefined): UsabilitySummary | undefined {
  if (!assessment) return undefined;
  const failures: UsabilityFailure[] = [];
  for (const rule of Object.keys(RULE_TEXT)) {
    const count = assessment.observations.filter(row => row.ruleId === rule && row.kind === 'deterministic' && row.verdict === 'failed').length;
    if (count) failures.push({ rule, expected: RULE_TEXT[rule].expected, observed: RULE_TEXT[rule].observed(count), count });
  }
  const sampled = new Set(assessment.observations.map(row => row.controlRef).filter(Boolean)).size;
  return { sampled, failures, uncertain: assessment.observations.filter(row => row.verdict === 'uncertain').length, limitations: assessment.limitations.slice(0, 6) };
}
