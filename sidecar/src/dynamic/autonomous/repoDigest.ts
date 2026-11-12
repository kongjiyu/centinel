/**
 * Bounded repository digest for Autonomous Dynamic Testing.
 *
 * Reads a local repository straight from disk (no Storage upload), stays
 * inside the realpath root, and fills a character budget in priority order:
 * README/docs, manifests, detected routes, HTML forms, then seed/fixture/demo
 * account files. Every entry keeps its source path and original line numbers
 * so generated tests can cite where a fact came from.
 *
 * Secret material is never read: `.env` files (other than example/template
 * files, whose variable names only are kept) and files whose names look like
 * keys, credentials or secrets are skipped before reading.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { walkLocalRepository } from '../../applicationApi.js';
import { containedFile } from '../workspace/registry.js';
import { detectRoutes, type DetectedRoute } from './routeDetector.js';

export type RepoDigestEntryKind = 'doc' | 'manifest' | 'route' | 'form' | 'fixture';
export type RepoDigestEntry = { path: string; kind: RepoDigestEntryKind; startLine: number; endLine: number; text: string };
export type RepoDigestFormField = { tag: 'input' | 'select' | 'textarea' | 'button'; name?: string; id?: string; type?: string; label?: string };
export type RepoDigestForm = { file: string; line: number; endLine: number; id?: string; action?: string; method?: string; fields: RepoDigestFormField[] };
export type RepoDigestFixture = { path: string; reason: 'seed_or_fixture_file' | 'demo_accounts_mentioned' };
export type PersistenceHint = { kind: 'database_url' | 'dependency' | 'database_file' | 'schema_file'; detail: string; file: string };
export type RepoDigest = {
  entries: RepoDigestEntry[];
  routes: DetectedRoute[];
  forms: RepoDigestForm[];
  fixtures: RepoDigestFixture[];
  requirementsText?: string;
  persistenceHints: PersistenceHint[];
  truncated: boolean;
  omittedCount: number;
  fingerprint: string;
};

const DEFAULT_MAX_CHARS = 60_000;
const MAX_READ_FILES = 2_000;
const MAX_WALK_ENTRIES = 20_000;
const MAX_REQUIREMENTS_CHARS = 20_000;
const MIN_PARTIAL_ENTRY_CHARS = 400;
const ROUTE_CONTEXT_LINES = 3;

const TEXT_EXT = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.html', '.htm', '.vue', '.svelte', '.json', '.toml', '.yaml', '.yml', '.sql', '.csv', '.prisma', '.cfg', '.ini']);
const TEXT_NAMES = new Set(['requirements.txt', 'Pipfile', 'Procfile', 'Gemfile']);
const ENV_EXAMPLE = /^\.env\.(?:example|sample|template|dist)$/i;
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'Cargo.lock']);
const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.cfg', 'manage.py', 'Procfile']);
const DB_FILE = /\.(?:db|sqlite|sqlite3)$/i;
const PERSISTENCE_DEPENDENCIES = ['sqlite3', 'better-sqlite3', 'sql.js', 'prisma', '@prisma/client', 'mongoose', 'mongodb', 'pg', 'postgres',
  'mysql', 'mysql2', 'sequelize', 'typeorm', 'knex', 'drizzle-orm', 'redis', 'ioredis', '@supabase/supabase-js', 'firebase', 'firebase-admin',
  'sqlalchemy', 'psycopg2', 'psycopg2-binary', 'psycopg', 'pymongo', 'peewee', 'django', 'flask-sqlalchemy', 'asyncpg', 'aiosqlite', 'tortoise-orm'];

/** True for names that must never be read: real env files, keys and credentials. */
export function isSecretLikePath(relativePath: string): boolean {
  const name = path.posix.basename(relativePath);
  if (/^\.env(?:\..*)?$/i.test(name) && !ENV_EXAMPLE.test(name)) return true;
  if (/\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|gpg|asc|ppk|kdbx)$/i.test(name)) return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(name)) return true;
  if (/(?:^|[-_.])(?:secrets?|credentials?|private[-_]?key|service[-_]?account|api[-_]?keys?|(?:auth|access|api|refresh)[-_]?tokens?|passwords?|htpasswd|netrc|npmrc|pypirc)(?:[-_.]|$)/i.test(name)) return true;
  return /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|secrets?)\//i.test(relativePath);
}

