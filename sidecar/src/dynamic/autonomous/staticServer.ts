import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ManagedServer } from '../workspace/managedServer.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
/** Never serve these even when they sit in the folder. */
const PRIVATE = /(^|\/)(\.env[^/]*|\.git(\/|$)|node_modules(\/|$)|.*\.(pem|key|p12|sqlite3?|db)$)/i;

/** Serves a plain HTML folder in-process, confined to the folder (no symlink escape). */
export function startStaticServer(folder: string, port: number): Promise<ManagedServer> {
  const root = fs.realpathSync(folder);
  let log = '';
  const server = http.createServer((request, response) => {
    let relative: string;
    try {
      relative = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (PRIVATE.test(relative)) { response.writeHead(404).end('Not found'); return; }
    let file = path.join(root, relative);
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const real = fs.realpathSync(file);
      if (real !== root && !real.startsWith(root + path.sep)) throw new Error('outside');
      const body = fs.readFileSync(real);
      response.writeHead(200, { 'content-type': TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
      log = (log + `${request.method} /${relative} 200\n`).slice(-16384);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      log = (log + `${request.method} /${relative} 404\n`).slice(-16384);
    }
  });
  let resolveExit: (value: { exitCode: number | null; signal: string | null }) => void = () => undefined;
  const exited = new Promise<{ exitCode: number | null; signal: string | null }>(resolve => { resolveExit = resolve; });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      let stopped: Promise<void> | null = null;
      resolve({
        url: `http://localhost:${port}`, port, portHonored: true, pid: process.pid,
        logs: () => log,
        stop: () => stopped ??= new Promise<void>(done => { server.closeAllConnections(); server.close(() => { resolveExit({ exitCode: 0, signal: null }); done(); }); }),
        exited,
      });
    });
  });
}
