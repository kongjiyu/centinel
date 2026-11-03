#!/usr/bin/env node
// Builds a signed and notarized macOS disk image for distribution.
//
//   pnpm release:mac
//
// Requirements (one-time, on the release machine):
//   - A "Developer ID Application" certificate in the login keychain.
//   - Notarization credentials stored in the keychain:
//       xcrun notarytool store-credentials centinel-notary --apple-id <email> --team-id <TEAMID>
//
// Optional environment:
//   APPLE_SIGNING_IDENTITY  Signing identity (default: the first Developer ID Application identity)
//   NOTARY_PROFILE          notarytool keychain profile (default: centinel-notary)
//
// No credentials are read or written by this script; notarytool reads them from the keychain.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(root, 'centinel/src-tauri');
const version = JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8')).package.version;
const app = path.join(tauriDir, 'target/release/bundle/macos/Centinel.app');
const outDir = path.join(root, 'dist/release');
const dmg = path.join(outDir, `Centinel_${version}_${process.arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`);
const profile = process.env.NOTARY_PROFILE?.trim() || 'centinel-notary';

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function step(message) {
  console.log(`\n[release-macos] ${message}`);
}

function signingIdentity() {
  const configured = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (configured) return configured;
  const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning']);
  const match = identities.match(/"(Developer ID Application: [^"]+)"/);
  if (!match) throw new Error('No "Developer ID Application" certificate found in the keychain. Create one at developer.apple.com and install it.');
  return match[1];
}

if (process.platform !== 'darwin') throw new Error('release:mac must run on macOS.');

const identity = signingIdentity();
step(`Signing as ${identity}`);
step(`Checking the notarization profile "${profile}"`);
capture('xcrun', ['notarytool', 'history', '--keychain-profile', profile]);

const env = { ...process.env, APPLE_SIGNING_IDENTITY: identity };
step('Building the sidecar and the signed app');
run('node', ['scripts/bundle-sidecar.mjs'], { env });
run('pnpm', ['tauri', 'build', '--bundles', 'app'], { cwd: path.join(root, 'centinel'), env });

step('Verifying the app signature');
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);

step('Creating the disk image');
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(dmg, { force: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-dmg-'));
try {
  run('ditto', [app, path.join(staging, 'Centinel.app')]);
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
  run('hdiutil', ['create', '-volname', 'Centinel', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg], { stdio: 'pipe' });
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
run('codesign', ['--force', '--timestamp', '--sign', identity, dmg]);

step('Submitting to Apple for notarization (usually a few minutes)');
const result = JSON.parse(capture('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait', '--output-format', 'json']));
console.log(`[release-macos] Notarization ${result.status} (submission ${result.id})`);
if (result.status !== 'Accepted') {
  console.error(capture('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile]));
  throw new Error('Notarization was not accepted. The log above lists the files Apple rejected.');
}

step('Stapling the notarization ticket');
run('xcrun', ['stapler', 'staple', dmg]);
run('xcrun', ['stapler', 'validate', dmg]);

step('Checking Gatekeeper');
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);

console.log(`\n[release-macos] Ready: ${path.relative(root, dmg)}`);