const isFixturePath = (relativePath: string) => /(?:^|\/)(?:seeds?|fixtures?|mocks?|demo|sample[-_]?data|testdata|seeders?)(?:\/|[-_.])/i.test(relativePath)
  || /(?:^|\/)(?:seed|seeds|users?|accounts?|demo[-_]?(?:users?|accounts?|data))\.(?:[cm]?[jt]s|json|py|sql|ya?ml|csv)$/i.test(relativePath);
const DEMO_ACCOUNT_TEXT = /\b(?:demo|test|sample|seed(?:ed)?)\s+(?:accounts?|users?|credentials?|logins?)\b/i;
const isDocPath = (relativePath: string) => {
  const name = path.posix.basename(relativePath);
  const ext = path.posix.extname(name).toLowerCase();
  if (!['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc'].includes(ext) || name === 'requirements.txt') return false;
  if (/^(?:changelog|license|licence|code_of_conduct|contributing|security)(?:\.|$)/i.test(name)) return false;
  return /^readme(?:\.|$)/i.test(name) || /(?:^|\/)docs?\//i.test(relativePath) || /(?:requirement|spec|user[-_ ]?stor|feature|acceptance)/i.test(name);
};
const docRank = (relativePath: string) => {
  const name = path.posix.basename(relativePath);
  if (relativePath === name && /^readme/i.test(name)) return 0;
  if (/requirement/i.test(name)) return 1;
  if (/(?:spec|user[-_ ]?stor|acceptance|feature)/i.test(name)) return 2;
  if (/^readme/i.test(name)) return 3;
  return 4;
};
const depth = (relativePath: string) => relativePath.split('/').length;

type SourceFile = { path: string; text: string; hash: string };

function readContained(root: string, relativePath: string): string | null {
  try {
    const resolved = containedFile(root, relativePath);
    const bytes = fs.readFileSync(resolved);
    if (bytes.includes(0)) return null; // binary
    return bytes.toString('utf8');
  } catch { return null; }
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const sliceLines = (all: string[], start: number, end: number) => all.slice(start - 1, end).join('\n');

/** Keep only variable names from an env example file. */
function envNamesOnly(text: string): string {
  return lines(text).map(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,127})\s*=/);
    return match ? `${match[1]}=` : /^\s*#/.test(line) ? line : '';
  }).join('\n');
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*['"\`]([^'"\`]*)['"\`]\\s*\\}|([^\\s>"']+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4];
  return value === undefined ? undefined : value.slice(0, 200);
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** HTML and JSX `<form>` blocks with their controls. */
export function extractForms(file: { path: string; text: string }): RepoDigestForm[] {
  const forms: RepoDigestForm[] = [];
  const text = file.text.replace(/\r\n?/g, '\n');
  for (const match of text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
    const open = match[1];
    const body = match[2];
    const fields: RepoDigestFormField[] = [];
    for (const control of body.matchAll(/<(input|select|textarea|button)\b([^>]*)>(?:([\s\S]*?)<\/\1\s*>)?/gi)) {
      const tag = control[1].toLowerCase() as RepoDigestFormField['tag'];
      const attrs = control[2];
      const field: RepoDigestFormField = { tag };
      for (const key of ['name', 'id', 'type'] as const) { const value = attribute(attrs, key); if (value) field[key] = value; }
      const id = field.id;
      const explicitLabel = id ? body.match(new RegExp(`<label\\b[^>]*\\b(?:for|htmlFor)\\s*=\\s*["'{]*${id.replace(/[^\w-]/g, '')}["'}]*[^>]*>([\\s\\S]*?)</label>`, 'i'))?.[1] : undefined;
      const before = body.slice(0, control.index);
      const wrapping = before.lastIndexOf('<label') > before.lastIndexOf('</label') ? before.slice(before.lastIndexOf('<label')) : undefined;
      const label = attribute(attrs, 'aria-label') ?? (explicitLabel ? plain(explicitLabel) : undefined)
        ?? (wrapping ? plain(wrapping.replace(/^<label\b[^>]*>/i, '')) : undefined)
        ?? (tag === 'button' && control[3] ? plain(control[3]) : undefined) ?? attribute(attrs, 'placeholder');
      if (label) field.label = label;
      if (field.type === 'hidden') continue;
      fields.push(field);
    }
    const startLine = lineOf(text, match.index!);
    const form: RepoDigestForm = { file: file.path, line: startLine, endLine: startLine + match[0].split('\n').length - 1, fields };
    for (const key of ['id', 'action', 'method'] as const) { const value = attribute(open, key); if (value) form[key] = value; }
    forms.push(form);
  }
  return forms;
}

