import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseEnv } from 'dotenv';
import { redactOutput } from '../dynamic/workspace/redaction.js';

/**
 * Redaction for text that leaves this Mac in a user-exported diagnostics file.
 *
 * Exact known values (`.env` values, sensitive process variables, the caller's
 * bearer token) are removed first with the shared `redactOutput` helper, which
 * also catches their JSON- and URL-encoded forms. Pattern rules then catch
 * credentials that were never in configuration: bearer headers, JWTs, provider
 * key formats, `key=value` secrets, URL user-info and query strings, emails and
 * the home-directory path (which contains the macOS account name).
 */

const SENSITIVE_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DSN|DATABASE_URL)/i;
/** Values shorter than this are too likely to collide with ordinary words or numbers. */
const MINIMUM_SECRET_LENGTH = 6;

export function collectEnvironmentSecrets(input: { envFiles?: string[]; env?: NodeJS.ProcessEnv; extra?: Array<string | null | undefined> } = {}): string[] {
  const values = new Set<string>();
  for (const file of input.envFiles ?? []) {
    try {
      // Every value in a `.env` file is treated as private, whatever its name.
      for (const value of Object.values(parseEnv(fs.readFileSync(file)))) values.add(value);
    } catch { /* A missing or unreadable file has nothing to redact. */ }
  }
  for (const [name, value] of Object.entries(input.env ?? {})) if (value && SENSITIVE_NAME.test(name)) values.add(value);
  for (const value of input.extra ?? []) if (value) values.add(value);
  return [...values].map(value => value.trim()).filter(value => value.length >= MINIMUM_SECRET_LENGTH);
}

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers and bare bearer credentials.
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/]{8,}=*/g, 'Basic [REDACTED]'],
  // JSON Web Tokens (Supabase access/refresh sessions, provider id tokens).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED JWT]'],
  // Well-known provider key shapes.
  [/\b(?:sk|pk|rk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED KEY]'],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED KEY]'],
  [/\bpa-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[REDACTED KEY]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED KEY]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED KEY]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED KEY]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  // name=value / name: value secrets, quoted or not.
  [/\b((?:[A-Za-z0-9]+[_-])*(?:authorization|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token|cookie|private[_-]?key|encryption[_-]?key))(["']?\s*[:=]\s*)(?:Bearer\s+)?("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1$2[REDACTED]'],
  // Email addresses.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED EMAIL]'],
];

/** URLs keep scheme, host and path; user-info, query and fragment may hold credentials. */
function redactUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, raw => {
    const punctuation = raw.match(/[),.;\]]+$/)?.[0] ?? '';
    const candidate = punctuation ? raw.slice(0, -punctuation.length) : raw;
    try {
      const url = new URL(candidate);
      const credentials = Boolean(url.username || url.password);
      url.username = ''; url.password = '';
      if (url.search) url.search = '?[REDACTED]';
      if (url.hash) url.hash = '#[REDACTED]';
      const text = url.toString();
      return (credentials ? text.replace('//', '//[REDACTED]@') : text) + punctuation;
    } catch {
      return '[REDACTED URL]' + punctuation;
    }
  });
}

export function redactDiagnosticText(value: string, secrets: readonly string[], homeDirectory: string = os.homedir()): string {
  let text = redactOutput(value, [...secrets]);
  text = redactUrls(text);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  if (homeDirectory && homeDirectory.length > 1) {
    const home = path.resolve(homeDirectory);
    text = text.split(home).join('~');
  }
  return text;
}
