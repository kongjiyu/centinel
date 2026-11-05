#!/usr/bin/env node
// Builds a signed and notarized macOS disk image for distribution.
//
//   pnpm release:mac                                  # this Mac's architecture
//   pnpm release:mac --target x86_64-apple-darwin     # Intel build on Apple silicon
//   pnpm release:mac --target aarch64-apple-darwin
//
// Build each architecture in turn; latest.json keeps the entries for both.
//
// Requirements (one-time, on the release machine):
//   - A "Developer ID Application" certificate in the login keychain.
//   - Notarization credentials stored in the keychain:
//       xcrun notarytool store-credentials centinel-notary --apple-id <email> --team-id <TEAMID>
//
//   - An updater signing key pair, generated once with
//       pnpm tauri signer generate -w ~/.tauri/centinel.key
//     The public key goes in tauri.conf.json (updater.pubkey); the private key
//     never enters the repository.
//
// Required environment (from your shell, never stored in the repository):
//   TAURI_PRIVATE_KEY       Updater private key, or the path to it (e.g. ~/.tauri/centinel.key)
//   TAURI_KEY_PASSWORD      Its password (empty if the key has none)
//
// Optional environment:
//   APPLE_SIGNING_IDENTITY  Signing identity (default: the first Developer ID Application identity)
//   NOTARY_PROFILE          notarytool keychain profile (default: centinel-notary)
//   RELEASE_NOTES           Text for latest.json "notes" (default: a link to the release page)
//
// Outputs in dist/release/, per architecture: the notarized DMG,
// Centinel_<arch>.app.tar.gz (the stapled app for in-app updates) and its
// .sig, plus one latest.json covering every architecture built for this
// version. Upload them all to the GitHub release tagged v<version>; the app
// reads releases/latest/download/latest.json.
//
// notarytool reads its credentials from the keychain; this script never prints
// or stores any key or password.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(root, 'centinel/src-tauri');
const version = JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8')).package.version;
const hostTriple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
const targetIndex = process.argv.indexOf('--target');
const triple = targetIndex >= 0 ? process.argv[targetIndex + 1] : hostTriple;
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(triple)) throw new Error(`Unsupported target ${triple}. Use aarch64-apple-darwin or x86_64-apple-darwin.`);
const crossBuild = targetIndex >= 0;
const archLabel = triple.startsWith('aarch64') ? 'aarch64' : 'x64';
const app = path.join(tauriDir, crossBuild ? `target/${triple}/release/bundle/macos/Centinel.app` : 'target/release/bundle/macos/Centinel.app');
const outDir = path.join(root, 'dist/release');
const dmg = path.join(outDir, `Centinel_${version}_${archLabel}.dmg`);
const profile = process.env.NOTARY_PROFILE?.trim() || 'centinel-notary';
const updaterArchive = path.join(outDir, `Centinel_${archLabel}.app.tar.gz`);
const updaterManifest = path.join(outDir, 'latest.json');
const releaseUrl = `https://github.com/kongjiyu/centinel/releases/download/v${version}`;
const codex = path.join(app, 'Contents/MacOS/codex');
const updaterPlatform = archLabel === 'aarch64' ? 'darwin-aarch64' : 'darwin-x86_64';

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

/** The updater key comes only from the environment: key text, or a path to the key file. */
function updaterKeyEnv() {
  const value = process.env.TAURI_PRIVATE_KEY?.trim();
  if (!value) throw new Error('TAURI_PRIVATE_KEY is not set. Export the updater private key (or its path, e.g. ~/.tauri/centinel.key) before releasing.');
  if (process.env.TAURI_KEY_PASSWORD === undefined) throw new Error('TAURI_KEY_PASSWORD is not set. Export it (empty if the key has no password).');
  const expanded = value.replace(/^~(?=\/)/, os.homedir());
  return { keyPath: fs.existsSync(expanded) ? expanded : null, keyText: fs.existsSync(expanded) ? null : value, password: process.env.TAURI_KEY_PASSWORD };
}

/**
 * The Tauri 1 signer accepts the key only as an argument. Pass a key file path
 * (writing key text to a private temporary file when needed) so the key itself
 * never appears in a process listing. The password is passed with -p.
 */
