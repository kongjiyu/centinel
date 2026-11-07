import { useEffect, useState } from 'react';

/**
 * Page visibility helpers for status polling.
 *
 * Screens poll the sidecar while work is running. When the desktop window is
 * hidden (minimised, on another space, or behind a full-screen app) those
 * requests only spend network and Supabase quota on views nobody can see.
 * These helpers skip polls while the page is hidden and refresh once as soon
 * as it becomes visible again. They never change poll intervals or what each
 * request does.
 *
 * The macOS webview can also report `hidden` for a window that is only behind
 * other windows, while the person is still clicking, scrolling or typing in
 * it. Interaction inside the page therefore counts as visible: it refreshes
 * immediately and keeps polling running for `ACTIVITY_WINDOW_MS` after the
 * last interaction. A hidden window nobody interacts with stays paused.
 */

/** How long one interaction keeps a hidden page polling. */
export const ACTIVITY_WINDOW_MS = 60_000;

const ACTIVITY_EVENTS = ['pointerdown', 'mousedown', 'click', 'keydown', 'wheel', 'touchstart', 'scroll', 'focusin'] as const;

let lastActivityAt = -Infinity;
let effectiveVisible: boolean | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let tracking = false;
const listeners = new Set<(visible: boolean) => void>();

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function isPageVisible(): boolean {
  return documentVisible() || Date.now() - lastActivityAt < ACTIVITY_WINDOW_MS;
}

function publish() {
  const visible = isPageVisible();
  if (visible === effectiveVisible) return;
  effectiveVisible = visible;
  for (const listener of [...listeners]) listener(visible);
}

// Re-check when the interaction window ends so a still-hidden page pauses again.
function scheduleExpiry(delayMs: number) {
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    const remaining = lastActivityAt + ACTIVITY_WINDOW_MS - Date.now();
    if (remaining > 0) scheduleExpiry(remaining);
    else publish();
  }, delayMs);
}

function recordActivity() {
  lastActivityAt = Date.now();
  // Frequent events (scroll, wheel) only move the timestamp; the pending check reschedules itself.
  if (expiryTimer === null) scheduleExpiry(ACTIVITY_WINDOW_MS);
  publish();
}

function startTracking() {
  if (tracking || typeof window === 'undefined' || typeof document === 'undefined') return;
  tracking = true;
  effectiveVisible = isPageVisible();
  for (const name of ACTIVITY_EVENTS) window.addEventListener(name, recordActivity, { capture: true, passive: true });
  window.addEventListener('focus', recordActivity);
  document.addEventListener('visibilitychange', publish);
}

function stopTrackingIfIdle() {
  if (!tracking || listeners.size > 0) return;
  tracking = false;
  for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, recordActivity, { capture: true });
  window.removeEventListener('focus', recordActivity);
  document.removeEventListener('visibilitychange', publish);
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  effectiveVisible = null;
}

/**
 * Calls `listener` each time the page's effective visibility changes: the
 * document is shown or hidden, or an interaction starts or ends an activity
 * window while the document reports hidden.
 */
export function subscribePageVisibility(listener: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  startTracking();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    stopTrackingIfIdle();
  };
}

/** React state that follows the page's visibility. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(isPageVisible);
  useEffect(() => {
    setVisible(isPageVisible());
    return subscribePageVisibility(setVisible);
  }, []);
  return visible;
}

/**
 * Like `setInterval`, but ticks are skipped while the page is hidden and
 * `callback` runs immediately when the page becomes visible again (including
 * the first interaction with a page that reports hidden).
 * Returns a function that stops the interval and the visibility listener.
 */
export function setVisibleInterval(callback: () => void, delayMs: number): () => void {
  const unsubscribe = subscribePageVisibility(visible => { if (visible) callback(); });
  const timer = setInterval(() => { if (isPageVisible()) callback(); }, delayMs);
  return () => { clearInterval(timer); unsubscribe(); };
}

/**
 * Like `setTimeout` for chained polling. If the page is hidden when the delay
 * ends, `callback` waits and runs as soon as the page is visible again.
 * Returns a function that cancels the pending call.
 */
export function setVisibleTimeout(callback: () => void, delayMs: number): () => void {
  let unsubscribe: (() => void) | null = null;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    unsubscribe?.();
    unsubscribe = null;
    callback();
  };
  const timer = setTimeout(() => {
    if (isPageVisible()) { run(); return; }
    unsubscribe = subscribePageVisibility(visible => { if (visible) run(); });
  }, delayMs);
  return () => {
    done = true;
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** Test-only: forget recorded interaction so each test starts idle. */
export function resetPageActivityForTests() {
  lastActivityAt = -Infinity;
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  effectiveVisible = tracking ? isPageVisible() : null;
}
