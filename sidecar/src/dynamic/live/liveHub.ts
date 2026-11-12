/**
 * In-memory live view hub for Autonomous Dynamic Testing.
 *
 * Frames and action events are held only in memory, per (project, session, lane),
 * and are never written to disk. Every buffer is bounded: a small frame ring per
 * lane, a small action-event ring per lane, a lane cap per session, a session cap
 * per hub and a subscriber cap per session. Retained evidence continues to go
 * through `browser/capture.ts` and is unrelated to this hub.
 */
export type LiveViewport = { width: number; height: number };
export type LiveBox = { x: number; y: number; width: number; height: number };
export type LiveActionPhase = 'move' | 'press' | 'type' | 'done';
/** A cursor event. It never carries typed values: only a length, and only when unmasked. */
export type LiveActionEvent = {
  laneId: string;
  step: number;
  action: string;
  targetLabel: string;
  box: LiveBox | null;
  viewport: LiveViewport;
  phase: LiveActionPhase;
  textLength?: number;
  masked?: boolean;
};
export type LiveFrameInput = { data: Buffer; viewportWidth: number; viewportHeight: number };
export type LiveFrame = LiveFrameInput & { laneId: string; seq: number; capturedAt: string };
/** What the runner writes to. Implementations must not throw into the runner. */
export type LiveSink = {
  frame(frame: LiveFrameInput): void;
  action(event: LiveActionEvent): void;
};
/** Opt-in live instrumentation for one browser lane. Absent means a normal Run. */
export type LiveRunOptions = { laneId: string; headless: true; perStepScreenshots: true; sink: LiveSink };
export type LiveHubMessage =
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'action'; event: LiveActionEvent }
  | { type: 'end' };
export type LiveSubscriber = (message: LiveHubMessage) => void;

export const LIVE_LIMITS = {
  framesPerLane: 2,
  eventsPerLane: 16,
  lanesPerSession: 3,
  sessions: 8,
  subscribersPerSession: 4,
  maxFrameBytes: 1024 * 1024,
} as const;
export type LiveHubLimits = { -readonly [K in keyof typeof LIVE_LIMITS]: number };

