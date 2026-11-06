import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('@tauri-apps/api/updater', () => ({ checkUpdate: vi.fn(), installUpdate: vi.fn(async () => { calls.push('install'); }) }));
vi.mock('@tauri-apps/api/process', () => ({ relaunch: vi.fn(async () => { calls.push('relaunch'); }) }));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn(async (command: string) => { calls.push(command); }) }));

import { installUpdateAndRestart } from './appUpdate';

describe('installUpdateAndRestart', () => {
  it('stops the old local service between installing and restarting', async () => {
    await installUpdateAndRestart();
    expect(calls).toEqual(['install', 'stop_sidecar', 'relaunch']);
  });
});
