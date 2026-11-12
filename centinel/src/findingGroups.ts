import type { Finding, FindingSourceReference, MergedFindingObservation } from './types';
import { effectiveFindingStatus } from './findingStatus';

const RULE_TITLES: Record<string, string> = {
  'cq-deep-nesting': 'Code Deep Nesting Issue', 'cq-long-function': 'Long Function Issue',
  'cq-empty-catch': 'Empty Error Handler', 'cq-console-log': 'Console Logging Issue',
  'cq-todo-comments': 'Unfinished Code Tasks', 'cq-debugger': 'Debugger Statement', 'cq-alert': 'Alert Dialog Usage',
  'sec-eval': 'Unsafe Code Evaluation', 'sec-innerhtml': 'Unsafe HTML Assignment',
  'sec-sql-injection': 'SQL Injection Risk', 'sec-disabled-headers': 'Disabled Security Headers',
  'sec-hardcoded-url-creds': 'Credentials in URL', 'sec-math-random': 'Insecure Randomness Risk',
  'secrets-api-key': 'Hard-coded Secret', 'secrets-aws-key': 'Hard-coded AWS Key', 'secrets-private-key': 'Private Key in Source',
  'secrets-connection-string': 'Database Password in Source', 'secrets-jwt-token': 'Hard-coded JWT', 'secrets-bearer-token': 'Hard-coded Bearer Token',
};

/**
 * Plain-language meaning of a rule-engine check, shown when no AI-reported
 * issue explains the same location. It says what the pattern means and why it
 * can matter; it is not an AI verdict on this code.
 */
const RULE_EXPLANATIONS: Record<string, string> = {
  'secrets-api-key': 'A value that looks like a password, key or secret is written directly in the source code. If it is used in a real environment, anyone who can read the code can read it too, and a session or signing secret could let them forge sessions or tokens.',
  'secrets-aws-key': 'An AWS access key ID is written in the source code. Anyone who can read the code may be able to use the AWS account it belongs to.',
  'secrets-private-key': 'A private key is stored in the source code. Anyone who can read the code can impersonate whatever the key protects.',
  'secrets-connection-string': 'A database address with a password inside it is stored in the source code. Anyone who can read the code can try to connect to that database.',
  'secrets-jwt-token': 'A complete sign-in token (JWT) is stored in the source code. Anyone who can read the code may be able to reuse it.',
  'secrets-bearer-token': 'A fixed access token is sent in a request header from the source code. Anyone who can read the code may be able to reuse it.',
  'sec-eval': 'The code runs text as program code. If that text can come from a user, they may be able to run their own code.',
  'sec-innerhtml': 'The code inserts HTML into the page directly. If any part comes from a user, it could run their script in other people\'s browsers.',
  'sec-sql-injection': 'A database query is built by joining text. If any part comes from a user, they may be able to change what the query does.',
  'sec-hardcoded-url-creds': 'A web address contains a user name and password. Anyone who can read the code can read those credentials.',
  'sec-math-random': 'Math.random() is not safe for secrets such as tokens or reset codes, because its values can be predicted.',
  'cq-console-log': 'Debug logging was left in the code. It can clutter logs or reveal details that should stay private.',
  'cq-empty-catch': 'An error is caught and silently ignored, so failures can go unnoticed.',
};

export function ruleIdOf(finding: Finding): string | null {
  return finding.location?.ruleId || finding.title.match(/^\[([^\]]+)\]/)?.[1] || null;
}

/** Plain-language explanation for a rule-only finding, or null when it is not a rule finding. */
export function ruleCheckExplanation(finding: Finding): string | null {
  if (finding.verifier === 'model' || finding.verifier === 'readiness') return null;
  const rule = ruleIdOf(finding);
  if (!rule) return null;
  return RULE_EXPLANATIONS[rule] ?? 'Centinel\'s built-in pattern check matched this line. Read the code to confirm whether it is a real problem.';
}

/** Repeats of the same issue that its Review kept as evidence on this finding. */
export function mergedObservations(finding: Finding): MergedFindingObservation[] {
  const value = finding.location?.sourceLocator?.mergedObservations;
  return Array.isArray(value) ? value : [];
}

/** How many times one stored finding was observed: itself plus repeats its Review merged into it. */
export function findingObservationCount(finding: Finding): number {
  const total = finding.location?.sourceLocator?.mergedObservationTotal;
  return 1 + (typeof total === 'number' && Number.isInteger(total) && total > 0 ? total : mergedObservations(finding).length);
}
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

/**
 * Header count for a findings list. Only code findings are "flagged items";
 * requirement-coverage gaps and readiness notes are counted on their own, so
 * one unlinked requirements document cannot look like dozens of bugs.
 */
