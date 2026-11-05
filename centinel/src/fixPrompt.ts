import type { Finding } from './types';
import { findingSourceReferences } from './findingGroups';
import { deriveRiskLevelWithFallback } from './riskPolicy';
import { displayPath } from './utils/displayPath';

/**
 * Build a self-contained, plain-text prompt that a person can paste into an AI
 * coding tool (Cursor, Claude Code, Codex) to fix one finding.
 *
 * It contains only this finding's public content: title, risk, location,
 * a short evidence excerpt, the recorded explanation and remedy, and the linked
 * requirement sentence. It never includes Centinel IDs, model reasoning,
 * other findings or secret-looking values.
 */

const MAX_EXCERPT_LINES = 20;
const MAX_EXCERPT_CHARS = 1200;
const MAX_PROSE_CHARS = 2000;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SECRET_PATTERNS: Array<[RegExp, string | ((...groups: string[]) => string)]> = [
  // Credentials embedded in URLs: scheme://user:password@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@'],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]'],
  // Well-known provider token prefixes
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g, '[redacted]'],
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, '[redacted]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, 'Bearer [redacted]'],
  // key = "value" style assignments of secret-named settings
  [/((?:api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*)(["'`])([^"'`\n]{4,})\2/gi, (_m, prefix, quote) => `${prefix}${quote}[redacted]${quote}`],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement as string), text);
}

function prose(text: string | null | undefined): string {
  const cleaned = redactSecrets((text ?? '').replace(UUID, '').replace(/[ \t]+\n/g, '\n').replace(/\(\s*\)/g, '').trim());
  return cleaned.length > MAX_PROSE_CHARS ? `${cleaned.slice(0, MAX_PROSE_CHARS).trimEnd()}…` : cleaned;
}

function excerpt(text: string | null | undefined): string {
  const lines = redactSecrets((text ?? '').replace(/\r\n?/g, '\n')).split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let value = lines.slice(0, MAX_EXCERPT_LINES).join('\n');
  const truncated = lines.length > MAX_EXCERPT_LINES || value.length > MAX_EXCERPT_CHARS;
  if (value.length > MAX_EXCERPT_CHARS) value = value.slice(0, MAX_EXCERPT_CHARS);
  return truncated ? `${value.trimEnd()}\n…` : value;
}

/** A fence longer than any backtick run inside the excerpt keeps Markdown intact. */
function fenced(text: string, language: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function fenceLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp', php: 'php', html: 'html', css: 'css', sql: 'sql', json: 'json',
    md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash',
  };
  return known[extension] ?? '';
}

function location(path: string | null | undefined, line: number | null | undefined): string | null {
  if (!path) return null;
  return `${displayPath(path)}${line ? `:${line}` : ''}`;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function buildFixPrompt(finding: Finding, options: { title?: string } = {}): string {
  const title = prose(options.title || finding.title) || 'Issue reported by Centinel';
  const riskLevel = finding.riskLevel ?? deriveRiskLevelWithFallback(finding.severity, finding.priority);
  const riskParts = [riskLevel ? capitalize(riskLevel) : null, finding.severity ? `severity ${finding.severity.toLowerCase()}` : null, finding.priority?.trim() ? `priority ${finding.priority.trim().toLowerCase()}` : null].filter(Boolean);
  const references = findingSourceReferences(finding);
  const primary = location(finding.filePath, finding.lineNumber);
  const related = [...new Set(references
    .filter(ref => ref.relation === 'code')
    .map(ref => location(ref.filePath, ref.lineNumber))
    .filter((value): value is string => Boolean(value) && value !== primary))];
  const codeRef = references.find(ref => ref.relation === 'code' && ref.excerpt?.trim());
  const evidenceSource = finding.filePath && finding.evidenceText?.trim() ? finding.evidenceText : codeRef?.excerpt ?? '';
  const evidencePath = finding.filePath && finding.evidenceText?.trim() ? finding.filePath : codeRef?.filePath ?? '';
  const evidence = excerpt(evidenceSource);
  const requirement = prose(references.find(ref => ref.relation === 'requirement' && ref.excerpt?.trim())?.excerpt);
  const description = prose(finding.description);
  const recommendation = prose(finding.recommendation);
  const steps = (finding.location?.logicFlow ?? []).map(prose).filter(Boolean);

  const sections: string[] = [
    'Fix the following issue in this codebase. It was reported by an automated code review.',
    [`Issue: ${title}`, riskParts.length ? `Risk: ${riskParts.join(', ')}` : null, primary ? `Location: ${primary}` : null].filter(Boolean).join('\n'),
  ];
  if (related.length) sections.push(`Related locations:\n${related.map(item => `- ${item}`).join('\n')}`);
  if (evidence) sections.push(`Evidence${evidencePath ? ` (${displayPath(evidencePath)})` : ''}:\n${fenced(evidence, fenceLanguage(evidencePath))}`);
  if (description) sections.push(`What is wrong:\n${description}`);
  if (steps.length) sections.push(`How it happens:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  if (recommendation) sections.push(`What to do:\n${recommendation}`);
  if (requirement) sections.push(`Requirement this code must satisfy:\n"${requirement.replace(/\s+/g, ' ')}"`);
  sections.push([
    'Instructions:',
    '- Read the code at the location above first and confirm the problem before changing anything.',
    '- Make the smallest change that fixes this issue. Do not refactor or change unrelated behaviour.',
    '- Add or update a test that fails without the fix and passes with it, then run the relevant tests.',
    '- Briefly explain what you changed.',
  ].join('\n'));
  return `${sections.join('\n\n')}\n`;
}

/** Copy text to the clipboard, falling back to a hidden textarea where the async API is unavailable. */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fall back below */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Clipboard unavailable');
}
