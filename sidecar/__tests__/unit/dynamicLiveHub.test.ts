import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { LiveHub, LiveSubscriberLimit, RingBuffer, type LiveHubMessage } from '../../src/dynamic/live/liveHub.js';
import { createLiveSseHandler, serializeLiveMessage } from '../../src/dynamic/live/sse.js';
import { throttleFrames } from '../../src/dynamic/live/screencast.js';

const frame = (n: number) => ({ data: Buffer.from([0xff, 0xd8, n]), viewportWidth: 1280, viewportHeight: 720 });
const event = (laneId: string, step: number) => ({ laneId, step, action: 'click', targetLabel: 'Save', box: { x: 1, y: 2, width: 3, height: 4 }, viewport: { width: 1280, height: 720 }, phase: 'move' as const });

describe('Live hub ring buffers', () => {
  it('keeps a fixed-capacity ring that overwrites the oldest entries', () => {
    const ring = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) ring.push(i);
    expect(ring.size).toBe(3); expect(ring.toArray()).toEqual([8, 9, 10]); expect(ring.latest()).toBe(10);
    expect(() => new RingBuffer(0)).toThrow();
  });
  it('bounds frames, events, lanes and sessions however much is published', () => {
    const hub = new LiveHub({ framesPerLane: 2, eventsPerLane: 4, lanesPerSession: 3, sessions: 2 });
    for (let i = 0; i < 500; i++) { hub.publishFrame('p', 's', `lane-${i % 5}`, frame(i % 256)); hub.publishAction('p', 's', event(`lane-${i % 5}`, i)); }
    const stats = hub.stats('p', 's');
    expect(stats.lanes).toHaveLength(3);
    for (const lane of stats.lanes) { expect(lane.frames).toBe(2); expect(lane.events).toBe(4); }
    hub.publishFrame('p', 'other-1', 'lane-1', frame(1)); hub.publishFrame('p', 'other-2', 'lane-1', frame(2));
    expect(hub.stats().sessions).toBe(2);
    hub.publishFrame('p', 's2', 'lane-1', { ...frame(1), data: Buffer.alloc(2 * 1024 * 1024) });
    expect(hub.stats('p', 's2').lanes).toHaveLength(0);
    hub.publishFrame('p', 's3', '../bad lane', frame(1));
    expect(hub.stats('p', 's3').lanes).toHaveLength(0);
  });
  it('replays the latest frame and recent events to a new subscriber, then unsubscribes cleanly', () => {
    const hub = new LiveHub();
    hub.publishFrame('p', 's', 'lane-1', frame(1)); hub.publishFrame('p', 's', 'lane-1', frame(2)); hub.publishAction('p', 's', event('lane-1', 0));
    const seen: LiveHubMessage[] = [];
    const unsubscribe = hub.subscribe('p', 's', message => seen.push(message));
    expect(seen.map(message => message.type)).toEqual(['frame', 'action']);
    expect(seen[0].type === 'frame' && seen[0].frame.seq).toBe(2);
    hub.publishFrame('p', 's', 'lane-1', frame(3));
    expect(seen).toHaveLength(3); expect(hub.stats('p', 's').subscribers).toBe(1);
    unsubscribe(); unsubscribe();
    expect(hub.stats('p', 's').subscribers).toBe(0);
    hub.publishFrame('p', 's', 'lane-1', frame(4));
    expect(seen).toHaveLength(3);
  });
  it('caps viewers, isolates failing viewers and releases everything on close', () => {
    const hub = new LiveHub({ subscribersPerSession: 2 });
    const good = vi.fn();
    hub.subscribe('p', 's', () => { throw new Error('viewer failed'); }); hub.subscribe('p', 's', good);
    expect(() => hub.subscribe('p', 's', vi.fn())).toThrow(LiveSubscriberLimit);
    hub.sinkFor('p', 's', 'lane-1').frame(frame(1));
    expect(good).toHaveBeenCalledWith(expect.objectContaining({ type: 'frame' }));
    hub.close('p', 's');
    expect(good).toHaveBeenLastCalledWith({ type: 'end' });
    expect(hub.stats().sessions).toBe(0);
  });
  it('copies an allowlist of action fields so typed values can never travel', () => {
    const hub = new LiveHub(); const seen: LiveHubMessage[] = [];
    hub.subscribe('p', 's', message => seen.push(message));
    hub.publishAction('p', 's', { ...event('lane-1', 0), phase: 'type', textLength: 12, text: 'typed-value-77', value: 'typed-value-77' } as any);
    hub.publishAction('p', 's', { ...event('lane-1', 1), phase: 'type', masked: true, textLength: 9 });
    expect(JSON.stringify(seen)).not.toContain('typed-value-77');
    expect(seen[0].type === 'action' && seen[0].event).toMatchObject({ textLength: 12 });
    expect(seen[1].type === 'action' && seen[1].event).toEqual(expect.objectContaining({ masked: true }));
    expect(seen[1].type === 'action' && 'textLength' in seen[1].event).toBe(false);
  });
  it('throttles frames to the requested rate', () => {
    let now = 0; const sink = { frame: vi.fn() };
    const forward = throttleFrames(sink, 8, () => now);
    for (let i = 0; i < 40; i++) { forward(frame(i)); now += 25; }
    expect(sink.frame).toHaveBeenCalledTimes(8);
  });
});

