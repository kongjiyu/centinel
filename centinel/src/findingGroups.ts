import type { Finding, FindingSourceReference } from './types';
import { effectiveFindingStatus } from './findingStatus';

const RULE_TITLES: Record<string, string> = {
  'cq-deep-nesting': 'Code Deep Nesting Issue', 'cq-long-function': 'Long Function Issue',
  'cq-empty-catch': 'Empty Error Handler', 'cq-console-log': 'Console Logging Issue',
  'cq-todo-comments': 'Unfinished Code Tasks', 'cq-debugger': 'Debugger Statement', 'cq-alert': 'Alert Dialog Usage',
  'sec-eval': 'Unsafe Code Evaluation', 'sec-innerhtml': 'Unsafe HTML Assignment',
  'sec-sql-injection': 'SQL Injection Risk', 'sec-disabled-headers': 'Disabled Security Headers',
  'sec-hardcoded-url-creds': 'Credentials in URL', 'sec-math-random': 'Insecure Randomness Risk',
};
const GAP_TITLES: Record<string, string> = {
  traceability_mappings_incomplete: 'Incomplete Requirement Coverage',
  confirmed_requirements_missing: 'Missing Confirmed Requirements', unconfirmed_requirements: 'Unconfirmed Business Requirements',
  requirement_candidates_pending: 'Unconfirmed Requirements',
};
export type FindingGroup = { key: string; title: string; representative: Finding; members: Finding[] };

export function findingDomain(finding: Finding): string {
  if (finding.verifier === 'readiness') return 'Document quality';
  const explicit = finding.location?.domain || finding.location?.sourceLocator?.analysis?.domain;
  if (explicit && ['security', 'business', 'technical', 'personnel'].includes(explicit)) return explicit.charAt(0).toUpperCase() + explicit.slice(1);
  if (/security|injection|credential|authorization/.test(finding.category)) return 'Security';
  if (/personnel|human_error|usability/.test(finding.category)) return 'Personnel';
  if (/business|requirement/.test(finding.category) || finding.evidenceGap && finding.requirementId || /requirement/.test(finding.evidenceGap?.code ?? '')) return 'Business';
  return 'Technical';
}

/** Presentation grouping only. Input order already expresses risk/severity priority. */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const rule = finding.location?.ruleId || finding.title.match(/^\[([^\]]+)\]/)?.[1];
    const code = finding.evidenceGap?.code;
    const type = finding.location?.issueType || (/\brace conditions?\b/i.test(finding.title) ? 'race_condition' : null);
    const canonicalType = type === 'deep_nesting' ? 'cq-deep-nesting' : type === 'long_function' ? 'cq-long-function' : type || rule;
    const identity = canonicalType ? `type:${canonicalType}` : code ? `gap:${code}` : `title:${findingDomain(finding)}:${finding.title.trim().toLocaleLowerCase()}`;
    const key = JSON.stringify([finding.projectId, finding.source, finding.verifier === 'readiness' ? 'readiness' : 'review', identity]);
    const title = type === 'race_condition' ? 'Race Condition Risk' : (canonicalType && RULE_TITLES[canonicalType]) || (code && GAP_TITLES[code]) || finding.title;
    const existing = groups.get(key);
    if (existing) existing.members.push(finding);
    else groups.set(key, { key, title, representative: finding, members: [finding] });
  }
  return [...groups.values()];
}

export function findingGroupDomains(group: FindingGroup): string {
  return [...new Set(group.members.map(findingDomain))].join(', ');
}

export function groupStatus(group: FindingGroup): string {
  const statuses = group.members.map(item => effectiveFindingStatus(item));
  if (statuses.some(status => status !== 'fixed' && status !== 'dismissed')) return 'Unresolved';
  if (statuses.every(status => status === 'fixed')) return 'Resolved';
  if (statuses.every(status => status === 'dismissed')) return 'Dismiss';
  return 'Mixed';
}

export function findingSourceReferences(finding: Finding): FindingSourceReference[] {
  const refs: FindingSourceReference[] = [...(finding.relatedSources ?? [])];
  for (const ref of finding.location?.relatedLocations ?? []) refs.push({ artifactId: ref.artifactId, filePath: ref.filePath, lineNumber: ref.lineNumber, sourceVersion: ref.sourceVersion, excerpt: ref.evidence, relation: 'code' });
  if (finding.filePath && !refs.some(ref => ref.filePath === finding.filePath && ref.artifactId === finding.artifactId)) refs.unshift({
    artifactId: finding.artifactId, filePath: finding.filePath, lineNumber: finding.lineNumber,
    sourceVersion: finding.artifactVersionId || finding.location?.sourceVersion, excerpt: finding.evidenceText,
    relation: finding.evidenceGap ? 'document' : 'code',
  });
  const locator = finding.location?.sourceLocator;
  if (locator?.filePath && !refs.some(ref => ref.filePath === locator.filePath && ref.artifactId === locator.artifactId)) refs.push({
    artifactId: locator.artifactId, filePath: locator.filePath, lineNumber: locator.lineStart, excerpt: locator.excerpt,
    relation: finding.requirementId ? 'requirement' : 'document',
  });
  return [...new Map(refs.map(ref => [JSON.stringify([ref.artifactId, ref.filePath, ref.lineNumber, ref.sourceVersion, ref.relation, ref.excerpt]), ref])).values()];
}
