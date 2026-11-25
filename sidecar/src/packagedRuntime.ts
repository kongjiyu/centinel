import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { config as readEnv } from 'dotenv';
import { centinelHome } from './paths.js';

/**
 * First-run setup for the packaged desktop app (CENTINEL_PACKAGED=1).
 *
 * - Loads the bundled public runtime configuration (Supabase URL and
 *   publishable key). Values in the user's own CENTINEL_HOME/.env win.
 * - Creates a per-installation token-encryption key in CENTINEL_HOME/.env.
 *   The key is generated locally and never shipped with the app.
 * - Downloads Playwright's Chromium in the background if it is missing, so
 *   Dynamic Testing works on a fresh machine.
 */
export function preparePackagedRuntime(log: (message: string) => void = console.log): void {
  if (process.env.CENTINEL_PACKAGED !== '1') return;
  const home = centinelHome();
  fs.mkdirSync(home, { recursive: true });

  const runtimeEnv = process.env.CENTINEL_RUNTIME_ENV?.trim();
  if (runtimeEnv && fs.existsSync(runtimeEnv)) readEnv({ path: runtimeEnv, quiet: true });

  if (!process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim()) {
    const key = crypto.randomBytes(32).toString('hex');
    const envFile = path.join(home, '.env');
    fs.appendFileSync(envFile, `${fs.existsSync(envFile) ? '\n' : ''}CENTINEL_TOKEN_ENCRYPTION_KEY=${key}\n`, { mode: 0o600 });
    fs.chmodSync(envFile, 0o600);
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = key;
    log('[packaged] Created a local token-encryption key for this installation.');
  }

  ensurePlaywrightChromium(log);
}

function ensurePlaywrightChromium(log: (message: string) => void): void {
  const require = createRequire(import.meta.url);
  let executable: string;
  try {
    executable = (require('playwright') as typeof import('playwright')).chromium.executablePath();
  } catch {
    log('[packaged] Playwright is unavailable; Dynamic Testing cannot start a browser.');
    return;
  }
  if (fs.existsSync(executable)) return;
  log('[packaged] Downloading the Chromium browser for Dynamic Testing (first run only)...');
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'ignore', env: process.env });
  child.on('exit', code => log(code === 0
    ? '[packaged] Chromium is ready for Dynamic Testing.'
    : `[packaged] Chromium download failed (exit ${code}). Run "npx playwright install chromium" manually.`));
  child.on('error', () => log('[packaged] Chromium download could not start.'));
}
