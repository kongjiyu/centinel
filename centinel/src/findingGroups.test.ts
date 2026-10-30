import { describe, expect, it } from 'vitest';
import { findingSourceReferences, groupFindings, groupStatus } from './findingGroups';
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
});
