import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centinelHome } from '../paths.js';
import { recentDiagnosticErrors, type DiagnosticErrorRecord } from './errorLog.js';
import { collectEnvironmentSecrets, redactDiagnosticText } from './redaction.js';
import { createZip } from './zip.js';

/**
 * Builds the user-initiated diagnostics bundle. It is returned to the desktop
 * app, which saves it where the user chooses; nothing is uploaded.
 *
 * Contents are limited to: the redacted tail of the local sidecar log, version
 * and platform facts, and recent allowlisted error codes. Prompts, source code,
 * findings, reports and provider settings are never read for this export.
 */
export const DIAGNOSTIC_LOG_LINES = 2000;
/** Long lines are cut so a stray payload cannot carry a large block of text. */
export const DIAGNOSTIC_LINE_CHARACTERS = 1000;
const LOG_TAIL_BYTES = 4 * 1024 * 1024;

export function sidecarLogPath(home = centinelHome()): string {
  return path.join(home, 'logs', 'sidecar.log');
}

export function readLogTail(file: string, maximumLines = DIAGNOSTIC_LOG_LINES): { lines: string[]; available: boolean } {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    let lines = buffer.toString('utf8').split(/\r?\n/);
    // The first line of a partial read may start mid-line.
    if (size > length) lines = lines.slice(1);
    if (lines.at(-1) === '') lines.pop();
    return { lines: lines.slice(-maximumLines), available: true };
  } catch {
    return { lines: [], available: false };
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function sidecarVersion(): string | null {
  // Development runs from the workspace; the packaged bundle is versioned with the app.
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === '@centinel/sidecar' && typeof manifest.version === 'string') return manifest.version;
    } catch { /* keep looking upward */ }
    directory = path.dirname(directory);
  }
  return null;
}

function macOSVersion(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const value = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d+(?:\.\d+){0,3}$/.test(value) ? value : null;
  } catch { return null; }
}

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/;

export type DiagnosticsInput = {
  appVersion?: unknown;
  /** The caller's own bearer token is redacted along with configuration values. */
  accessToken?: string | null;
  home?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  errors?: DiagnosticErrorRecord[];
};

export function buildDiagnosticsArchive(input: DiagnosticsInput = {}): { fileName: string; archive: Buffer } {
  const home = input.home ?? centinelHome();
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const envFiles = [path.join(home, '.env'), env.CENTINEL_RUNTIME_ENV?.trim()].filter((file): file is string => Boolean(file));
  const secrets = collectEnvironmentSecrets({ envFiles, env, extra: [input.accessToken] });
  const redact = (value: string) => redactDiagnosticText(value, secrets);

  const log = readLogTail(sidecarLogPath(home));
  const logText = log.available
    ? log.lines.map(line => {
        const redacted = redact(line);
        return redacted.length > DIAGNOSTIC_LINE_CHARACTERS ? redacted.slice(0, DIAGNOSTIC_LINE_CHARACTERS) + ' [line truncated]' : redacted;
      }).join('\n') + '\n'
    : 'No sidecar log file was found. The packaged app writes logs/sidecar.log; development runs log to the terminal.\n';

  const appVersion = typeof input.appVersion === 'string' && SAFE_VERSION.test(input.appVersion) ? input.appVersion : null;
  const system = {
    generatedAt: now.toISOString(),
    appVersion,
    sidecarVersion: sidecarVersion() ?? (env.CENTINEL_PACKAGED === '1' ? appVersion : null),
    packaged: env.CENTINEL_PACKAGED === '1',
    nodeVersion: process.version,
    platform: process.platform,
    osVersion: macOSVersion(),
    kernelRelease: os.release(),
    architecture: os.arch(),
    logLinesIncluded: log.lines.length,
    logFileFound: log.available,
  };

  const errors = (input.errors ?? recentDiagnosticErrors()).slice(-200);
  const readme = [
    'Centinel diagnostics',
    '',
    'This file was created on your Mac when you chose Export diagnostics. Nothing was uploaded.',
    'Share it only with someone you trust to help with a problem.',
    '',
    'Contents:',
    `- sidecar.log: the last ${DIAGNOSTIC_LOG_LINES} lines (at most) of the local service log, with tokens, keys,`,
    '  passwords, .env values, e-mail addresses, URL credentials/query strings and your home folder path redacted.',
    '- system.json: app and service versions, macOS version and processor architecture.',
    '- errors.json: recent error codes with HTTP status and route shape (identifiers removed).',
    '',
    'Not included: prompts, source code, artifacts, findings, reports, model provider settings or credentials.',
    '',
  ].join('\n');

  const archive = createZip([
    { name: 'README.txt', data: readme, modified: now },
    { name: 'system.json', data: JSON.stringify(system, null, 2) + '\n', modified: now },
    { name: 'errors.json', data: JSON.stringify(errors, null, 2) + '\n', modified: now },
    { name: 'sidecar.log', data: logText, modified: now },
  ]);
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return { fileName: `centinel-diagnostics-${stamp}.zip`, archive };
}
