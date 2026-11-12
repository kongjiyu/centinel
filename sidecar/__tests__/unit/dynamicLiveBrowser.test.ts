import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { executeBrowserAction } from '../../src/dynamic/browser/actions.js';
import { startLiveScreencast } from '../../src/dynamic/live/screencast.js';
import type { LiveActionEvent, LiveFrameInput } from '../../src/dynamic/live/liveHub.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

const html = `<style>body{margin:0;font:16px sans-serif}#go{position:absolute;left:120px;top:80px;width:160px;height:48px}#name{position:absolute;left:40px;top:200px;width:200px}#pw{position:absolute;left:40px;top:260px;width:200px}</style>
<button id="go" onclick="document.body.dataset.clicked='yes';document.body.style.background='#cde'">Go</button>
<input id="name" aria-label="Name"><input id="pw" type="password" aria-label="Password">`;

describe('Live screencast and action boxes against a real page', () => {
  it('delivers JPEG frames and reports the clicked element box without changing the DOM', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    try {
      await page.setContent(html);
      const domBefore = await page.evaluate(() => document.documentElement.outerHTML);
      const frames: LiveFrameInput[] = []; const events: LiveActionEvent[] = [];
      const stop = await startLiveScreencast(page, { frame: frame => frames.push(frame), action: () => {} });
      const live = { laneId: 'lane-1', step: 0, emit: (event: LiveActionEvent) => events.push(event) };
      const expected = await page.locator('#go').boundingBox();
      // No page-side cursor or overlay may be injected by live instrumentation.
      expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(domBefore);
      await executeBrowserAction(page, { action: 'click', selector: '#go', targetDescription: 'Go button', reasoning: 'Test' }, { live });
      expect(await page.locator('body').getAttribute('data-clicked')).toBe('yes');
      const deadline = Date.now() + 5000;
      while (frames.length === 0 && Date.now() < deadline) await page.waitForTimeout(50);
      await stop(); await stop();
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(events.map(event => event.phase)).toEqual(['move', 'press', 'done']);
      const box = events[0].box!;
      expect(box.x).toBeCloseTo(expected!.x, 0); expect(box.y).toBeCloseTo(expected!.y, 0);
      expect(box.width).toBeCloseTo(expected!.width, 0); expect(box.height).toBeCloseTo(expected!.height, 0);
      expect(events[0]).toMatchObject({ laneId: 'lane-1', step: 0, action: 'click', targetLabel: 'Go button', viewport: { width: 800, height: 600 } });
      const settled = frames.length; await page.waitForTimeout(300);
      expect(frames.length).toBe(settled);
    } finally { await page.close(); }
  });
  it('emits typing events with only a length, and masks private inputs and type_secret', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    try {
      await page.setContent(html);
      const events: LiveActionEvent[] = [];
      const live = (step: number, masked?: boolean) => ({ laneId: 'lane-2', step, masked, emit: (event: LiveActionEvent) => events.push(event) });
      await executeBrowserAction(page, { action: 'type', selector: '#name', targetDescription: 'Name field', text: 'visible-typed-4821', reasoning: 'Test' }, { live: live(0) });
      await executeBrowserAction(page, { action: 'type', selector: '#pw', targetDescription: 'Password field', text: 'hidden-typed-9917', reasoning: 'Test' }, { live: live(1) });
      await executeBrowserAction(page, { action: 'type', selector: '#name', targetDescription: 'Runner-classified private', text: 'runner-private-5530', reasoning: 'Test' }, { live: live(2, true) });
      const policy = { schemaVersion: 1 as const, allowCoordinates: false, interactions: [], privateInputs: [{ selector: '#pw', variable: 'LOGIN_PASSWORD', origin: new URL(page.url()).origin }] };
      await page.locator('#pw').fill('');
      await executeBrowserAction(page, { action: 'type_secret', selector: '#pw', variable: 'LOGIN_PASSWORD', reasoning: 'Test' }, { live: live(3), policy: policy as any, resolvePrivateValue: () => 'secret-value-3371' });
      expect(await page.locator('#pw').inputValue()).toBe('secret-value-3371');
      expect(await page.locator('#name').inputValue()).toBe('runner-private-5530');
      const serialized = JSON.stringify(events);
      for (const value of ['visible-typed-4821', 'hidden-typed-9917', 'runner-private-5530', 'secret-value-3371']) expect(serialized).not.toContain(value);
      const typing = events.filter(event => event.phase === 'type');
      expect(typing.find(event => event.step === 0)).toMatchObject({ textLength: 'visible-typed-4821'.length });
      expect(typing.find(event => event.step === 0)?.masked).toBeUndefined();
      expect(events.filter(event => event.step === 3).map(event => [event.action, event.phase, event.masked])).toEqual([['type_secret', 'move', true], ['type_secret', 'type', true], ['type_secret', 'done', true]]);
      for (const step of [1, 2]) { const row = typing.find(event => event.step === step)!; expect(row.masked).toBe(true); expect('textLength' in row).toBe(false); }
      for (const row of events.filter(event => event.step !== 0)) expect('textLength' in row).toBe(false);
    } finally { await page.close(); }
  });
});