function signUpdaterArchive(file, key) {
  let temp = null;
  let keyPath = key.keyPath;
  if (!keyPath) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-updater-key-'));
    keyPath = path.join(temp, 'updater.key');
    fs.writeFileSync(keyPath, key.keyText, { mode: 0o600 });
  }
  try {
    run('pnpm', ['tauri', 'signer', 'sign', '-f', keyPath, '-p', key.password, file], { cwd: path.join(root, 'centinel'), stdio: ['ignore', 'ignore', 'inherit'] });
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

function requireUpdaterPublicKey() {
  const pubkey = JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8')).tauri?.updater?.pubkey ?? '';
  if (!pubkey || pubkey.startsWith('__')) throw new Error('tauri.conf.json has no updater public key. Run pnpm tauri signer generate -w ~/.tauri/centinel.key and paste the public key into updater.pubkey.');
}

/** codesign -dv writes its report to stderr. */
function signatureDetails(file) {
  const result = spawnSync('codesign', ['-dv', '--verbose=2', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)} is not signed.`);
  return result.stderr;
}

/** Notarization rejects binaries without our Developer ID and the hardened runtime. */
function requireReleaseSignature(file, label) {
  const details = signatureDetails(file);
  if (!/flags=0x[0-9a-f]*\(runtime\)|flags=.*runtime/.test(details)) throw new Error(`${label} is signed without the hardened runtime.`);
  if (!details.includes(`Authority=${identity}`)) throw new Error(`${label} is not signed with ${identity}.`);
}

if (process.platform !== 'darwin') throw new Error('release:mac must run on macOS.');
// --updater-only re-creates the update archive, signature and latest.json from
// an app that this script already built, notarized and stapled.
const updaterOnly = process.argv.includes('--updater-only');
const updaterEnv = updaterKeyEnv();
requireUpdaterPublicKey();

const identity = signingIdentity();
if (!updaterOnly) {
step(`Signing as ${identity}`);
step(`Checking the notarization profile "${profile}"`);
capture('xcrun', ['notarytool', 'history', '--keychain-profile', profile]);

// The updater key is used only for the final archive signature below, so the
// Tauri build itself never sees it.
const env = { ...process.env, APPLE_SIGNING_IDENTITY: identity };
delete env.TAURI_PRIVATE_KEY;
delete env.TAURI_KEY_PASSWORD;
step('Building the sidecar');
run('node', ['scripts/bundle-sidecar.mjs', '--target', triple], { env });

step('Signing the bundled Codex CLI with the hardened runtime');
const bundledCodex = path.join(tauriDir, `binaries/codex-${triple}`);
if (!fs.existsSync(bundledCodex)) throw new Error(`The bundled Codex CLI is missing: ${path.relative(root, bundledCodex)}.`);
run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, bundledCodex], { stdio: 'pipe' });
requireReleaseSignature(bundledCodex, 'The bundled Codex CLI');

step('Building the signed app');
run('pnpm', ['tauri', 'build', '--bundles', 'app', ...(crossBuild ? ['--target', triple] : [])], { cwd: path.join(root, 'centinel'), env });

step('Verifying the app signature');
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
requireReleaseSignature(codex, 'Contents/MacOS/codex');
requireReleaseSignature(path.join(app, 'Contents/MacOS/centinel-node'), 'Contents/MacOS/centinel-node');

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

// Apple issued tickets for everything inside the DMG, so the app itself can
// carry one too. Updates then pass Gatekeeper offline.
step('Stapling the app for in-app updates');
run('xcrun', ['stapler', 'staple', app]);
run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);

} else {
  step('Reusing the notarized app');
  run('xcrun', ['stapler', 'validate', app]);
}

step('Creating the signed update archive');
fs.rmSync(updaterArchive, { force: true });
fs.rmSync(`${updaterArchive}.sig`, { force: true });
run('tar', ['-czf', updaterArchive, '-C', path.dirname(app), path.basename(app)], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
signUpdaterArchive(updaterArchive, updaterEnv);
if (!fs.existsSync(`${updaterArchive}.sig`)) throw new Error('The Tauri signer did not write Centinel.app.tar.gz.sig.');

step('Writing latest.json');
// Keep the other architecture's entry when it was built for the same version.
let previous = null;
try { previous = JSON.parse(fs.readFileSync(updaterManifest, 'utf8')); } catch { previous = null; }
const manifest = {
  version,
  notes: process.env.RELEASE_NOTES?.trim() || `See https://github.com/kongjiyu/centinel/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    ...(previous?.version === version ? previous.platforms : {}),
    [updaterPlatform]: {
      signature: fs.readFileSync(`${updaterArchive}.sig`, 'utf8').trim(),
      url: `${releaseUrl}/${path.basename(updaterArchive)}`,
    },
  },
};
fs.writeFileSync(updaterManifest, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\n[release-macos] Ready in ${path.relative(root, outDir)}:`);
for (const file of [...(updaterOnly ? [] : [dmg]), updaterArchive, `${updaterArchive}.sig`, updaterManifest]) console.log(`  ${path.basename(file)}`);
console.log(`Upload ${updaterOnly ? "these (and the DMG)" : "all four"} to the GitHub release v${version}. Installed apps update when latest.json is published as the latest release.`);
