/**
 * Uploaded files are stored as uploads/<uuid>-<original name>. Show the original
 * name; the stored path stays the evidence identity everywhere else.
 */
const UPLOAD_PATH = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;

export function displayPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.match(UPLOAD_PATH)?.[1] ?? path;
}
