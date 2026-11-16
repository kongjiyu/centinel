import fs from 'node:fs';

/** Windows hosts without Developer Mode or the link privilege cannot create file symlinks. */
export function tryFileSymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return false;
    throw error;
  }
}
