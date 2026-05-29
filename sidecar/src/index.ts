#!/usr/bin/env node

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { minimaxSmokeAsync } from './minimaxSmoke';
import { playwrightSmoke } from './playwrightSmoke';
import { geminiSmoke } from './geminiSmoke';
import { sqliteSmoke } from './sqliteSmoke';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(__dirname, '../../evidence/phase-0');
const dataDir = path.resolve(__dirname, '../../data');

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

type SmokeResults = {
  sqlite: string;
  minimax: string;
  playwright: string;
  gemini: string;
  artifacts: Record<string, string>;
};

async function runSmokeChecks(): Promise<SmokeResults> {
  const results: SmokeResults = {
    sqlite: 'pending',
    minimax: 'pending',
    playwright: 'pending',
    gemini: 'pending',
    artifacts: {},
  };

  try {
    const r0 = await sqliteSmoke();
    results.sqlite = r0.status;
  } catch (e) {
    results.sqlite = `fail: ${e}`;
  }

  try {
    const r1 = await playwrightSmoke();
    results.playwright = r1.status;
    if (r1.screenshotPath) {
      results.artifacts.screenshot = r1.screenshotPath;
    }
  } catch (e) {
    results.playwright = `fail: ${e}`;
  }

  try {
    const r2 = await minimaxSmokeAsync();
    results.minimax = r2.status;
    if (r2.raw) {
      const fp = path.join(evidenceDir, 'minimax-response.json');
      fs.writeFileSync(fp, r2.raw);
    }
  } catch (e) {
    results.minimax = `fail: ${e}`;
  }

  try {
    const r3 = await geminiSmoke();
    results.gemini = r3.status;
    if (r3.raw) {
      const fp = path.join(evidenceDir, 'gemini-response.json');
      fs.writeFileSync(fp, r3.raw);
    }
  } catch (e) {
    results.gemini = `fail: ${e}`;
  }

  return results;
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const PORT = 37701;
const HOST = 'localhost';

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/smoke') {
    try {
      await parseJsonBody(req); // consume body
    } catch {
      // ignore malformed body for smoke
    }
    try {
      const results = await runSmokeChecks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(Number(PORT), HOST, () => {
  console.error(`[server] Centinel sidecar listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
