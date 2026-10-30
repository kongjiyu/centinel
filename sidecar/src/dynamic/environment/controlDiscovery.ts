import { chromium } from 'playwright';
import { DynamicContractError } from '../types.js';
import type { InteractionAction } from '../browser/actionPolicy.js';

/**
 * Read-only control discovery for environment permission authoring. It loads
 * the target page once, never clicks, types or submits, and never reads field
 * values. It only proposes unique CSS selectors that a tester then approves;
 * the recorded action policy remains the enforcement boundary.
 */
export type DiscoveredControl = { selector: string; label: string; actions: InteractionAction[]; kind: string };

const MAX_CONTROLS = 20;

export function discoveryTargetUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4000) throw new DynamicContractError(400, 'Enter the test website address first.');
  let url: URL;
  try { url = new URL(value); } catch { throw new DynamicContractError(400, 'Enter a valid http or https website address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new DynamicContractError(400, 'Enter a valid http or https website address without credentials.');
  return url;
}

/**
 * Runs inside the page: collect unique selectors and visible labels only.
 * Kept as plain JavaScript text so build tools cannot inject helpers (such as
 * esbuild's __name) that do not exist in the browser.
 */
const COLLECT_CONTROLS = String.raw`(limit) => {
  const candidates = Array.from(document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"]'));
  const unique = selector => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  const quote = value => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const results = [];
  const seen = new Set();
  for (const element of candidates) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'file', 'reset'].includes(type)) continue;
    if (element.closest('a[download]')) continue;
    const options = [
      element.id ? '#' + CSS.escape(element.id) : '',
      element.getAttribute('data-testid') ? '[data-testid="' + quote(element.getAttribute('data-testid')) + '"]' : '',
      element.getAttribute('name') ? tag + '[name="' + quote(element.getAttribute('name')) + '"]' : '',
      element.getAttribute('aria-label') ? tag + '[aria-label="' + quote(element.getAttribute('aria-label')) + '"]' : '',
    ].filter(Boolean);
    const selector = options.find(unique);
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    const label = (element.getAttribute('aria-label')
      || (element.labels && element.labels[0] && element.labels[0].textContent)
      || element.getAttribute('placeholder')
      || (tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : element.textContent)
      || element.getAttribute('title')
      || selector).replace(/\s+/g, ' ').trim().slice(0, 80);
    const textField = tag === 'textarea' || (tag === 'input' && ['', 'text', 'email', 'password', 'search', 'number', 'tel', 'url'].includes(type));
    const toggle = (tag === 'input' && ['checkbox', 'radio'].includes(type)) || element.getAttribute('role') === 'checkbox';
    const actions = textField ? ['type'] : toggle ? ['set_checked'] : tag === 'select' ? ['select_option'] : ['click'];
    const kind = textField ? (type === 'password' ? 'Password field' : 'Text field') : toggle ? 'Checkbox' : tag === 'select' ? 'List' : tag === 'a' ? 'Link' : 'Button';
    results.push({ selector, label, actions, kind });
    if (results.length >= limit) break;
  }
  return results;
}`;

export async function discoverControls(target: URL, options: { timeoutMs?: number } = {}): Promise<DiscoveredControl[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    // Stay on the requested origin; the discovery never follows redirects elsewhere.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === target.origin || route.request().resourceType() !== 'document' ? route.continue() : route.abort();
    });
    try {
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 15_000 });
    } catch {
      throw new DynamicContractError(409, 'The website could not be opened. Check that it is running and reachable, then try again.');
    }
    const controls = await page.evaluate(`(${COLLECT_CONTROLS})(${MAX_CONTROLS})`) as Array<{ selector: string; label: string; actions: string[]; kind: string }>;
    return controls.map(item => ({ ...item, actions: item.actions as InteractionAction[] }));
  } finally {
    await browser.close().catch(() => {});
  }
}
