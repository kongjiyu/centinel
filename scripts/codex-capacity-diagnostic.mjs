// Explicit read-only diagnostic. No inference, credit purchases or quota resets.
// Run with pnpm --filter @centinel/sidecar exec tsx ../scripts/codex-capacity-diagnostic.mjs <managed-home>
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from '../sidecar/src/model/codex.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homes = await fs.realpath(path.join(root, 'data/codex'));
const home = await fs.realpath(process.argv[2] ?? '');
if (path.dirname(home).toLowerCase() !== homes.toLowerCase()) throw new Error('Specify an existing Centinel-managed home under data/codex.');
const client = new CodexAppServer(home);
try {
  const status = await client.status();
  const report = { checkedAt: new Date().toISOString(), connected: status.connected,
    buckets: status.connected ? await client.capacity() : [], modelRequests: 0 };
  const directory = path.join(root, 'evidence/provider-pause-2026-10-20');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'capacity-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  console.log(JSON.stringify({ capacityRead: 'unavailable', modelRequests: 0 }));
  process.exitCode = 1;
} finally { client.close(); }
