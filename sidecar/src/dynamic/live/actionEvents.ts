import type { Locator, Page } from 'playwright';
import type { LiveActionEvent, LiveBox, LiveViewport } from './liveHub.js';

/** Per-action live context supplied by the runner only when live instrumentation is on. */
export type LiveActionContext = {
  laneId: string;
  step: number;
  emit(event: LiveActionEvent): void;
  /** The runner already classified this typing target as private. */
  masked?: boolean;
};

const PRIVATE_TARGET = 'input[type="password"],input[type="file"],[autocomplete="current-password"],[autocomplete="new-password"],[autocomplete^="cc-"],[data-centinel-sensitive]';
const noop = () => {};
const round = (value: number) => Math.round(value * 10) / 10;

/** Read-only geometry; failures yield null so the cursor simply does not move. */
export async function liveTargetBox(target: Locator): Promise<LiveBox | null> {
  try {
    const box = await target.boundingBox({ timeout: 1000 });
    return box ? { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) } : null;
  } catch { return null; }
}

async function liveViewport(page: Page): Promise<LiveViewport> {
  const size = page.viewportSize();
  if (size) return { width: size.width, height: size.height };
  try { return await page.evaluate(() => ({ width: innerWidth, height: innerHeight })); } catch { return { width: 0, height: 0 }; }
}

async function privateTarget(target: Locator): Promise<boolean> {
  try { return await target.evaluate((element, selector) => !!element.closest(selector), PRIVATE_TARGET); } catch { return true; }
}

/**
 * Emits `move` then `press`/`type` before one dispatch, and returns a function that emits
 * `done` afterwards. Typing events carry only a length, or only `masked` for private targets;
 * the typed value is never accepted by this function. Does nothing without a live context.
 */
export async function beginLiveAction(page: Page, live: LiveActionContext | undefined, input: {
  action: string;
  label: string;
  target?: Locator;
  point?: { x: number; y: number };
  typing?: { length: number; masked?: boolean };
}): Promise<() => void> {
  if (!live) return noop;
  try {
    const box = input.target ? await liveTargetBox(input.target) : input.point ? { x: input.point.x, y: input.point.y, width: 1, height: 1 } : null;
    const viewport = await liveViewport(page);
    const masked = live.masked === true || input.typing?.masked === true || (!!input.typing && !!input.target && await privateTarget(input.target));
    const base = { laneId: live.laneId, step: live.step, action: input.action, targetLabel: input.label.slice(0, 120), box, viewport };
    const extra = masked ? { masked: true } : {};
    const emit = (event: LiveActionEvent) => { try { live.emit(event); } catch { /* live view is best-effort */ } };
    emit({ ...base, phase: 'move', ...extra });
    if (input.typing) emit({ ...base, phase: 'type', ...(masked ? { masked: true } : { textLength: input.typing.length }) });
    else emit({ ...base, phase: 'press', ...extra });
    let finished = false;
    return () => { if (finished) return; finished = true; emit({ ...base, phase: 'done', ...extra }); };
  } catch { return noop; }
}

export function liveBindingLabel(binding: string | { role: string; name: string } | undefined, fallback: string) {
  if (!binding) return fallback;
  return typeof binding === 'string' ? binding : `${binding.role} ${binding.name}`;
}