class FakeResponse extends EventEmitter {
  chunks: string[] = []; headers?: Record<string, string>; writableEnded = false; destroyed = false; full = false;
  writeHead(_status: number, headers: Record<string, string>) { this.headers = headers; return this; }
  write(chunk: string) { this.chunks.push(chunk); return !this.full; }
  end() { this.writableEnded = true; }
}
describe('Live SSE helper', () => {
  it('serializes frames as base64 JPEG and actions without extra fields', () => {
    const text = serializeLiveMessage({ type: 'frame', frame: { laneId: 'lane-1', seq: 1, capturedAt: 'now', ...frame(7) } });
    expect(text.startsWith('event: frame\ndata: ')).toBe(true);
    expect(JSON.parse(text.split('data: ')[1])).toMatchObject({ laneId: 'lane-1', mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 7]).toString('base64') });
  });
  it('streams hub events, keeps alive, drops frames under backpressure and cleans up on disconnect', () => {
    vi.useFakeTimers();
    try {
      const hub = new LiveHub(); const req = new EventEmitter(); const res = new FakeResponse();
      createLiveSseHandler({ hub, keepAliveMs: 1000 })(req as any, res as any, { projectId: 'p', sessionId: 's' });
      expect(res.headers?.['Content-Type']).toContain('text/event-stream');
      hub.publishFrame('p', 's', 'lane-1', frame(1));
      expect(res.chunks.some(chunk => chunk.startsWith('event: frame'))).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(res.chunks.at(-1)).toBe(': keep-alive\n\n');
      res.full = true; hub.publishFrame('p', 's', 'lane-1', frame(2)); const count = res.chunks.length;
      hub.publishFrame('p', 's', 'lane-1', frame(3)); hub.publishAction('p', 's', event('lane-1', 0));
      expect(res.chunks.length).toBe(count + 1); expect(res.chunks.at(-1)).toContain('event: action');
      res.full = false; res.emit('drain'); hub.publishFrame('p', 's', 'lane-1', frame(4));
      expect(res.chunks.at(-1)).toContain('event: frame');
      req.emit('close');
      expect(hub.stats('p', 's').subscribers).toBe(0);
      const after = res.chunks.length; vi.advanceTimersByTime(5000); hub.publishFrame('p', 's', 'lane-1', frame(5));
      expect(res.chunks.length).toBe(after);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('ends the stream when the session closes', () => {
    const hub = new LiveHub(); const req = new EventEmitter(); const res = new FakeResponse();
    createLiveSseHandler({ hub })(req as any, res as any, { projectId: 'p', sessionId: 's' });
    hub.close('p', 's');
    expect(res.chunks.at(-1)).toContain('event: end'); expect(res.writableEnded).toBe(true);
  });
});