/** Fixed-capacity ring; pushing past capacity overwrites the oldest entry. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Ring capacity must be a positive integer.');
    this.items = new Array(capacity);
  }
  push(item: T) {
    const index = (this.start + this.count) % this.capacity;
    this.items[index] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }
  latest(): T | undefined { return this.count ? this.items[(this.start + this.count - 1) % this.capacity] : undefined; }
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.items[(this.start + i) % this.capacity] as T);
    return out;
  }
  get size() { return this.count; }
}

type Lane = { frames: RingBuffer<LiveFrame>; events: RingBuffer<LiveActionEvent>; seq: number };
type Channel = { lanes: Map<string, Lane>; subscribers: Set<LiveSubscriber>; touchedAt: number };

const key = (projectId: string, sessionId: string) => `${projectId}\u0000${sessionId}`;
const validLaneId = (laneId: string) => typeof laneId === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(laneId);

export class LiveSubscriberLimit extends Error {
  constructor() { super('Too many live viewers for this session.'); this.name = 'LiveSubscriberLimit'; }
}

export class LiveHub {
  private readonly channels = new Map<string, Channel>();
  private readonly limits: LiveHubLimits;
  constructor(limits: Partial<LiveHubLimits> = {}, private readonly now: () => number = Date.now) {
    this.limits = { ...LIVE_LIMITS, ...limits };
  }

  private channel(projectId: string, sessionId: string, create: boolean): Channel | undefined {
    const id = key(projectId, sessionId);
    let channel = this.channels.get(id);
    if (!channel && create) {
      if (this.channels.size >= this.limits.sessions) this.evictOldest();
      channel = { lanes: new Map(), subscribers: new Set(), touchedAt: this.now() };
      this.channels.set(id, channel);
    }
    if (channel) channel.touchedAt = this.now();
    return channel;
  }
  private evictOldest() {
    let oldest: [string, Channel] | undefined;
    for (const entry of this.channels) if (!oldest || entry[1].touchedAt < oldest[1].touchedAt) oldest = entry;
    if (!oldest) return;
    this.channels.delete(oldest[0]);
    deliver(oldest[1].subscribers, { type: 'end' });
    oldest[1].subscribers.clear();
  }
  private lane(channel: Channel, laneId: string): Lane | undefined {
    let lane = channel.lanes.get(laneId);
    if (!lane) {
      if (!validLaneId(laneId) || channel.lanes.size >= this.limits.lanesPerSession) return undefined;
      lane = { frames: new RingBuffer(this.limits.framesPerLane), events: new RingBuffer(this.limits.eventsPerLane), seq: 0 };
      channel.lanes.set(laneId, lane);
    }
    return lane;
  }

  publishFrame(projectId: string, sessionId: string, laneId: string, input: LiveFrameInput) {
    if (!Buffer.isBuffer(input.data) || input.data.length === 0 || input.data.length > this.limits.maxFrameBytes) return;
    const channel = this.channel(projectId, sessionId, true)!;
    const lane = this.lane(channel, laneId);
    if (!lane) return;
    const frame: LiveFrame = { laneId, seq: ++lane.seq, capturedAt: new Date(this.now()).toISOString(), data: input.data, viewportWidth: input.viewportWidth, viewportHeight: input.viewportHeight };
    lane.frames.push(frame);
    deliver(channel.subscribers, { type: 'frame', frame });
  }

  publishAction(projectId: string, sessionId: string, event: LiveActionEvent) {
    const channel = this.channel(projectId, sessionId, true)!;
    const lane = this.lane(channel, event.laneId);
    if (!lane) return;
    // Copy an allowlist so an accidental extra property (for example a typed value) never travels.
    const safe: LiveActionEvent = {
      laneId: event.laneId, step: event.step, action: String(event.action).slice(0, 40), targetLabel: String(event.targetLabel ?? '').slice(0, 120),
      box: event.box ? { x: event.box.x, y: event.box.y, width: event.box.width, height: event.box.height } : null,
      viewport: { width: event.viewport.width, height: event.viewport.height }, phase: event.phase,
      ...(event.masked ? { masked: true } : typeof event.textLength === 'number' ? { textLength: event.textLength } : {}),
    };
    lane.events.push(safe);
    deliver(channel.subscribers, { type: 'action', event: safe });
  }

  /** A runner-facing sink bound to one lane. It swallows hub errors so the runner is never affected. */
  sinkFor(projectId: string, sessionId: string, laneId: string): LiveSink {
    return {
      frame: frame => { try { this.publishFrame(projectId, sessionId, laneId, frame); } catch { /* live view is best-effort */ } },
      action: event => { try { this.publishAction(projectId, sessionId, { ...event, laneId }); } catch { /* live view is best-effort */ } },
    };
  }

  /** Replays the latest frame and recent events per lane, then streams. Returns an idempotent unsubscribe. */
  subscribe(projectId: string, sessionId: string, subscriber: LiveSubscriber): () => void {
    const channel = this.channel(projectId, sessionId, true)!;
    if (channel.subscribers.size >= this.limits.subscribersPerSession) throw new LiveSubscriberLimit();
    for (const lane of channel.lanes.values()) {
      const frame = lane.frames.latest();
      if (frame) deliver([subscriber], { type: 'frame', frame });
      for (const event of lane.events.toArray()) deliver([subscriber], { type: 'action', event });
    }
    channel.subscribers.add(subscriber);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      channel.subscribers.delete(subscriber);
      const current = this.channels.get(key(projectId, sessionId));
      if (current === channel && channel.subscribers.size === 0 && channel.lanes.size === 0) this.channels.delete(key(projectId, sessionId));
    };
  }

  /** Ends a session: subscribers receive `end` and all buffered frames are released. */
  close(projectId: string, sessionId: string) {
    const id = key(projectId, sessionId);
    const channel = this.channels.get(id);
    if (!channel) return;
    this.channels.delete(id);
    deliver(channel.subscribers, { type: 'end' });
    channel.subscribers.clear();
  }

  /** Read-only counters for tests and diagnostics; never exposes frame bytes. */
  stats(projectId?: string, sessionId?: string) {
    const channel = projectId !== undefined && sessionId !== undefined ? this.channels.get(key(projectId, sessionId)) : undefined;
    return {
      sessions: this.channels.size,
      subscribers: channel?.subscribers.size ?? 0,
      lanes: channel ? [...channel.lanes.entries()].map(([laneId, lane]) => ({ laneId, frames: lane.frames.size, events: lane.events.size, seq: lane.seq })) : [],
    };
  }
}

function deliver(subscribers: Iterable<LiveSubscriber>, message: LiveHubMessage) {
  for (const subscriber of [...subscribers]) {
    try { subscriber(message); } catch { /* a failing viewer never affects the runner or other viewers */ }
  }
}

/** Process-wide hub used by the sidecar. Tests create their own instances. */
export const liveHub = new LiveHub();
