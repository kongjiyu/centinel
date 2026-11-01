import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Writable root for local runtime files (`.env`, `data/`, `evidence/`).
 *
 * In development this is the repository root. The packaged desktop app runs
 * the sidecar from read-only app resources, so it sets CENTINEL_HOME to the
 * user's application-support directory instead.
 */
export function centinelHome(): string {
  const configured = process.env.CENTINEL_HOME?.trim();
  return configured ? path.resolve(configured) : path.resolve(moduleDir, '../..');
}
