import { randomUUID } from 'node:crypto';
import { link, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { AuthGateway } from '../auth/gateway.js';
import { getSupabaseAnonKey } from '../config.js';
import { centinelHome } from '../paths.js';
import { createSupabaseClient } from '../supabase.js';
import { exportOwnerWorkspace, readOnlyMigrationFetch } from './exportWorkspace.js';

const [project, destination, ...extra] = process.argv.slice(2);
if (!project || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(project)
  || !destination || !isAbsolute(destination) || extra.length) {
  throw new Error('Usage: pnpm --filter @centinel/sidecar migrate:export <project UUID> <new absolute archive JSON path>.');
}
loadEnv({ path: join(centinelHome(), '.env'), quiet: true });
const token = process.env.CENTINEL_MIGRATION_ACCESS_TOKEN?.trim();
delete process.env.CENTINEL_MIGRATION_ACCESS_TOKEN;
if (!token) throw new Error('Supply a short-lived account token in CENTINEL_MIGRATION_ACCESS_TOKEN.');
const apiKey = getSupabaseAnonKey();
if (apiKey?.startsWith('sb_secret_') || isServiceRole(apiKey)) {
  throw new Error('Migration requires the public Supabase API key and an authenticated owner session.');
}
const gateway = new AuthGateway({ clientFactory: value => createSupabaseClient(value, { fetchImpl: readOnlyMigrationFetch() }) });
const auth = await gateway.authenticate({ authorization: `Bearer ${token}` });
const archive = await exportOwnerWorkspace(auth, project);
// Publish only a complete archive and reject an existing destination atomically.
const partial = destination + '.' + randomUUID() + '.partial';
try {
  await writeFile(partial, JSON.stringify(archive), { mode: 0o600, flag: 'wx' });
  await link(partial, destination);
} finally {
  await rm(partial, { force: true });
}
console.log(JSON.stringify(archive.exportReceipt));

function isServiceRole(key: string | null): boolean {
  try {
    return JSON.parse(Buffer.from(key?.split('.')[1] ?? '', 'base64url').toString()).role === 'service_role';
  } catch { return false; }
}
