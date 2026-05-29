#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config as readEnv } from 'dotenv';
import { minimaxSmokeAsync } from './minimaxSmoke';
import { playwrightSmoke } from './playwrightSmoke';
import { geminiSmoke } from './geminiSmoke';
import { sqliteSmoke } from './sqliteSmoke';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
readEnv({ path: path.resolve(__dirname, '../../.env') });

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

async function main(): Promise<SmokeResults> {
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
    console.error('[sqlite]', JSON.stringify(r0));
  } catch (e) {
    results.sqlite = `fail: ${e}`;
    console.error('[sqlite] uncaught', e);
  }

  try {
    const r1 = await playwrightSmoke();
    results.playwright = r1.status;
    if (r1.screenshotPath) {
      results.artifacts.screenshot = r1.screenshotPath;
    }
    console.error('[playwright]', JSON.stringify(r1));
  } catch (e) {
    results.playwright = `fail: ${e}`;
    console.error('[playwright] uncaught', e);
  }

  try {
    const r2 = await minimaxSmokeAsync();
    results.minimax = r2.status;
    if (r2.raw) {
      const fp = path.join(evidenceDir, 'minimax-response.json');
      fs.writeFileSync(fp, r2.raw);
    }
    console.error('[minimax]', JSON.stringify(r2));
  } catch (e) {
    results.minimax = `fail: ${e}`;
    console.error('[minimax] uncaught', e);
  }

  try {
    const r3 = await geminiSmoke();
    results.gemini = r3.status;
    if (r3.raw) {
      const fp = path.join(evidenceDir, 'gemini-response.json');
      fs.writeFileSync(fp, r3.raw);
    }
    console.error('[gemini]', JSON.stringify(r3));
  } catch (e) {
    results.gemini = `fail: ${e}`;
    console.error('[gemini] uncaught', e);
  }

  return results;
}

main()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(e => {
    console.error('[fatal]', e);
    process.exit(1);
  });
