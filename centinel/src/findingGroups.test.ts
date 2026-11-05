import { describe, expect, it } from 'vitest';
import { distinctFindingIssues, findingCountSummary, findingSourceReferences, groupFindings, groupOccurrenceSummary, groupStatus } from './findingGroups';
import type { Finding } from './types';
const finding = (id: string, extra: Partial<Finding> = {}): Finding => ({ id, projectId: 'p', sessionId: 'r', source: 'static', verifier: 'deterministic', severity: 'medium', title: '[cq-deep-nesting] nested 6 levels', description: 'Keep this original evidence.', status: 'new', createdAt: '', artifactId: id, category: 'code_quality', evidenceText: 'if (ready) {', recommendation: '', confidence: 'high', fromRemarks: false, filePath: `${id}.ts`, lineNumber: 4, ...extra });
describe('finding type grouping', () => {
  it('groups the same rule across files without changing occurrences, history or statuses', () => {
    const a = finding('a', { status: 'fixed' }); const b = finding('b', { title: 'A different full title', location: { ruleId: 'cq-deep-nesting' } });
    const group = groupFindings([a,b])[0];
    expect(group.title).toBe('Code Deep Nesting Issue'); expect(group.members).toEqual([a,b]);
    expect(groupStatus(group)).toBe('Unresolved'); expect(a.status).toBe('fixed');
    expect(groupStatus(groupFindings([a, finding('c', { status: 'dismissed' })])[0])).toBe('Mixed');
  });
  it('does not collapse unrelated rules or differently titled issues', () => {
    expect(groupFindings([finding('a'), finding('b', { title: '[cq-long-function] too long' }), finding('c', { category: 'security' }), finding('d', { verifier: 'model' }), finding('e', { verifier: 'model', title: 'Ownership check missing' })])).toHaveLength(3);
  });
  it('folds a rule issue into the model issue that reports the same lines, keeping every occurrence', () => {
    const rule = (id: string, line: number) => finding(id, { title: '[sec-innerhtml] innerHTML assignment', category: 'security', severity: 'info', filePath: 'todo-app.html', lineNumber: line, location: { ruleId: 'sec-innerhtml' } });
    const model = finding('model', { verifier: 'model', title: 'Todo HTML Injection', category: 'security', severity: 'medium', filePath: 'todo-app.html', lineNumber: 131 });
    const groups = groupFindings([model, rule('r1', 131), rule('r2', 132)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Todo HTML Injection');
    expect(groups[0].members.map(item => item.id)).toEqual(['model', 'r1', 'r2']);
    expect(groupFindings([model, rule('r1', 131), rule('far', 300)])).toHaveLength(2);
  });
  it('preserves every structured readiness reference and does not invent a code location', () => {
    const value = finding('a', { filePath: '', artifactId: null, relatedSources: [{ filePath: 'a.md', relation: 'requirement', excerpt: 'vague text' }, { filePath: 'b.md', relation: 'document' }] });
    expect(findingSourceReferences(value)).toEqual(value.relatedSources);
    expect(findingSourceReferences(finding('missing', { filePath: '', artifactId: null }))).toEqual([]);
  });
  it('groups explicitly named race risks and retains all interacting source segments', () => {
    const a = finding('a', { title: 'Race condition in payment submission', location: { domain: 'technical', relatedLocations: [{ filePath: 'worker.ts', lineNumber: 12, evidence: 'insertPayment();', sourceVersion: 'v1' }] } });
    const b = finding('b', { title: 'Concurrent callback issue', verifier: 'model', location: { issueType: 'race_condition', domain: 'security' } });
    const groups = groupFindings([a,b]);
    expect(groups).toHaveLength(1); expect(groups[0].title).toBe('Race Condition Risk');
    expect(findingSourceReferences(a)).toContainEqual(expect.objectContaining({ filePath: 'worker.ts', lineNumber: 12, excerpt: 'insertPayment();' }));
    expect(groupFindings([a, { ...a, id: 'readiness', verifier: 'readiness' }])).toHaveLength(2);
  });
  it('collapses the same issue re-detected across Reviews into one distinct issue without dropping rows', () => {
    const ownership = (id: string, sessionId: string, line: number, extra: Partial<Finding> = {}) => finding(id, { sessionId, verifier: 'model', category: 'security', title: 'Order Ownership Check Missing', filePath: 'server/orders.js', lineNumber: line, ...extra });
    const rows = [
      ownership('o1', 'r1', 40), ownership('o2', 'r2', 42, { title: 'Order ownership check missing.', location: { domain: 'business' } }),
      ownership('o3', 'r3', 44, { status: 'fixed' }), ownership('o4', 'r4', 41),
      ownership('far', 'r4', 120), ownership('other-file', 'r4', 40, { filePath: 'server/admin.js' }),
    ];
    const groups = groupFindings(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(6);
    expect(groups[0].issues.map(issue => issue.occurrences.map(item => item.id))).toEqual([['o1', 'o2', 'o3', 'o4'], ['far'], ['other-file']]);
    expect(rows[2].status).toBe('fixed');
    expect(groupStatus(groups[0])).toBe('Unresolved');
    expect(findingCountSummary(rows)).toBe('1 issue type · 3 flagged items · 6 occurrences');
    expect(groupOccurrenceSummary(groups[0])).toBe('3 affected locations · 6 occurrences');
  });
  it('collapses the same rule twice in one Review and keeps differing types apart at one place', () => {
    const a = finding('q1', { verifier: 'model', title: 'Quantity not validated', location: { issueType: 'input_validation' }, filePath: 'cart.js', lineNumber: 10 });
    const b = finding('q2', { verifier: 'model', title: 'Cart quantity accepts negatives', location: { issueType: 'input_validation' }, filePath: 'cart.js', lineNumber: 12 });
    const c = finding('x', { verifier: 'model', title: 'Price read from client', filePath: 'cart.js', lineNumber: 11 });
    const issues = distinctFindingIssues([c, a, b]);
    expect(issues.map(issue => [issue.representative.id, issue.occurrences.length])).toEqual([['x', 1], ['q1', 2]]);
    expect(findingCountSummary([a])).toBe('1 issue type · 1 flagged item');
    expect(groupOccurrenceSummary(groupFindings([a])[0])).toBeNull();
    expect(groupOccurrenceSummary(groupFindings([a, b])[0])).toBe('2 occurrences');
  });
  it('keeps document findings without a file apart by requirement', () => {
    const gap = (id: string, requirementId: string) => finding(id, { filePath: '', lineNumber: null, evidenceGap: { assessmentId: 'a', code: 'traceability_mappings_incomplete' }, requirementId, title: 'Mapping missing' });
    expect(groupFindings([gap('g1', 'R1'), gap('g2', 'R1'), gap('g3', 'R2')])[0].issues.map(issue => issue.occurrences.length)).toEqual([2, 1]);
  });
  it('counts requirement gaps and readiness notes apart from flagged code items', () => {
    const gap = (id: string, requirementId: string) => finding(id, { filePath: '', lineNumber: null, evidenceGap: { assessmentId: 'a', code: 'traceability_mappings_incomplete' }, requirementId, title: 'Incomplete Requirement Coverage' });
    const rows = [
      finding('c1', { verifier: 'model', title: 'Missing Order Ownership Check', filePath: 'server.js', lineNumber: 76 }),
      ...Array.from({ length: 21 }, (_, index) => gap(`g${index}`, `R${index}`)),
      finding('ready', { verifier: 'readiness', evidenceGap: { assessmentId: 'r', code: 'scope' }, title: 'Project scope coverage is incomplete', filePath: 'README.md', lineNumber: null }),
    ];
    expect(findingCountSummary(rows)).toBe('1 issue type · 1 flagged item · 21 evidence gaps · 1 readiness note');
  });
  it('merges differently worded or typed re-detections at one place, as seen in the Sample Shop runs', () => {
    const model = (id: string, sessionId: string, title: string, filePath: string, lineNumber: number, issueType?: string) => finding(id, { sessionId, verifier: 'model', category: 'security', title, filePath, lineNumber, location: issueType ? { issueType } : {} });
    const rows = [
      model('e1', 'r1', 'Credential Error Enables Email Enumeration', 'server.js', 45, 'account_enumeration'),
      model('e2', 'r2', 'Account Enumeration via Distinct Sign-in Error', 'server.js', 45),
      model('e3', 'r2', 'Credential Enumeration', 'server.js', 45, 'credential_enumeration'),
      model('q1', 'r1', 'Server-Side Quantity Validation Missing', 'server.js', 65),
      model('q2', 'r2', 'Missing Server-Side Quantity Validation', 'server.js', 65, 'quantity_bounds'),
      model('q3', 'r2', 'Missing Server-Side Quantity Validation', 'README.md', 29),
      model('d1', 'r1', 'Unsupported Discount Variants Accepted', 'src/orders.js', 24, 'case_insensitive_discount'),
      model('d2', 'r2', 'Unsupported Discount Variants Accepted', 'src/orders.js', 25, 'unsupported_discount_accepted'),
      model('o1', 'r2', 'Order Ownership Check Missing', 'server.js', 76),
      model('x', 'r2', 'Price Read From Client', 'server.js', 66),
    ];
    const groups = groupFindings(rows);
    expect(groups.map(group => group.members.map(item => item.id))).toEqual([['e1', 'e2', 'e3'], ['q1', 'q2', 'q3'], ['d1', 'd2'], ['o1'], ['x']]);
    expect(groups[1].issues.map(issue => issue.occurrences.length)).toEqual([2, 1]);
    expect(findingCountSummary(rows)).toBe('5 issue types · 6 flagged items · 10 occurrences');
  });
  it('does not merge rule-engine or readiness types into model issues by title similarity', () => {
    const rule = finding('r', { title: '[cq-console-log] console logging', location: { ruleId: 'cq-console-log' }, filePath: 'server.js', lineNumber: 107 });
    const model = finding('m', { verifier: 'model', title: 'Console logging leaks order data', filePath: 'server.js', lineNumber: 140 });
    const readiness = finding('ready', { verifier: 'readiness', title: 'Console logging leaks order data', filePath: 'server.js', lineNumber: 140 });
    expect(groupFindings([model, rule, readiness])).toHaveLength(3);
  });
});
