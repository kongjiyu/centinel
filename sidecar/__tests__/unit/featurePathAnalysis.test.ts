import { describe, expect, it } from 'vitest';
import { deriveReviewAnalysisMap, applyFeatureDomainAssessments, linkFindingToAnalysis } from '../../src/review/featurePathAnalysis.js';
import type { EvidenceArtifact } from '../../src/review/evidenceSufficiency.js';

function source(content: string, filePath = 'src/account.ts'): EvidenceArtifact {
  return { artifact: { id: filePath, projectId: 'project', type: 'source_code', source: 'repository', fileName: filePath, filePath, originalPath: null, contentHash: 'frozen-version', createdAt: '2026-10-20T00:00:00Z' }, content };
}

describe('bounded feature and path analysis', () => {
  it('extracts normal, alternate, failure and recovery paths without claiming semantic assessment', () => {
    const map = deriveReviewAnalysisMap([source(`app.delete('/account', async function remove(req, res) {
      if (!req.confirmed) return res.status(409);
      try { await erase(req.id); } catch (error) { return res.status(503); }
      return res.status(204);
    });`)]);
    expect(map.features).toHaveLength(1);
    expect(map.features[0].paths.map(path => path.kind)).toEqual(expect.arrayContaining(['normal', 'alternate', 'failure', 'recovery']));
    expect(map.features[0].assessments.map(item => item.domain)).toEqual(['security', 'business', 'technical', 'personnel']);
    expect(map.features[0].assessments.every(item => item.status === 'unverified')).toBe(true);
    expect(map.coverage).toMatchObject({ parsedArtifacts: 1, exhaustive: false });
    expect(map.coverage.unresolvedEdgeCount).toBeGreaterThan(0);
  });
  it('resolves named and inline UI handlers instead of the enclosing component', () => {
    const map = deriveReviewAnalysisMap([source(`const remove = () => { throw Error('failure'); };
      function Screen() { return <button onClick={remove}>Delete</button>; }`, 'src/Screen.tsx')]);
    expect(map.features[0].paths.some(path => path.kind === 'failure')).toBe(true);
    expect(map.features[0].entryPoints.some(ref => ref.lineNumber === 1)).toBe(true);
  });
  it('does not interpret Map.get as a route or JSON nesting as control flow', () => {
    expect(deriveReviewAnalysisMap([source(`const value = map.get('a');`)]).features).toEqual([]);
    const map = deriveReviewAnalysisMap([source('{"nested":{"nested":{"value":true}}}', 'package.json')]);
    expect(map.features).toEqual([]);
    expect(map.coverage.unsupportedArtifacts).toHaveLength(1);
  });
  it('maps the final route handler and discloses unexpanded middleware', () => {
    const map = deriveReviewAnalysisMap([source("function auth() { return true; } function remove() { throw Error(); } app.delete('/account', auth, remove);")]);
    expect(map.features[0].paths.some(path => path.kind === 'failure')).toBe(true);
    expect(map.features[0].unresolved.some(item => item.reason.includes('Middleware order'))).toBe(true);
  });
  it('retains unsupported, unreadable and syntactically invalid sources as unverified coverage', () => {
    const unavailable = source('export function f() {}', 'unreadable.ts'); delete unavailable.content;
    const map = deriveReviewAnalysisMap([source('def f(): pass', 'file.py'), unavailable, source('export function {', 'invalid.ts')]);
    expect(map.features).toEqual([]);
    expect(map.coverage.unsupportedArtifacts).toHaveLength(3);
    expect(map.status).toBe('unverified');
  });
  it('bounds features and discloses the omitted entry points', () => {
    const map = deriveReviewAnalysisMap([source(Array.from({ length: 35 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'))]);
    expect(map.features).toHaveLength(30);
    expect(map.coverage.limitations.some(item => item.includes('5 additional'))).toBe(true);
  });
  it('accepts only exact feature evidence and strips forged finding links', () => {
    const initial = deriveReviewAnalysisMap([source('export function remove() { throw Error(); }')]);
    const feature = initial.features[0]; const ref = feature.entryPoints[0];
    const map = applyFeatureDomainAssessments(initial, { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'personnel', status: 'assessed', outcome: 'potential_gap', summary: 'Recovery requires confirmation.', evidence: [ref] },
      { domain: 'security', status: 'assessed', outcome: 'no_issue_identified', summary: 'Invented evidence', evidence: [{ ...ref, sourceVersion: 'other-version' }] },
    ] }] });
    expect(map.status).toBe('partial');
    expect(map.features[0].assessments.find(item => item.domain === 'security')?.status).toBe('unverified');
    const finding = { artifactId: ref.artifactId, filePath: ref.filePath, lineNumber: ref.lineNumber,
      sourceLocator: { analysis: { featureId: feature.id, pathId: feature.paths[0].id, domain: 'personnel' } } };
    expect(linkFindingToAnalysis(finding, map).sourceLocator).toMatchObject(finding.sourceLocator);
    expect(linkFindingToAnalysis({ ...finding, artifactId: 'other' }, map).sourceLocator).toEqual({});
    expect(linkFindingToAnalysis({ ...finding, sourceLocator: { analysis: { ...finding.sourceLocator.analysis, featureId: 'invented' } } }, map).sourceLocator).toEqual({});
    const invalidRows = { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'security', status: 'assessed', outcome: 'no_issue_identified', summary: 'Incomplete evidence', evidence: [ref, { ...ref, artifactId: 'invented' }] },
      { domain: 'technical', status: 'assessed', outcome: 'no_issue_identified', summary: '', evidence: [ref] },
    ] }] };
    expect(applyFeatureDomainAssessments(initial, invalidRows).status).toBe('unverified');
    expect(applyFeatureDomainAssessments(initial, { featureAssessments: [invalidRows.featureAssessments[0], invalidRows.featureAssessments[0]] }).status).toBe('unverified');
  });
});
