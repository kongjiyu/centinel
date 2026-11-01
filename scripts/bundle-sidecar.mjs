#!/usr/bin/env node
// Prepares the local service (sidecar) for the packaged desktop app.
//
// Output (both git-ignored, regenerated on every build):
//   centinel/src-tauri/resources/sidecar/   compiled sidecar + production node_modules
//   centinel/src-tauri/binaries/centinel-node-<target-triple>   Node.js runtime
//
// Only the public Supabase URL and publishable key are copied into the
// bundle. Secrets (OAuth client secrets, token-encryption keys, service-role
// keys) are never bundled; each installation creates its own encryption key.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(root, 'centinel/src-tauri');
const out = path.join(tauriDir, 'resources/sidecar');
const binaries = path.join(tauriDir, 'binaries');
const require = createRequire(path.join(root, 'package.json'));

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });
}

function targetTriple() {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = output.split('\n').find(line => line.startsWith('host:'));
  if (!host) throw new Error('Could not determine the Rust target triple.');
  return host.slice('host:'.length).trim();
}

function readPublicRuntimeEnv() {
  const envFile = path.join(root, '.env');
  const values = {};
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const url = process.env.SUPABASE_URL || values.SUPABASE_URL || values.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || values.SUPABASE_ANON_KEY || values.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or their VITE_ equivalents) are required to package the app.');
  if (/service_role/i.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString('utf8'))) {
    throw new Error('Refusing to bundle a Supabase service-role key. Use the publishable (anon) key.');
  }
  return `# Public runtime configuration bundled with Centinel.\nSUPABASE_URL=${url}\nSUPABASE_ANON_KEY=${key}\n`;
}

/** Drop prebuilt native binaries for other platforms and all source maps. */
function pruneForPlatform(dir) {
  const platformTag = `${process.platform}-${process.arch}`;
  let removed = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      const nativeForOtherPlatform = entry.name.endsWith('.node') && /(darwin|linux|win32)-(x64|arm64)/.test(entry.name) && !entry.name.includes(platformTag);
      if (nativeForOtherPlatform || entry.name.endsWith('.map')) {
        removed += fs.statSync(full).size;
        fs.rmSync(full);
      }
    }
  };
  walk(dir);
  console.log(`[bundle-sidecar] Pruned ${(removed / 1024 / 1024).toFixed(0)} MB`);
}

console.log('[bundle-sidecar] Cleaning previous output');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(binaries, { recursive: true });

console.log('[bundle-sidecar] Installing production dependencies');
run('pnpm', ['--filter', '@centinel/sidecar', 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', out]);
for (const entry of ['src', '__tests__', 'fixtures', 'tsconfig.json', 'vitest.config.ts', 'node_modules/.bin', 'package.json']) {
  fs.rmSync(path.join(out, entry), { recursive: true, force: true });
}

console.log('[bundle-sidecar] Removing files other platforms need');
pruneForPlatform(path.join(out, 'node_modules'));

console.log('[bundle-sidecar] Compiling the sidecar');
const esbuild = require('esbuild');
await esbuild.build({
  entryPoints: [path.join(root, 'sidecar/src/index.ts')],
  outfile: path.join(out, 'dist/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
});

// Node resolves the module scope from the nearest package.json. Keep one next
// to the compiled entry so the lookup never climbs out of the app bundle
// (which can trigger macOS privacy prompts for folders like ~/Documents).
fs.writeFileSync(path.join(out, 'dist/package.json'), JSON.stringify({ type: 'module', private: true }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'runtime.env'), readPublicRuntimeEnv(), { mode: 0o644 });

const triple = targetTriple();
const nodeTarget = path.join(binaries, `centinel-node-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
console.log(`[bundle-sidecar] Copying Node.js ${process.version} runtime to ${path.relative(root, nodeTarget)}`);
fs.copyFileSync(process.execPath, nodeTarget);
fs.chmodSync(nodeTarget, 0o755);

console.log('[bundle-sidecar] Done');
