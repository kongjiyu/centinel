import { getVersion } from '@tauri-apps/api/app';
import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile } from '@tauri-apps/api/fs';
import { api } from '../api/client';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function';
}

export type DiagnosticsSaveResult = { outcome: 'saved'; path: string } | { outcome: 'downloaded'; filename: string } | { outcome: 'cancelled' };

/** Builds the local diagnostics ZIP and lets the user choose where it goes. */
export async function exportAndSaveDiagnostics(): Promise<DiagnosticsSaveResult> {
  const tauri = isTauriRuntime();
  const appVersion = tauri ? await getVersion().catch(() => null) : null;
  const file = await api.exportDiagnostics(appVersion);
  if (tauri) {
    const destination = await save({ defaultPath: file.filename, title: 'Save diagnostics', filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
    if (!destination) return { outcome: 'cancelled' };
    await writeBinaryFile(destination, file.bytes);
    return { outcome: 'saved', path: destination };
  }
  const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { outcome: 'downloaded', filename: file.filename };
}
