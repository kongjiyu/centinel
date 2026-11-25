#!/usr/bin/env node
/**
 * Switch this checkout between a local Supabase stack and the hosted project.
 *
 *   pnpm supabase:local     start the local stack (Docker) and point .env at it
 *   pnpm supabase:local:env point .env at an already running local stack
 *   pnpm supabase:hosted    put the hosted values saved earlier back into .env
 *
 * Only the four public Supabase settings in the repository-root .env change
 * (SUPABASE_URL, SUPABASE_ANON_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * The first switch to local saves the previous values in .env.hosted.local
 * (git-ignored). Key values are never printed, and the local service-role key
 * is never written: the desktop runtime must not use one.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const exampleFile = path.join(root, '.env.example');
const hostedBackup = path.join(root, '.env.hosted.local');
const storageVersionFile = path.join(root, 'supabase', '.temp', 'storage-version');
// The storage image the local stack is tested with (docs/SUPABASE_SETUP.md).
const STORAGE_VERSION = 'v1.89.13';
const PUBLIC_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const shell = process.platform === 'win32';

function fail(message) {
  console.error(`[supabase] ${message}`);
  process.exit(1);
}

function supabase(args, options = {}) {
  return spawnSync('supabase', args, { cwd: root, shell, encoding: 'utf8', ...options });
}

function requireCli() {
  const result = supabase(['--version']);
  if (result.error || result.status !== 0) {
    fail('The Supabase CLI was not found. Install it first (see docs/LOCAL_SUPABASE_GUIDE.md, step 1).');
  }
}

function readLines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
}

function valueOf(lines, key) {
  const line = lines.find(item => item.startsWith(`${key}=`));
  return line === undefined ? undefined : line.slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1');
}

/** Replace or append KEY=value lines, keeping every other line as it is. */
function writeValues(file, values) {
  const lines = readLines(file);
  while (lines.length && lines.at(-1) === '') lines.pop();
  let separated = !lines.length;
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex(item => item.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else {
      // One blank line between existing settings and the ones added here.
      if (!separated) { lines.push(''); separated = true; }
      lines.push(`${key}=${value}`);
    }
  }
  fs.writeFileSync(file, `${lines.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
}

function localStatus() {
  const result = supabase(['status', '-o', 'env']);
  if (result.status !== 0) fail('The local Supabase stack is not running. Run "pnpm supabase:local" first.');
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match) values[match[1]] = match[2];
  }
  if (!values.API_URL || !(values.ANON_KEY || values.PUBLISHABLE_KEY)) fail('Could not read the local API URL and anon key from "supabase status".');
  return { url: values.API_URL, anonKey: values.ANON_KEY || values.PUBLISHABLE_KEY };
}

function pointEnvAtLocal() {
  if (!fs.existsSync(envFile)) {
    if (!fs.existsSync(exampleFile)) fail('Neither .env nor .env.example exists in the repository root.');
    fs.copyFileSync(exampleFile, envFile);
    console.log('[supabase] Created .env from .env.example.');
  }
  const { url, anonKey } = localStatus();
  const current = readLines(envFile);
  const isLocal = value => /^https?:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(value ?? '');
  // Save the hosted values once, so "pnpm supabase:hosted" can put them back.
  if (!isLocal(valueOf(current, 'SUPABASE_URL')) && PUBLIC_KEYS.some(key => valueOf(current, key))) {
    writeValues(hostedBackup, Object.fromEntries(PUBLIC_KEYS.map(key => [key, valueOf(current, key) ?? ''])));
    console.log('[supabase] Saved your previous Supabase settings in .env.hosted.local.');
  }
  writeValues(envFile, { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey });
  // The sidecar needs a token-encryption key to save provider settings. Only an empty value is filled in:
  // replacing an existing key would make secrets saved with it unreadable.
  if (!valueOf(readLines(envFile), 'CENTINEL_TOKEN_ENCRYPTION_KEY')) {
    writeValues(envFile, { CENTINEL_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') });
    console.log('[supabase] Generated CENTINEL_TOKEN_ENCRYPTION_KEY for this checkout.');
  }
  console.log(`[supabase] .env now points at the local stack (${url}). Restart "pnpm dev" to use it.`);
  console.log('[supabase] Studio: http://127.0.0.1:54323  ·  Email inbox: http://127.0.0.1:54324');
}

function start() {
  requireCli();
  if (!fs.existsSync(storageVersionFile)) {
    fs.mkdirSync(path.dirname(storageVersionFile), { recursive: true });
    fs.writeFileSync(storageVersionFile, `${STORAGE_VERSION}\n`);
  }
  console.log('[supabase] Starting the local stack (the first start downloads Docker images and applies every migration)…');
  const result = supabase(['start'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) fail('"supabase start" failed. Is Docker Desktop running? See docs/LOCAL_SUPABASE_GUIDE.md, "Problems".');
  pointEnvAtLocal();
}

function hosted() {
  if (!fs.existsSync(hostedBackup)) fail('No saved hosted settings (.env.hosted.local). Put the hosted URL and anon key into .env by hand.');
  const saved = readLines(hostedBackup);
  writeValues(envFile, Object.fromEntries(PUBLIC_KEYS.map(key => [key, valueOf(saved, key) ?? ''])));
  console.log('[supabase] .env points at the hosted project again. Restart "pnpm dev" to use it. The local stack keeps running until "supabase stop".');
}

const command = process.argv[2];
if (command === 'start') start();
else if (command === 'env') { requireCli(); pointEnvAtLocal(); }
else if (command === 'hosted') hosted();
else fail('Use one of: start, env, hosted.');

