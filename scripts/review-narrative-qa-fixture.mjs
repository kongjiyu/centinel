// Browser-only synthetic QA. All API and auth traffic stays intercepted.
import { installConnectionReviewFixture } from './connection-review-qa-fixture.mjs';

export async function installReviewNarrativeFixture(context) {
  const state = await installConnectionReviewFixture(context);
  const timestamp = '2026-10-18T08:00:00Z';
  state.project.name = 'Observer acceptance — QA fixture';
  Object.assign(state.session, {
    name: 'Observer N1–N5 acceptance — QA fixture', status: 'pending_approval',
    configJson: JSON.stringify({ instructions: 'Assess N1–N5 against the supplied Observer parser and tests at the frozen revision. Preserve content hierarchy, punctuation, and ordinary uppercase details. Reject malformed structure before persistence. Verify persistence and cursor atomicity. Report evidence-backed defects with source locations and requirement links. Distinguish code inspection from runtime verification.' }),
    progressJson: JSON.stringify({ stage: 'complete', completedStages: ['freezing_sources', 'indexing_context', 'deterministic_analysis', 'model_analysis', 'persisting_evidence'], updatedAt: timestamp }),
    finalSummary: 'Static review completed with 2 findings.',
  });
  const stages = ['freezing_sources', 'indexing_context', 'deterministic_analysis', 'model_analysis', 'persisting_evidence'];
  const events = [];
  let elapsed = 0;
  const step = (stage, name, input = {}, output = {}) => {
    const durationMs = name === 'run_model' ? 35000 : 1000;
    const startedAt = new Date(Date.parse(timestamp) + elapsed).toISOString();
    elapsed += durationMs;
    const completedAt = new Date(Date.parse(timestamp) + elapsed).toISOString();
    for (const [event, createdAt, detail] of [['started', startedAt, { input }], ['completed', completedAt, { output, durationMs }]]) events.push({ reviewId: state.session.id, stage, event: `harness_step_${event}`, createdAt, detail: { step: name, executionId: `${stage}:${name}`, ...detail } });
  };
  step(stages[0], 'read_source', { artifactId: 'observer-parser', fileName: 'packages/@n8n/ai-workflow-builder/src/observer/parser.ts' }, { hashChecked: true });
  step(stages[0], 'load_grounding', {}, { confirmedRequirements: 0 });
  step(stages[1], 'index_sources');
  step(stages[1], 'retrieve_context');
  step(stages[2], 'check_rule', { artifactId: 'observer-parser', ruleId: 'security-secret', ruleName: 'Do not expose credentials in source' }, { findingCount: 1 });
  step(stages[3], 'resolve_provider', {}, { provider: 'Configured provider', model: 'QA model' });
  step(stages[3], 'run_model');
  events.push({ reviewId: state.session.id, stage: stages[3], event: 'model_attempt', createdAt: timestamp, detail: { outcome: 'success' } });
  step(stages[4], 'validate_locations', {}, { rejectedLocations: 0 });
  step(stages[4], 'save_findings');
  const finding = { projectId: state.project.id, sessionId: state.session.id, source: 'static', severity: 'medium', priority: 'Medium', status: 'new', createdAt: timestamp, artifactId: 'observer-parser', confidence: 'medium', fromRemarks: false, filePath: 'packages/@n8n/ai-workflow-builder/src/observer/parser.ts', lineNumber: 31 };
  state.findings = [
    { ...finding, id: 'fixture-security', verifier: 'deterministic', title: 'Credential-like fixture requires context', category: 'Security', description: 'The recorded source rule identified a credential-like value. Confirm whether it is a test fixture before treating it as a defect.', evidenceText: 'Synthetic QA evidence: credential-shaped test value on line 31.', recommendation: 'Verify the value is synthetic and dismiss it with a rationale if appropriate.' },
    { ...finding, id: 'fixture-business', verifier: 'model', title: 'Malformed input may reach persistence', category: 'Business logic', description: 'The recorded assessment links malformed input handling to the persistence boundary. Confirm the rejection rule and compare the parser evidence.', evidenceText: 'Synthetic QA evidence: parser branch and persistence boundary.', recommendation: 'Confirm N3 and add a targeted malformed-input regression check.' },
  ];
  state.historyUnavailable = false;
  await context.route('http://localhost:37701/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fallback();
    let json;
    if (path.endsWith('/static-sessions')) json = [state.session];
    else if (path.endsWith('/harness')) {
      if (state.historyUnavailable) return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable history' }, headers: { 'access-control-allow-origin': '*' } });
      json = { workflow: { version: 'QA', reference: '', stages: stages.map(id => ({ id, label: id, steps: [] })) }, review: { id: state.session.id, name: state.session.name, status: state.session.status, modelStatus: 'succeeded', progress: JSON.parse(state.session.progressJson), updatedAt: timestamp }, events };
    } else if (path.endsWith('/findings')) json = state.findings;
    else if (path.endsWith('/decisions')) json = [];
    else if (path.endsWith('/correlations')) return route.fulfill({ status: 404, json: { error: 'Not an iteration' }, headers: { 'access-control-allow-origin': '*' } });
    else if (path.endsWith('/sources')) json = [];
    else if (path.endsWith('/source-manifest')) json = { sessionId: state.session.id, projectId: state.project.id, status: 'unavailable', sources: [], artifactCount: null };
    else if (path.endsWith('/traceability')) json = { sessionId: state.session.id, projectId: state.project.id, status: 'available', records: [], summary: { missing: 0, incomplete: 0, complete: 0, attention: 0 } };
    else if (path.endsWith('/evidence-sufficiency')) json = { id: 'qa-assessment', projectId: state.project.id, reviewId: state.session.id, reviewType: 'code_review', readiness: 'ready_with_warnings', confirmedRequirementCount: 0, gaps: [], contradictions: [], artifactCount: 1, availableArtifactCount: 1, staleArtifactCount: 0, enabledStandardRuleCount: 1, assessedAt: timestamp };
    else if (path.endsWith('/model-usage')) json = { totals: { input: 1000, output: 200, cacheRead: 0, cacheCreation: 0, calls: 1 }, byGroup: [], recent: [] };
    else return route.fallback();
    state.requests.push({ path, method: route.request().method() });
    return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  return state;
}
