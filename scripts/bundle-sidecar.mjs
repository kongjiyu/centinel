#!/usr/bin/env node
// Prepares the local service (sidecar) for the packaged desktop app.
//
// Output (all git-ignored, regenerated on every build):
//   centinel/src-tauri/resources/sidecar/   compiled sidecar + production node_modules
//   centinel/src-tauri/resources/sample-shop/   practice app (not its answer key)
//   centinel/src-tauri/resources/codex/   Codex CLI LICENSE and NOTICE
//   centinel/src-tauri/binaries/centinel-node-<target-triple>   Node.js runtime
//   centinel/src-tauri/binaries/codex-<target-triple>   pinned, hash-verified official Codex CLI
//
// Only the public Supabase URL and publishable key are copied into the
// bundle. Secrets (OAuth client secrets, token-encryption keys, service-role
// keys) are never bundled; each installation creates its own encryption key.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

/**
 * Tauri signs the app and its Node runtime but not Mach-O files inside
 * resources. Notarization rejects any unsigned binary, so sign the bundled
 * native modules with the same Developer ID and the hardened runtime.
 */
function signNativeModules(dir, identity) {
  const signed = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(node|dylib)$/.test(entry.name)) continue;
      run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, full], { stdio: 'pipe' });
      signed.push(path.relative(dir, full));
    }
  };
  walk(dir);
  console.log(`[bundle-sidecar] Signed ${signed.length} native module(s): ${signed.join(', ') || 'none'}`);
}

/**
 * The official Codex CLI (Apache-2.0, github.com/openai/codex) lets users sign
 * in with their ChatGPT plan without installing anything else. The release and
 * every file's SHA-256 are pinned here; a mismatch stops the build.
 */
const CODEX_VERSION = '0.166.0';
const CODEX_RELEASE = `https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}`;
const CODEX_ASSETS = {
  'aarch64-apple-darwin': { name: 'codex-aarch64-apple-darwin.tar.gz', sha256: 'c48824462fc57681eafb0925d97b11b589010475613904f570b42fea53e240d5' },
  'x86_64-apple-darwin': { name: 'codex-x86_64-apple-darwin.tar.gz', sha256: 'db0c38713c36199b12e7c8d1629386c35a4ce8f99e1c9ce72f1725a74df67b57' },
};
const CODEX_LICENSE_FILES = {
  LICENSE: 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc',
  NOTICE: '9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Download once into a cache, then trust the file only if its hash matches. */
async function fetchPinned(url, file, expected) {
  if (fs.existsSync(file) && sha256(file) === expected) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  console.log(`[bundle-sidecar] Downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${file}.partial`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
  const actual = sha256(partial);
  if (actual !== expected) {
    fs.rmSync(partial, { force: true });
    throw new Error(`SHA-256 mismatch for ${url}: expected ${expected}, got ${actual}. Refusing to bundle it.`);
  }
  fs.renameSync(partial, file);
  return file;
}

async function bundleCodex(triple) {
  const asset = CODEX_ASSETS[triple];
  if (!asset) {
    console.warn(`[bundle-sidecar] No pinned Codex CLI for ${triple}; the app will use a Codex CLI on PATH.`);
    return;
  }
  const cache = path.join(binaries, '.codex-cache', CODEX_VERSION);
  const archive = await fetchPinned(`${CODEX_RELEASE}/${asset.name}`, path.join(cache, asset.name), asset.sha256);
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-codex-'));
  try {
    run('tar', ['-xzf', archive, '-C', extracted]);
    const binary = path.join(extracted, asset.name.replace(/\.tar\.gz$/, ''));
    if (!fs.existsSync(binary)) throw new Error(`The Codex archive did not contain ${path.basename(binary)}.`);
    const target = path.join(binaries, `codex-${triple}`);
    fs.copyFileSync(binary, target);
    fs.chmodSync(target, 0o755);
    console.log(`[bundle-sidecar] Bundled Codex CLI ${CODEX_VERSION} as ${path.relative(root, target)}`);
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
  const licenseDir = path.join(tauriDir, 'resources/codex');
  fs.rmSync(licenseDir, { recursive: true, force: true });
  fs.mkdirSync(licenseDir, { recursive: true });
  for (const [name, expected] of Object.entries(CODEX_LICENSE_FILES)) {
    const cached = await fetchPinned(`https://raw.githubusercontent.com/openai/codex/rust-v${CODEX_VERSION}/${name}`, path.join(cache, name), expected);
    fs.copyFileSync(cached, path.join(licenseDir, name));
  }
  fs.writeFileSync(path.join(licenseDir, 'README.txt'), `Centinel bundles the unmodified OpenAI Codex CLI ${CODEX_VERSION}\nfrom ${CODEX_RELEASE}/${asset.name}\nunder the Apache License 2.0 (LICENSE, NOTICE).\n`);
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

const signingIdentity = process.platform === 'darwin' ? process.env.APPLE_SIGNING_IDENTITY?.trim() : '';
if (signingIdentity) signNativeModules(path.join(out, 'node_modules'), signingIdentity);

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

console.log('[bundle-sidecar] Copying the Sample Shop');
const sampleOut = path.join(tauriDir, 'resources/sample-shop');
fs.rmSync(sampleOut, { recursive: true, force: true });
// Only the practice app itself; the answer key stays outside so Reviews never read it.
fs.cpSync(path.join(root, 'examples/sample-shop'), sampleOut, {
  recursive: true,
  filter: source => !/(^|[\\/])(node_modules|\.git|\.DS_Store)$/.test(source),
});

await bundleCodex(triple);

const nodeTarget = path.join(binaries, `centinel-node-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
console.log(`[bundle-sidecar] Copying Node.js ${process.version} runtime to ${path.relative(root, nodeTarget)}`);
fs.copyFileSync(process.execPath, nodeTarget);
fs.chmodSync(nodeTarget, 0o755);

console.log('[bundle-sidecar] Done');
