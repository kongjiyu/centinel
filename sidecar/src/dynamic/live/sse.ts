import type { IncomingMessage, ServerResponse } from 'node:http';
import { liveHub as defaultHub, LiveSubscriberLimit, type LiveHub, type LiveHubMessage } from './liveHub.js';

export type LiveSseOptions = { hub?: LiveHub; keepAliveMs?: number };
export type LiveSseHandler = (req: IncomingMessage, res: ServerResponse, scope: { projectId: string; sessionId: string }) => void;

/** One SSE record. Frames are base64 JPEG; action events carry no typed values. */
export function serializeLiveMessage(message: LiveHubMessage): string {
  if (message.type === 'frame') {
    const { frame } = message;
    return `event: frame\ndata: ${JSON.stringify({ laneId: frame.laneId, seq: frame.seq, capturedAt: frame.capturedAt, viewport: { width: frame.viewportWidth, height: frame.viewportHeight }, mimeType: 'image/jpeg', data: frame.data.toString('base64') })}\n\n`;
  }
  if (message.type === 'action') return `event: action\ndata: ${JSON.stringify(message.event)}\n\n`;
  return 'event: end\ndata: {}\n\n';
}

/**
 * SSE handler factory for the live view. The caller must already have authenticated the
 * user and authorised `(projectId, sessionId)`; this helper performs no access checks.
 * Under backpressure it drops frames (never action events) until the socket drains, and it
 * unsubscribes and clears its keep-alive when the client disconnects.
 */
export function createLiveSseHandler(options: LiveSseOptions = {}): LiveSseHandler {
  const hub = options.hub ?? defaultHub;
  const keepAliveMs = options.keepAliveMs ?? 15_000;
  return (req, res, { projectId, sessionId }) => {
    let closed = false;
    let congested = false;
    let unsubscribe: (() => void) | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe?.();
      req.off('close', cleanup);
      res.off('close', cleanup);
      res.off('drain', onDrain);
    };
    const onDrain = () => { congested = false; };
    const write = (chunk: string) => {
      if (closed || res.writableEnded || res.destroyed) return;
      if (!res.write(chunk)) congested = true;
    };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('drain', onDrain);
    write('retry: 2000\n\n');
    try {
      unsubscribe = hub.subscribe(projectId, sessionId, message => {
        if (message.type === 'frame' && congested) return;
        write(serializeLiveMessage(message));
        if (message.type === 'end') { cleanup(); res.end(); }
      });
    } catch (error) {
      write(`event: error\ndata: ${JSON.stringify({ reason: error instanceof LiveSubscriberLimit ? 'too_many_viewers' : 'unavailable' })}\n\n`);
      cleanup();
      res.end();
      return;
    }
    if (closed) return;
    keepAlive = setInterval(() => write(': keep-alive\n\n'), keepAliveMs);
    keepAlive.unref?.();
  };
}
