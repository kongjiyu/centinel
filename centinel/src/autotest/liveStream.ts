import { SIDECAR_BASE_URL } from '../api/transport';
import type { LiveActionEvent, LiveFrameEvent } from './types';

export type LiveMessage = { type: 'frame'; frame: LiveFrameEvent } | { type: 'action'; event: LiveActionEvent } | { type: 'end' };

/** Parse complete SSE records from a buffer; returns the unparsed remainder. */
export function parseSseChunk(buffer: string, onMessage: (message: LiveMessage) => void): string {
  const records = buffer.split(/\r?\n\r?\n/);
  const rest = records.pop() ?? '';
  for (const record of records) {
    let event = 'message';
    const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    try {
      const value = JSON.parse(data.join('\n'));
      if (event === 'frame') onMessage({ type: 'frame', frame: value as LiveFrameEvent });
      else if (event === 'action') onMessage({ type: 'action', event: value as LiveActionEvent });
      else if (event === 'end') onMessage({ type: 'end' });
    } catch { /* ignore a malformed record */ }
  }
  return rest;
}

/**
 * Opens the authenticated live view. EventSource cannot send the bearer token, so this
 * reads the SSE stream with fetch. Reconnects with backoff until `signal` aborts.
 */
export function openLiveStream(projectId: string, sessionId: string, onMessage: (message: LiveMessage) => void, signal: AbortSignal, onState?: (connected: boolean) => void): void {
  let delay = 1000;
  const connect = async () => {
    while (!signal.aborted) {
      try {
        const token = sessionStorage.getItem('centinel:supabase-access-token');
        const userId = sessionStorage.getItem('centinel:supabase-user-id');
        const response = await fetch(`${SIDECAR_BASE_URL}/projects/${projectId}/dynamic/autonomous/${sessionId}/live`, {
          headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(userId ? { 'X-Centinel-User-Id': userId } : {}) },
          signal, cache: 'no-store',
        });
        if (!response.ok || !response.body) throw new Error(`Live view unavailable (${response.status})`);
        onState?.(true);
        delay = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let ended = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), message => {
            if (message.type === 'end') ended = true;
            onMessage(message);
          });
        }
        onState?.(false);
        if (ended) return;
      } catch {
        onState?.(false);
        if (signal.aborted) return;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8000);
    }
  };
  void connect();
}
