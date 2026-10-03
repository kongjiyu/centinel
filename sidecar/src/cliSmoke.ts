#!/usr/bin/env node

import { playwrightSmoke } from './playwrightSmoke';
import { sqliteSmoke } from './sqliteSmoke';

type SmokeResults = {
  sqlite: string;
  playwright: string;
  artifacts: Record<string, string>;
};

async function main(): Promise<SmokeResults> {
  const results: SmokeResults = {
    sqlite: 'pending',
    playwright: 'pending',
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
