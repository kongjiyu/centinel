import { chromium } from 'playwright';
import { DynamicContractError } from '../types.js';
import type { InteractionAction } from '../browser/actionPolicy.js';
import type { BrowserSessionState } from './sessionVault.js';

/**
 * Read-only control discovery for environment permission authoring. It loads
 * the target page once, never clicks, types or submits, and never reads field
 * values. It only proposes unique CSS selectors that a tester then approves;
 * the recorded action policy remains the enforcement boundary.
 */
export type DiscoveredControl = { selector: string; label: string; actions: InteractionAction[]; kind: string; page?: string };

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
      ...['data-testid', 'data-test', 'data-cy', 'data-qa'].map(attribute => element.getAttribute(attribute) ? '[' + attribute + '="' + quote(element.getAttribute(attribute)) + '"]' : ''),
      element.getAttribute('name') ? tag + '[name="' + quote(element.getAttribute('name')) + '"]' : '',
      element.getAttribute('aria-label') ? tag + '[aria-label="' + quote(element.getAttribute('aria-label')) + '"]' : '',
    ].filter(Boolean);
    // Fallback for repeated controls without names (e.g. one "Add to cart" per row): a
    // positional path from the nearest ancestor with an id, still a plain unique CSS selector.
    const structural = () => {
      const parts = [];
      let node = element;
      for (let depth = 0; node && depth < 6; depth++) {
        if (depth > 0 && node.id) return '#' + CSS.escape(node.id) + ' > ' + parts.join(' > ');
        const parent = node.parentElement;
        if (!parent) return '';
        const same = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : ''));
        node = parent;
      }
      return '';
    };
    let selector = options.find(unique);
    let positional = false;
    if (!selector) { const path = structural(); if (path && unique(path)) { selector = path; positional = true; } }
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    const label = (element.getAttribute('aria-label')
      || (element.labels && element.labels[0] && element.labels[0].textContent)
      || element.getAttribute('placeholder')
      || (tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : element.textContent)
      || element.getAttribute('title')
      || selector).replace(/\s+/g, ' ').trim().slice(0, 80)
      + (positional && element.parentElement ? ' — ' + (element.parentElement.textContent || '').replace(element.textContent || '', '').replace(/\s+/g, ' ').trim().slice(0, 40) : '');
    const textField = tag === 'textarea' || (tag === 'input' && ['', 'text', 'email', 'password', 'search', 'number', 'tel', 'url'].includes(type));
    const toggle = (tag === 'input' && ['checkbox', 'radio'].includes(type)) || element.getAttribute('role') === 'checkbox';
    const actions = textField ? ['type'] : toggle ? ['set_checked'] : tag === 'select' ? ['select_option'] : ['click'];
    const kind = textField ? (type === 'password' ? 'Password field' : 'Text field') : toggle ? 'Checkbox' : tag === 'select' ? 'List' : tag === 'a' ? 'Link' : 'Button';
    results.push({ selector, label, actions, kind });
    if (results.length >= limit) break;
  }
  return results;
}`;

/** Smoke health of one page load (Auto test, 18 Nov 2026): counts plus at most two short, redacted messages. */
export type PageHealth = { status: number | null; pageErrors: number; consoleErrors: number; serverErrors: number; messages: string[] };
export type DiscoveryPage = { url: string; finalUrl: string; controls: number; redirected: boolean; health?: PageHealth };
/** Error text can carry data from the page: keep it short and withhold local paths, tokens and long numbers. */
function shortMessage(text: string): string {
  return text.replace(/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|[A-Za-z]:\\)[^\s"'<>]*/g, '[local path]')
    .replace(/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{32,}|\d{9,})\b/g, '[withheld]').replace(/\s+/g, ' ').trim().slice(0, 200);
}
export type DiscoveryResult = { controls: DiscoveredControl[]; pages: DiscoveryPage[] };

/**
 * Scan the target and optional same-origin pages. A saved signed-in browser
 * session for the environment may be supplied so pages behind sign-in can be
 * read; it is used only inside this short-lived, read-only browser context.
 */
/** maxPaths/maxControls are raised only by Autonomous testing; the manual scan keeps 5 pages and 20 controls. */
export async function discoverControls(target: URL, options: { timeoutMs?: number; paths?: string[]; storageState?: BrowserSessionState; maxPaths?: number; maxControls?: number; collectHealth?: boolean } = {}): Promise<DiscoveryResult> {
  const maxPaths = Math.min(Math.max(options.maxPaths ?? 5, 0), 19);
  const maxControls = Math.min(Math.max(options.maxControls ?? MAX_CONTROLS, 1), 80);
  const pageUrls = [target, ...(options.paths ?? []).map(path => new URL(path, target))]
    .filter((url, index, all) => all.findIndex(other => other.href === url.href) === index);
  if (pageUrls.some(url => url.origin !== target.origin)) throw new DynamicContractError(400, 'Additional pages must be on the same website as the test address.');
  if (pageUrls.length > maxPaths + 1) throw new DynamicContractError(400, maxPaths === 5 ? 'Scan at most five additional pages at a time.' : `Scan at most ${maxPaths} additional pages at a time.`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, ...(options.storageState ? { storageState: options.storageState } : {}) });
    const page = await context.newPage();
    // Stay on the requested origin; the discovery never follows redirects elsewhere.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === target.origin || route.request().resourceType() !== 'document' ? route.continue() : route.abort();
    });
    const controls: DiscoveredControl[] = [];
    const pages: DiscoveryPage[] = [];
    // Health counters for the page currently loading; read-only listeners, nothing is sent to the page.
    let health: PageHealth = { status: null, pageErrors: 0, consoleErrors: 0, serverErrors: 0, messages: [] };
    const note = (text: string) => { if (health.messages.length < 2) health.messages.push(shortMessage(text)); };
    if (options.collectHealth) {
      page.on('pageerror', error => { health.pageErrors++; note(error.message); });
      page.on('console', message => { if (message.type() === 'error') { health.consoleErrors++; note(message.text()); } });
      page.on('response', response => { if (response.status() >= 500 && new URL(response.url()).origin === target.origin) { health.serverErrors++; note(`${response.status()} from ${new URL(response.url()).pathname}`); } });
    }
    for (const url of pageUrls) {
      health = { status: null, pageErrors: 0, consoleErrors: 0, serverErrors: 0, messages: [] };
      try {
        const response = await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: options.timeoutMs ?? 15_000 });
        health.status = response?.status() ?? null;
      } catch {
        if (url === pageUrls[0]) throw new DynamicContractError(409, 'The website could not be opened. Check that it is running and reachable, then try again.');
        pages.push({ url: url.toString(), finalUrl: page.url(), controls: 0, redirected: true, ...(options.collectHealth ? { health: { ...health, messages: ['The page did not finish loading.', ...health.messages].slice(0, 2) } } : {}) });
        continue;
      }
      const found = await page.evaluate(`(${COLLECT_CONTROLS})(${maxControls})`) as Array<{ selector: string; label: string; actions: string[]; kind: string }>;
      const finalUrl = page.url();
      const redirected = new URL(finalUrl).pathname !== url.pathname;
      let added = 0;
      for (const item of found) {
        if (controls.length >= maxControls || controls.some(existing => existing.selector === item.selector)) continue;
        controls.push({ ...item, actions: item.actions as InteractionAction[], page: new URL(finalUrl).pathname });
        added++;
      }
      pages.push({ url: url.toString(), finalUrl, controls: added, redirected, ...(options.collectHealth ? { health: { ...health, messages: [...health.messages] } } : {}) });
    }
    return { controls, pages };
  } finally {
    await browser.close().catch(() => {});
  }
}
