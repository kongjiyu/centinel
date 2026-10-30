import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? '37813');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Pass a valid local recorder port.');

const directory = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'evidence/repository-index-evaluation-2026-10-26', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(directory, { recursive: true });
let sequence = 0;
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin !== 'http://localhost:1420') { response.writeHead(403).end(); return; }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (request.method !== 'POST' || request.url !== '/event' || !request.headers['content-type']?.startsWith('application/json')) { response.writeHead(404).end(); return; }
  try {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 32 * 1024 * 1024) throw Error('Evaluation event exceeds limit.');
      chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value.kind !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.kind)) throw Error('Invalid event kind.');
    const filename = `${String(++sequence).padStart(4, '0')}-${value.kind}.json`;
    await fs.writeFile(path.join(directory, filename), JSON.stringify({ recordedAt: new Date().toISOString(), ...value }, null, 2), { flag: 'wx' });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ saved: filename }));
  } catch { response.writeHead(400).end('Evaluation event could not be saved.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Evaluation recorder (${port}): ${directory}`));
process.once('SIGINT', () => server.close());
