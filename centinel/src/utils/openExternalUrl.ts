import { open as openExternal } from '@tauri-apps/api/shell';

/** Opens a provider authorization page outside the Centinel webview. */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await openExternal(url);
    return true;
  } catch {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
    } catch {
      return false;
    }
  }
}
