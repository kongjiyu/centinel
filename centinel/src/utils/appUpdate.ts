import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { invoke } from '@tauri-apps/api/tauri';

export type AppUpdate = { version: string; notes: string | null };

/** True only inside the Tauri desktop shell; browser previews and tests have no updater. */
export function hasDesktopUpdater(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

/**
 * Asks the Tauri updater whether a newer signed release is published
 * (latest.json on GitHub Releases). Returns null when Centinel is current,
 * the updater is unavailable, or the check fails; it never installs anything.
 */
export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!hasDesktopUpdater()) return null;
  try {
    const result = await checkUpdate();
    if (!result.shouldUpdate || !result.manifest) return null;
    return { version: result.manifest.version.replace(/^v/i, ''), notes: result.manifest.body?.trim() || null };
  } catch {
    return null;
  }
}

/**
 * Downloads and verifies the signed update, replaces the app, then restarts it.
 * The local service is stopped first: the restart skips the normal exit
 * handling, and the new version must start its own service, not reuse the old one.
 */
export async function installUpdateAndRestart(): Promise<void> {
  await installUpdate();
  try { await invoke('stop_sidecar'); } catch { /* Development builds use an external service. */ }
  await relaunch();
}