export function findingCountSummary(findings: Finding[]): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const isReadiness = (finding: Finding) => finding.verifier === 'readiness';
  const isGap = (finding: Finding) => !isReadiness(finding) && Boolean(finding.evidenceGap);
  const issues = findings.filter(finding => !isGap(finding) && !isReadiness(finding));
  const groups = groupFindings(issues);
  const distinct = groups.reduce((total, group) => total + group.issues.length, 0);
  const gapIssues = groupFindings(findings.filter(isGap)).reduce((total, group) => total + group.issues.length, 0);
  const readinessIssues = groupFindings(findings.filter(isReadiness)).reduce((total, group) => total + group.issues.length, 0);
  // Raw occurrences include repeats a Review kept as evidence on one finding.
  const occurrences = issues.reduce((total, finding) => total + findingObservationCount(finding), 0);
  const parts = [`${plural(groups.length, 'issue type', 'issue types')} · ${plural(distinct, 'flagged item', 'flagged items')}${occurrences > distinct ? ` · ${occurrences} occurrences` : ''}`];
  if (gapIssues) parts.push(plural(gapIssues, 'evidence gap', 'evidence gaps'));
  if (readinessIssues) parts.push(plural(readinessIssues, 'readiness note', 'readiness notes'));
  return parts.join(' · ');
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
  const order = new Map(findings.map((finding, index) => [finding.id, index]));
  return mergeRepeatedModelIssues(foldRuleGroupsIntoModelIssues([...groups.values()]), order)
    .map(group => ({ ...group, issues: clusterIssues(group.members) }));
}

const TITLE_STOPWORDS = new Set(['a', 'an', 'and', 'are', 'at', 'be', 'by', 'can', 'check', 'checks', 'for', 'from', 'in', 'is', 'issue', 'lack', 'lacks', 'missing', 'no', 'not', 'of', 'on', 'or', 'risk', 'the', 'to', 'via', 'with', 'without']);

function titleTokens(title: string): Set<string> {
  return new Set(normalizeIssueTitle(title).split(' ')
    .map(token => token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token)
    .filter(token => token.length > 3 && !TITLE_STOPWORDS.has(token)));
}

/** Overlap of the smaller title's meaningful words: "Credential Enumeration" ⊂ "Credential Error Enables Email Enumeration". */
function similarTitles(left: string, right: string): boolean {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared > 0 && shared / Math.min(a.size, b.size) >= 0.5;
}

const scopeOf = (group: FindingGroup) => JSON.stringify((JSON.parse(group.key) as unknown[]).slice(0, 3));
const isModelIssueGroup = (group: FindingGroup) => group.representative.verifier !== 'readiness' && !group.representative.evidenceGap
  && group.members.every(member => !isRuleFinding(member));

/**
 * Successive Reviews word or type the same model-reported problem differently
 * ("Missing Server-Side Quantity Validation" / "Server-Side Quantity Validation
 * Missing", or a new free-form issue type each run). Merge two such issue types
 * when their titles normalize identically, or when they point at the same file
 * within DUPLICATE_LINE_WINDOW lines with similar title words. Rule-engine and
 * readiness groups keep their own identities. Presentation only.
 */
function mergeRepeatedModelIssues(groups: FindingGroup[], order: Map<string, number>): FindingGroup[] {
  const parent = groups.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const related = (left: FindingGroup, right: FindingGroup) => {
    const leftTitles = new Set(left.members.map(member => normalizeIssueTitle(member.title)));
    if (right.members.some(member => leftTitles.has(normalizeIssueTitle(member.title)))) return true;
    return left.members.some(a => right.members.some(b => normalizedPath(a) !== '' && sameIssueLocation(a, b) && similarTitles(a.title, b.title)));
  };
  for (let i = 0; i < groups.length; i += 1) {
    if (!isModelIssueGroup(groups[i])) continue;
    for (let j = i + 1; j < groups.length; j += 1) {
      if (!isModelIssueGroup(groups[j]) || scopeOf(groups[i]) !== scopeOf(groups[j]) || find(i) === find(j)) continue;
      if (related(groups[i], groups[j])) parent[find(j)] = find(i);
    }
  }
  const merged = new Map<number, FindingGroup>();
  groups.forEach((group, index) => {
    const root = find(index);
    const target = merged.get(root);
    if (!target) merged.set(root, { ...group, members: [...group.members] });
    else target.members.push(...group.members);
  });
  return [...merged.values()].map(group => {
    const members = [...group.members].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { ...group, members };
  });
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
  if (finding.filePath && !refs.some(ref => ref.filePath === finding.filePath && ref.artifactId === finding.artifactId && ref.lineNumber === finding.lineNumber)) refs.unshift({
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
