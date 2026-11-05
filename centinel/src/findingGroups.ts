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
/**
 * One distinct issue: every stored occurrence of the same issue type at the
 * same place, typically re-detected by successive Reviews. Presentation only;
 * each occurrence keeps its own row, status, risk input and history.
 */
export type FindingIssue = { key: string; representative: Finding; occurrences: Finding[] };
export type FindingGroup = { key: string; title: string; representative: Finding; members: Finding[]; issues: FindingIssue[] };

/** Lines may move a little between source versions while the issue stays the same. */
export const DUPLICATE_LINE_WINDOW = 5;

export function normalizeIssueTitle(title: string): string {
  return title.trim().replace(/^\[[^\]]+\]\s*/, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const normalizedPath = (finding: Finding) => (finding.filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');

function sameIssueLocation(left: Finding, right: Finding): boolean {
  const leftPath = normalizedPath(left);
  const rightPath = normalizedPath(right);
  if (leftPath || rightPath) {
    if (leftPath !== rightPath) return false;
    if (left.lineNumber == null || right.lineNumber == null) return left.lineNumber == null && right.lineNumber == null;
    return Math.abs(left.lineNumber - right.lineNumber) <= DUPLICATE_LINE_WINDOW;
  }
  return (left.requirementId ?? '') === (right.requirementId ?? '') && normalizeIssueTitle(left.title) === normalizeIssueTitle(right.title);
}

function clusterIssues(members: Finding[]): FindingIssue[] {
  const issues: FindingIssue[] = [];
  for (const finding of members) {
    const existing = issues.find(issue => issue.occurrences.some(item => sameIssueLocation(item, finding)));
    if (existing) existing.occurrences.push(finding);
    else issues.push({ key: finding.id, representative: finding, occurrences: [finding] });
  }
  return issues;
}

export function findingIssueFor(group: FindingGroup, findingId: string): FindingIssue | undefined {
  return group.issues.find(issue => issue.occurrences.some(item => item.id === findingId));
}

/**
 * Distinct issues across all groups, ordered by where each issue's first
 * occurrence appears in the input (callers sort by risk first).
 */
export function distinctFindingIssues(findings: Finding[]): Array<FindingIssue & { title: string }> {
  const order = new Map(findings.map((finding, index) => [finding.id, index]));
  return groupFindings(findings)
    .flatMap(group => group.issues.map(issue => ({ ...issue, title: group.title })))
    .sort((a, b) => (order.get(a.representative.id) ?? 0) - (order.get(b.representative.id) ?? 0));
}

export function findingCountSummary(findings: Finding[]): string {
  const groups = groupFindings(findings);
  const distinct = groups.reduce((total, group) => total + group.issues.length, 0);
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return `${plural(groups.length, 'issue type', 'issue types')} · ${plural(distinct, 'flagged item', 'flagged items')}${findings.length > distinct ? ` · ${findings.length} occurrences` : ''}`;
}

/** Short row/table summary of how many places and repeated detections a group covers. */
export function groupOccurrenceSummary(group: FindingGroup): string | null {
  if (group.issues.length > 1) return `${group.issues.length} affected locations${group.members.length > group.issues.length ? ` · ${group.members.length} occurrences` : ''}`;
  if (group.members.length > 1) return `${group.members.length} occurrences`;
  return null;
}

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
    // Normalized titles let re-detections across Reviews ("Order ownership check
    // missing." / "Order Ownership Check Missing") share one issue type even when
    // successive Reviews attribute them to different domains.
    const identity = canonicalType ? `type:${canonicalType}` : code ? `gap:${code}` : `title:${normalizeIssueTitle(finding.title)}`;
    const key = JSON.stringify([finding.projectId, finding.source, finding.verifier === 'readiness' ? 'readiness' : 'review', identity]);
    const title = type === 'race_condition' ? 'Race Condition Risk' : (canonicalType && RULE_TITLES[canonicalType]) || (code && GAP_TITLES[code]) || finding.title;
    const existing = groups.get(key);
    if (existing) existing.members.push(finding);
    else groups.set(key, { key, title, representative: finding, members: [finding], issues: [] });
  }
  return foldRuleGroupsIntoModelIssues([...groups.values()]).map(group => ({ ...group, issues: clusterIssues(group.members) }));
}

const isRuleFinding = (finding: Finding) => Boolean(finding.location?.ruleId) && finding.verifier !== 'model';
const samePlace = (left: Finding, right: Finding) => Boolean(left.filePath) && left.filePath.replace(/\\/g, '/') === right.filePath.replace(/\\/g, '/')
  && left.lineNumber != null && right.lineNumber != null && Math.abs(left.lineNumber - right.lineNumber) <= 2;

/**
 * A rule-engine issue type whose every occurrence sits where a model-reported
 * issue of the same domain already points describes the same problem twice.
 * Fold it into that issue for presentation; stored occurrences, severities and
 * risk inputs are unchanged and every occurrence stays individually visible.
 */
function foldRuleGroupsIntoModelIssues(groups: FindingGroup[]): FindingGroup[] {
  const folded = new Set<FindingGroup>();
  for (const ruleGroup of groups) {
    if (ruleGroup.representative.source !== 'static' || !ruleGroup.members.every(isRuleFinding)) continue;
    const target = groups.find(candidate => candidate !== ruleGroup && !folded.has(candidate)
      && candidate.representative.source === 'static' && candidate.representative.verifier !== 'readiness'
      && candidate.members.some(member => !isRuleFinding(member))
      && findingDomain(candidate.representative) === findingDomain(ruleGroup.representative)
      && ruleGroup.members.every(rule => candidate.members.some(member => !isRuleFinding(member) && samePlace(member, rule))));
    if (!target) continue;
    target.members.push(...ruleGroup.members);
    folded.add(ruleGroup);
  }
  return groups.filter(group => !folded.has(group));
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
