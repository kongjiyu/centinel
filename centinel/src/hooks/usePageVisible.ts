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
 */

export function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** Calls `listener` with the new visibility each time it changes. */
export function subscribePageVisibility(listener: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handle = () => listener(isPageVisible());
  document.addEventListener('visibilitychange', handle);
  return () => document.removeEventListener('visibilitychange', handle);
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
 * `callback` runs immediately when the page becomes visible again.
 * Returns a function that stops the interval and the visibility listener.
 */
export function setVisibleInterval(callback: () => void, delayMs: number): () => void {
  const timer = setInterval(() => { if (isPageVisible()) callback(); }, delayMs);
  const unsubscribe = subscribePageVisibility(visible => { if (visible) callback(); });
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
