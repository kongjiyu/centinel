import type { Page } from 'playwright';
import type { LiveSink } from './liveHub.js';

export const LIVE_SCREENCAST = { size: { width: 1280, height: 720 }, quality: 60, fps: 8 } as const;

/** Drops frames that arrive sooner than 1/fps after the last forwarded frame. */
export function throttleFrames(sink: Pick<LiveSink, 'frame'>, fps: number = LIVE_SCREENCAST.fps, now: () => number = Date.now) {
  const interval = 1000 / fps;
  let last = -Infinity;
  return (frame: Parameters<LiveSink['frame']>[0]) => {
    const at = now();
    if (at - last < interval) return false;
    last = at;
    sink.frame(frame);
    return true;
  };
}

/**
 * Starts a Playwright JPEG screencast for the live view. Frames are only forwarded to the
 * in-memory sink, never written to disk, and nothing is injected into the page DOM.
 * Returns an idempotent stop function that never throws.
 */
export async function startLiveScreencast(page: Page, sink: LiveSink, options: { fps?: number; now?: () => number } = {}): Promise<() => Promise<void>> {
  let stopped = false;
  const forward = throttleFrames(sink, options.fps ?? LIVE_SCREENCAST.fps, options.now);
  await page.screencast.start({
    size: { ...LIVE_SCREENCAST.size },
    quality: LIVE_SCREENCAST.quality,
    onFrame: ({ data, viewportWidth, viewportHeight }) => {
      if (stopped) return;
      try { forward({ data, viewportWidth, viewportHeight }); } catch { /* live view is best-effort */ }
    },
  });
  return async () => {
    if (stopped) return;
    stopped = true;
    await page.screencast.stop().catch(() => {});
  };
}