function mergeWindows(lineNumbers: number[], total: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  for (const line of [...new Set(lineNumbers)].sort((a, b) => a - b)) {
    const start = Math.max(1, line - ROUTE_CONTEXT_LINES);
    const end = Math.min(total, line + ROUTE_CONTEXT_LINES);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  return windows;
}

function persistenceHints(files: SourceFile[], allPaths: string[]): PersistenceHint[] {
  const hints: PersistenceHint[] = [];
  for (const relativePath of allPaths) {
    if (DB_FILE.test(relativePath)) hints.push({ kind: 'database_file', detail: `Database file ${path.posix.basename(relativePath)}`, file: relativePath });
    if (/(?:^|\/)schema\.prisma$/.test(relativePath)) hints.push({ kind: 'schema_file', detail: 'Prisma schema', file: relativePath });
  }
  for (const file of files) {
    const name = path.posix.basename(file.path);
    if (ENV_EXAMPLE.test(name)) {
      for (const match of file.text.matchAll(/^\s*(?:export\s+)?((?:[A-Z0-9_]*_)?(?:DATABASE|DB|MONGO(?:DB)?|POSTGRES|PG|MYSQL|REDIS|SQLITE)[A-Z0-9_]*(?:URL|URI|HOST|NAME|PATH|FILE))\s*=/gm)) {
        hints.push({ kind: 'database_url', detail: `${match[1]} in ${name}`, file: file.path });
      }
    } else if (name === 'package.json') {
      try {
        const manifest = JSON.parse(file.text);
        const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
        for (const dependency of PERSISTENCE_DEPENDENCIES) if (Object.prototype.hasOwnProperty.call(deps, dependency)) hints.push({ kind: 'dependency', detail: dependency, file: file.path });
      } catch { /* unreadable manifest: no hint */ }
    } else if (name === 'requirements.txt' || name === 'pyproject.toml' || name === 'Pipfile') {
      const lower = file.text.toLowerCase();
      for (const dependency of PERSISTENCE_DEPENDENCIES) {
        if (new RegExp(`(?:^|[\\s"'\\[,])${dependency.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=[\\s"'<>=~!;\\[,]|$)`, 'm').test(lower)) {
          hints.push({ kind: 'dependency', detail: dependency, file: file.path });
        }
      }
    }
  }
  const seen = new Set<string>();
  return hints.filter(hint => { const key = `${hint.kind}\u0000${hint.detail}\u0000${hint.file}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export async function buildRepoDigest(folder: string, options: { maxChars?: number } = {}): Promise<RepoDigest> {
  const maxChars = Math.max(1_000, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS));
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Choose an absolute local repository folder.');
  const root = fs.realpathSync(folder);
  if (!fs.statSync(root).isDirectory()) throw new Error('Choose a local repository folder.');

  const walked = await walkLocalRepository(root, MAX_WALK_ENTRIES);
  const walkedFiles = walked.files.sort((left, right) => left.path.localeCompare(right.path));
  const allPaths = walkedFiles.map(file => file.path).filter(relativePath => !isSecretLikePath(relativePath));
  let truncated = !walked.complete;

  const files: SourceFile[] = [];
  for (const file of walkedFiles) {
    const name = path.posix.basename(file.path);
    if (isSecretLikePath(file.path) || LOCKFILES.has(name)) continue;
    if (!TEXT_EXT.has(path.posix.extname(name).toLowerCase()) && !TEXT_NAMES.has(name) && !ENV_EXAMPLE.test(name)) continue;
    if (files.length >= MAX_READ_FILES) { truncated = true; break; }
    const raw = readContained(root, file.path); // rejects symlink escapes and files over 1 MB
    if (raw === null) continue;
    const text = ENV_EXAMPLE.test(name) ? envNamesOnly(raw) : raw.replace(/\r\n?/g, '\n');
    files.push({ path: file.path, text, hash: crypto.createHash('sha256').update(raw).digest('hex') });
  }
  const byPath = new Map(files.map(file => [file.path, file]));

  const routes = detectRoutes(files);
  const forms = files.filter(file => /\.(?:html?|[cm]?[jt]sx|vue|svelte)$/i.test(file.path)).flatMap(extractForms);

  const docs = files.filter(file => isDocPath(file.path)).sort((left, right) => docRank(left.path) - docRank(right.path)
    || depth(left.path) - depth(right.path) || left.path.localeCompare(right.path));
  const requirementsFile = docs.find(file => /(?:^|\/)docs?\/requirements?\.(?:md|txt|rst)$/i.test(file.path))
    ?? docs.find(file => /requirement/i.test(path.posix.basename(file.path)));

  const fixtures: RepoDigestFixture[] = [];
  for (const file of files) {
    if (isFixturePath(file.path) && !isDocPath(file.path) && !/\.html?$/i.test(file.path)) fixtures.push({ path: file.path, reason: 'seed_or_fixture_file' });
    else if (isDocPath(file.path) && DEMO_ACCOUNT_TEXT.test(file.text)) fixtures.push({ path: file.path, reason: 'demo_accounts_mentioned' });
  }

  // Candidate entries in priority order.
  const candidates: RepoDigestEntry[] = [];
  const whole = (file: SourceFile, kind: RepoDigestEntryKind): RepoDigestEntry => {
    const all = lines(file.text);
    return { path: file.path, kind, startLine: 1, endLine: all.length, text: file.text };
  };
  for (const file of docs) candidates.push(whole(file, 'doc'));
  for (const file of files) {
    const name = path.posix.basename(file.path);
    if ((MANIFESTS.has(name) || ENV_EXAMPLE.test(name)) && depth(file.path) <= 3) candidates.push(whole(file, 'manifest'));
  }
  const routeLines = new Map<string, number[]>();
  for (const route of routes) {
    if (route.kind === 'page' && route.line === 1 && /\.html?$/i.test(route.file)) continue; // the form/page HTML follows
    routeLines.set(route.file, [...(routeLines.get(route.file) ?? []), route.line]);
  }
  for (const [file, numbers] of routeLines) {
    const all = lines(byPath.get(file)!.text);
    for (const [start, end] of mergeWindows(numbers, all.length)) {
      candidates.push({ path: file, kind: 'route', startLine: start, endLine: end, text: sliceLines(all, start, end) });
    }
  }
  for (const form of forms) {
    const all = lines(byPath.get(form.file)!.text);
    candidates.push({ path: form.file, kind: 'form', startLine: form.line, endLine: form.endLine, text: sliceLines(all, form.line, form.endLine) });
  }
  for (const fixture of fixtures) {
    if (fixture.reason === 'seed_or_fixture_file') { candidates.push(whole(byPath.get(fixture.path)!, 'fixture')); continue; }
    // Demo-account docs: the paragraph that mentions the accounts, when the doc itself was not admitted whole.
    const all = lines(byPath.get(fixture.path)!.text);
    const index = all.findIndex(line => DEMO_ACCOUNT_TEXT.test(line));
    const start = Math.max(1, index + 1 - 2);
    const end = Math.min(all.length, index + 1 + 12);
    candidates.push({ path: fixture.path, kind: 'fixture', startLine: start, endLine: end, text: sliceLines(all, start, end) });
  }

  // Fill the budget. One entry may not take more than a third of it, so later
  // priorities (routes, forms, fixtures) are not starved by one large doc.
  const perEntryCap = Math.max(MIN_PARTIAL_ENTRY_CHARS, Math.floor(maxChars / 3));
  const entries: RepoDigestEntry[] = [];
  let used = 0;
  let omittedCount = 0;
  const covered = (candidate: RepoDigestEntry) => entries.some(entry => entry.path === candidate.path
    && entry.startLine <= candidate.startLine && entry.endLine >= candidate.endLine);
  for (const candidate of candidates) {
    if (covered(candidate)) continue;
    const remaining = maxChars - used;
    const cap = Math.min(perEntryCap, remaining);
    if (candidate.text.length <= cap) { entries.push(candidate); used += candidate.text.length; continue; }
    truncated = true;
    if (cap < MIN_PARTIAL_ENTRY_CHARS) { omittedCount++; continue; }
    const all = candidate.text.split('\n');
    let size = 0;
    let count = 0;
    while (count < all.length && size + all[count].length + 1 <= cap) size += all[count++].length + 1;
    if (count === 0) { omittedCount++; continue; }
    const text = all.slice(0, count).join('\n');
    entries.push({ ...candidate, endLine: candidate.startLine + count - 1, text });
    used += text.length;
  }

  const hints = persistenceHints(files, allPaths);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ maxChars, files: files.map(file => [file.path, file.hash]),
    paths: allPaths })).digest('hex');
  const requirementsText = requirementsFile ? requirementsFile.text.slice(0, MAX_REQUIREMENTS_CHARS) : undefined;
  return { entries, routes, forms, fixtures, ...(requirementsText ? { requirementsText } : {}), persistenceHints: hints,
    truncated, omittedCount, fingerprint };
}
