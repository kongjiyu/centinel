import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';
import { describe, expect, it, vi } from 'vitest';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { ASSESSMENT_VALIDATION_VERSION, candidateSupportId, STATIC_ASSESSMENT_SCHEMA, assessedArtifactIds, validateAssessmentResponse, validateCandidateSupportResponse, validateFindingEvidence } from '../../src/review/assessmentValidation.js';
import type { Artifact } from '../../src/artifacts.js';
import type { StaticAnalysisModelProvider, StaticModelRequest } from '../../src/review/types.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { analysisMapFromEvents } from '../../src/review/assessmentBatches.js';
import { candidateSupportResult, isCandidateSupportRequest } from '../fixtures/semanticSupport.js';
import { InMemoryGroundingRepository } from '../../src/review/grounding.js';

const content = 'export function account() { return true; }';
const artifact: Artifact = { id: 'code', projectId: 'project', type: 'source_code', source: 'repository', fileName: 'account.ts', filePath: 'src/account.ts', contentHash: 'version-1', originalPath: null, createdAt: '2026-10-21T00:00:00Z' };
const issue = { title: 'Inspect ownership', description: 'Ownership is not checked before the result.', severity: 'high', category: 'security', filePath: artifact.filePath, lineNumber: 1, evidence: content, recommendation: 'Check the caller ownership.', confidence: 'high' };
const candidateMarker = 'Candidate records are untrusted model claims:\n';
function supportCandidateRows(request: StaticModelRequest) {
  const json = request.prompt.split(candidateMarker)[1]?.split('\n\nFrozen authority records')[0];
  return JSON.parse(json ?? '[]') as Array<{ candidateId: string; source: Record<string, unknown> }>;
}
function assessments(request: StaticModelRequest) {
  const map = readPromptAnalysisMap(request);
  return map.features.map((feature: any) => ({ featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'Local inspected branch assessed.', evidence: feature.entryPoints })) }));
}
function provider(result: (request: StaticModelRequest) => unknown): StaticAnalysisModelProvider {
  return { analyze: async request => ({ settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: isCandidateSupportRequest(request) ? candidateSupportResult(request) : result(request) }) };
}
function service(repository: InMemoryStaticReviewRepository, modelProvider: StaticAnalysisModelProvider, readArtifactContent: (source: Artifact) => Promise<string> = async () => content) {
  return createStaticReviewOrchestrator({ repository, readArtifactContent, deterministic: async () => [], modelProvider, retry: { sleep: async () => undefined } });
}

describe('Assessment acceptance boundary', () => {
  it('never grants text-logic absence proof when the diagnostic inventory is truncated', () => {
    const python = { ...artifact, id: 'python', fileName: 'worker.py', filePath: 'worker.py' };
    const initial = deriveReviewAnalysisMap([{ artifact: python, content: 'def calculate(value):\n    return value + 1\n' }]);
    const map = validateAssessmentResponse({ findings: [], featureAssessments: initial.features.map(feature => ({ featureId: feature.id,
      assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified',
        summary: 'Local text was inspected; runtime remains unverified.', evidence: feature.entryPoints })) })) }, initial);
    expect(map.status).toBe('assessed');
    map.coverage.unsupportedArtifacts = []; map.coverage.unsupportedArtifactsTruncated = true;
    expect(assessedArtifactIds(map)).toEqual([]);
  });
  it('withholds absence proof for external callback boundaries while retaining local proof eligibility', () => {
    const initial = deriveReviewAnalysisMap([{ artifact, content }]);
    const map = validateAssessmentResponse({ findings: [], featureAssessments: initial.features.map(feature => ({ featureId: feature.id,
      assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified',
        summary: 'The selected local path was inspected.', evidence: feature.entryPoints })) })) }, initial);
    expect(assessedArtifactIds(map)).toEqual([artifact.id]);

    map.features[0]!.entryPointStatus = 'external_boundary';
    map.coverage.unsupportedArtifacts = [];
    map.coverage.unsupportedArtifactsTruncated = true;
    expect(assessedArtifactIds(map)).toEqual([]);
  });
  it.each(['featureInventoryTruncated','selectedModuleGraphTruncated','exportExpansionTruncatedCount'] as const)('withholds resolution proof when %s reports omitted scope', key => {
    const initial=deriveReviewAnalysisMap([{artifact,content}]);
    const map=validateAssessmentResponse({findings:[],featureAssessments:initial.features.map(feature=>({featureId:feature.id,
      assessments:['security','business','technical','personnel'].map(domain=>({domain,status:'assessed',outcome:'no_issue_identified',summary:'Bounded fixture checked.',evidence:feature.entryPoints}))}))},initial);
    expect(assessedArtifactIds(map)).toEqual([artifact.id]);
    (map.coverage as any)[key]=key==='exportExpansionTruncatedCount'?1:true;
    expect(assessedArtifactIds(map)).toEqual([]);
  });
  it('sends a closed strict-output schema while retaining nullable grounding and feature links', () => {
    const inspect = (schema: any) => {
      if (schema?.type === 'object' || schema?.type?.includes?.('object')) {
        expect(schema.additionalProperties).toBe(false);
        expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
        Object.values(schema.properties).forEach(inspect);
      }
      if (schema?.items) inspect(schema.items);
    };
    inspect(STATIC_ASSESSMENT_SCHEMA);
    const finding = (STATIC_ASSESSMENT_SCHEMA.properties.findings as any).items;
    expect(finding.properties.requirementId.type).toContain('null');
    expect(finding.properties.standardRuleId.type).toContain('null');
    expect(finding.properties.sourceLocator.properties.analysis.properties).toHaveProperty('featureId');
    expect(finding.properties.relatedLocations.items.required).toContain('sourceVersion');
    const domainRows = (STATIC_ASSESSMENT_SCHEMA.properties.featureAssessments as any).items.properties.assessments;
    expect(domainRows).toMatchObject({ minItems: 4, maxItems: 4 });
    expect(domainRows.items.properties.summary).toMatchObject({ minLength: 1 });
    expect(domainRows.items.properties.status.enum).toContain('unverified');
  });
  it.each([null, [], {}, { message: 'cannot finish' }, { findings: [] }, { findings: 'none', featureAssessments: [] }])('fails invalid shape without clean success or correlations (%j)', async result => {
    const repository = new InMemoryStaticReviewRepository();
    const runner = service(repository, provider(() => result));
    const run = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(repository.findings).toHaveLength(0);
    expect(repository.findingCorrelations.size).toBe(0);
    expect(repository.audits.find(event => event.event === 'review_assessment_rejected')?.detail).toMatchObject({ reason: 'response_shape' });
  });
  it('does not resolve a prior issue after malformed changed-source output', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const first = await service(repository, provider(request => ({ findings: [issue], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'first' });
    expect((await first.completion).status).toBe('pending_approval');
    const second = await service(repository, provider(() => ({ message: 'cannot finish' }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [{ ...artifact, contentHash: 'version-2' }], idempotencyKey: 'second' });
    expect((await second.completion).status).toBe('failed');
    expect(repository.findingCorrelations.has(second.review.id)).toBe(false);
    expect(repository.findings).toHaveLength(1);
  });
  it.each([{ filePath: 'missing.ts', lineNumber: 999 }, { evidence: 'invented source text' }, { sourceVersion: 'wrong-version' }, { artifactId: 'wrong-artifact' }])('retains unsupported observations only with explicit verification flags (%j)', async overrides => {
    const repository = new InMemoryStaticReviewRepository();
    const run = await service(repository, provider(request => ({ findings: [{ ...issue, severity: 'critical', ...overrides }], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(repository.findings).toHaveLength(1);
    expect(repository.findings[0].sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
    expect(repository.evidenceAssessments.get(run.review.id)?.gaps.some(gap => gap.code === 'model_assessment_invalid')).toBe(true);
  });
  it('rejects a title-only observation rather than inventing Medium risk', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const run = await service(repository, provider(request => ({ findings: [{ title: 'Placeholder' }], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('failed');
    expect(repository.findings).toHaveLength(0);
  });
  it('does not retain source-valid but unchallenged siblings when another observation has invalid shape', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const run = await service(repository, provider(request => ({ findings: [issue, { title: 'Malformed sibling' }], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial', modelFindingCount: 0 });
    expect(repository.findings).toHaveLength(0);
    expect(repository.findingCorrelations.size).toBe(0);
  });
  it('still fails terminally when partial evidence persistence fails', async () => {
    const repository = new InMemoryStaticReviewRepository();
    vi.spyOn(repository, 'saveFinding').mockRejectedValue(new Error('private persistence detail'));
    const run = await service(repository, provider(request => ({ findings: [issue], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial', modelFindingCount: 0 });
    expect((await run.completion).failureReason).toContain('could not be saved');
    expect(JSON.stringify(await run.completion)).not.toContain('private persistence detail');
  });
  it('does not claim code review completion when no feature scope was recognized', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const model=provider(() => ({ findings: [], featureAssessments: [] }));
    const analyze=vi.spyOn(model,'analyze');
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: async () => 'const localValue = initializeUnknownRuntime();', deterministic: async () => [], modelProvider: model });
    const run = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(repository.findingCorrelations.size).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('blocks competing direct export bodies before provider access or resolution proof', async () => {
    const repository=new InMemoryStaticReviewRepository();
    const model=provider(request=>({findings:[],featureAssessments:assessments(request)}));
    const analyze=vi.spyOn(model,'analyze');
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async()=>
      'export function same(){return 1;} export function same(){throw new Error("hidden");}',deterministic:async()=>[],modelProvider:model});
    const run=await runner.start({projectId:'project',reviewType:'code_review',artifacts:[artifact]});
    expect(await run.completion).toMatchObject({status:'blocked',modelStatus:'not_requested'});
    expect(analyze).not.toHaveBeenCalled();
    expect(repository.audits.some(event=>event.event==='review_assessment_validated')).toBe(false);
    expect(repository.findingCorrelations.size).toBe(0);
  });
  it('bounds JSON repair within the shared budget without switching to fallback', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let calls = 0, fallbackCalls = 0;
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: async () => content, deterministic: async () => [],
      modelProvider: { analyze: async () => { calls++; throw new ModelProviderError('private payload', { code: 'malformed_response', malformed: true, retryable: true }); } },
      fallbackModelProvider: { analyze: async () => { fallbackCalls++; throw new Error('must not run'); } },
      retry: { sleep: async () => undefined },
    });
    const run = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('failed');
    expect(calls).toBe(4); // two bounded malformed attempts in each independent batch
    expect(new Set(repository.attempts.map(attempt => attempt.stage)).size).toBe(2);
    expect(fallbackCalls).toBe(0);
    expect(JSON.stringify(repository.audits)).not.toContain('private payload');
  });
  it('keeps explicitly unverified domain coverage out of approval and resolution', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const run = await service(repository, provider(request => ({ findings: [], featureAssessments: assessments(request).map((row: any) => ({ ...row, assessments: row.assessments.map((item: any) => ({ ...item, status: 'unverified', outcome: 'unverified', evidence: [] })) })) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(repository.findingCorrelations.size).toBe(0);
  });
  it('bounds local coverage repairs and continues later batches without clean completion', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const source = [content, ...Array.from({ length: 8 }, (_, index) => `export function extra${index}() { return true; }`)].join('\n');
    const stages: string[] = [];
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: async () => source, deterministic: async () => [],
      retry: { sleep: async () => undefined }, modelProvider: provider(request => {
        stages.push(request.stage);
        return { findings: stages.length === 1 ? [issue] : [], featureAssessments: assessments(request).map((row: any) => ({ ...row,
          assessments: row.assessments.map((item: any) => ({ ...item, status: 'unverified', outcome: 'unverified', summary: 'Selected local evidence is insufficient.', evidence: [] })),
        })) };
      }),
    });
    const run = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(stages).toHaveLength(7); // three attempts in each feature batch, then one independent sweep
    expect(new Set(stages).size).toBe(3);
    expect(repository.audits.filter(event => event.event === 'review_batch_needs_verification')).toHaveLength(2);
    const saved = repository.audits.filter(event => event.event === 'review_analysis_batch_saved');
    expect(saved).toHaveLength(1);
    expect(saved[0].detail?.features).toEqual([]); // the independent source sweep completed
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
    expect(repository.findings.some(finding => finding.title === issue.title && finding.source === 'model')).toBe(false);
    expect(repository.findingCorrelations.size).toBe(0);
    const retained = analysisMapFromEvents(repository.audits);
    expect(retained?.features[0].assessments[0]).toMatchObject({ status: 'unverified', summary: 'Selected local evidence is insufficient.' });
  });
  it.each(['credits_exhausted', 'provider_unavailable'])('retains validated partial findings and honest coverage when repair stops at %s', async code => {
    const repository = new InMemoryStaticReviewRepository();
    let calls = 0;
    const run = await service(repository, provider(request => {
      calls++;
      if (calls > 1) throw new ModelProviderError('Safe synthetic stop.', { code, retryable: false });
      return { findings: [issue], featureAssessments: assessments(request).map((row: any) => ({ ...row,
        assessments: row.assessments.map((item: any) => ({ ...item, status: 'unverified', outcome: 'unverified', summary: 'Selected local evidence is insufficient.', evidence: [] })),
      })) };
    })).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe(code === 'credits_exhausted' ? 'blocked' : 'failed');
    expect(calls).toBe(2);
    expect(repository.findings.some(finding => finding.title === issue.title && finding.source === 'model')).toBe(false);
    expect(analysisMapFromEvents(repository.audits)?.features[0].assessments[0]).toMatchObject({ status: 'unverified', summary: 'Selected local evidence is insufficient.' });
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
    expect(repository.findingCorrelations.size).toBe(0);
  });
  it('accepts an honestly repaired local assessment without changing external-path limitations', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let calls = 0;
    const schemaSizes: number[] = [];
    const run = await service(repository, provider(request => {
      calls++;
      schemaSizes.push(JSON.stringify(request.outputSchema).length);
      const rows = assessments(request);
      if (calls === 1) {
        expect(request.outputSchema).not.toHaveProperty('$defs');
        return { findings: [], featureAssessments: rows.map((row: any) => ({ ...row,
        assessments: row.assessments.map((item: any) => ({ ...item, status: 'unverified', outcome: 'unverified', summary: 'MODEL_ONLY_LIMITATION', evidence: [] })),
        })) };
      }
      if ((request.outputSchema?.properties?.featureAssessments as any)?.maxItems !== 0) {
        expect(request.outputSchema).toHaveProperty('$defs');
        expect(request.prompt).toContain('Bounded local domain coverage repair');
        expect(request.prompt).toContain('local_domain_unverified');
        expect(request.prompt).not.toContain('MODEL_ONLY_LIMITATION');
      }
      return { findings: [], featureAssessments: rows };
    })).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded' });
    expect(calls).toBe(3);
    expect(repository.attempts.find(attempt => attempt.usageContext?.phase === 'initial_analysis')?.usageContext?.components?.schemaCharacters).toBe(schemaSizes[0]);
    expect(repository.attempts.find(attempt => attempt.usageContext?.phase === 'domain_repair')?.usageContext?.components?.schemaCharacters).toBe(schemaSizes[1]);
    const repair = repository.audits.find(event => event.event === 'review_assessment_repair_scheduled');
    expect(repair?.detail?.coverageFeedback).toHaveLength(4);
    expect(analysisMapFromEvents(repository.audits)?.status).toBe('assessed');
    const final = repository.audits.filter(event => event.event === 'review_analysis_map_saved').at(-1);
    expect(final?.detail?.analysisMap).toMatchObject({ coverage: { exhaustive: false } });
  });
  it('retains validated feature links through sanitation and persistence', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let link: unknown;
    const run = await service(repository, provider(request => {
      const rows = assessments(request);
      const map = readPromptAnalysisMap(request);
      if (!map.features.length) return { findings: [], featureAssessments: rows };
      link = { featureId: map.features[0].id, pathId: map.features[0].paths[0].id, domain: 'security' };
      return { findings: [{ ...issue, sourceLocator: { forged: 'discard', analysis: link } }], featureAssessments: rows };
    })).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('pending_approval');
    expect(repository.findings[0].sourceLocator).toMatchObject({ analysis: link, citationEvidence: { verification: 'verified' } });
    expect(repository.findings[0].sourceLocator).not.toHaveProperty('forged');
  });
  it('accepts a valid empty result and records bounded versioned resolution proof', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const first = await service(repository, provider(request => ({ findings: [issue], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'first' });
    await first.completion;
    const second = await service(repository, provider(request => ({ findings: [], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [{ ...artifact, contentHash: 'version-2' }], idempotencyKey: 'second' });
    expect((await second.completion).status).toBe('pending_approval');
    expect(repository.findingCorrelations.get(second.review.id)?.correlations[0]).toMatchObject({ classification: 'resolved', resolutionEligibility: { version: 2, assessmentValidationVersion: ASSESSMENT_VALIDATION_VERSION } });
  });
  it('cannot resolve an unassessed region of the same file from an assessed entry point', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const source = content + '\nconst unmappedHelper = true;';
    const runner = (withFinding: boolean) => createStaticReviewOrchestrator({ repository, readArtifactContent: async () => source, deterministic: async () => [],
      modelProvider: provider(request => ({ findings: withFinding ? [{ ...issue, lineNumber: 2, evidence: 'const unmappedHelper = true;' }] : [], featureAssessments: assessments(request) })),
    });
    const first = await runner(true).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'region-first' });
    await first.completion;
    const second = await runner(false).start({ projectId: 'project', reviewType: 'code_review', artifacts: [{ ...artifact, contentHash: 'version-2' }], idempotencyKey: 'region-second' });
    await second.completion;
    expect(repository.findingCorrelations.get(second.review.id)?.correlations[0]).toMatchObject({ classification: 'carried_over' });
    expect(repository.findingCorrelations.get(second.review.id)?.correlations[0].resolutionEligibility).toBeUndefined();
  });
  it('rejects duplicate domain coverage and invented assessed references', () => {
    const map = deriveReviewAnalysisMap([{ artifact, content }]);
    const featureId = map.features[0].id;
    const item = { domain: 'security', status: 'assessed', outcome: 'no_issue_identified', summary: 'Checked.', evidence: [] };
    expect(() => validateAssessmentResponse({ findings: [], featureAssessments: [{ featureId, assessments: [item, item, item, item] }] }, map)).toThrow();
    expect(() => validateAssessmentResponse({ findings: [], featureAssessments: [{ featureId, assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ ...item, domain, evidence: [{ artifactId: 'invented' }] })) }] }, map)).toThrow();
  });
  it('normalizes only line endings while requiring exact excerpt provenance', () => {
    const finding = { ...issue, source: 'model' as const, evidence: content + '\r\nsecond line', lineNumber: 1 };
    expect(validateFindingEvidence([finding], [{ artifact, content: content + '\nsecond line' }]).findings).toHaveLength(1);
  });
  it('validates exact candidate coverage and separates local support from missing call-path evidence', () => {
    const finding = { ...issue, source: 'model' as const, artifactId: artifact.id, sourceVersion: artifact.contentHash };
    const candidate = { candidateId: candidateSupportId('batch-1', finding), finding };
    const source = { artifact, content, lineStart: 1, lineEnd: content.split('\n').length };
    const ref = { role: 'sink', artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash, lineNumber: 1, evidence: content };
    const supported = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported', trigger: 'The local branch runs.', consequence: 'The return value is exposed.', references: [ref], authorityReferences: [], limitation: null }] }, [candidate], [source]);
    expect(supported).toMatchObject({ complete: true, records: [{ disposition: 'supported', claimBoundary: 'local_source' }] });
    const contradicted = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'contradicted', trigger: 'The branch is reached.', consequence: 'The alleged write does not occur.', references: [{ ...ref, role: 'guard' }], authorityReferences: [], limitation: null }] }, [candidate], [source]);
    expect(contradicted).toMatchObject({ complete: true, records: [{ disposition: 'contradicted' }] });
    const insufficient = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'selected_call_path', disposition: 'insufficient', trigger: 'The helper is called.', consequence: 'Application impact is not established.', references: [], authorityReferences: [], limitation: 'The selected caller is not in the packet.' }] }, [candidate], [source]);
    expect(insufficient).toMatchObject({ complete: true, records: [{ disposition: 'insufficient', claimBoundary: 'selected_call_path' }] });
    expect(candidateSupportId('batch-2', finding)).not.toBe(candidate.candidateId);
  });
  it('rejects missing, duplicate, unknown, changed-source and out-of-batch support references', () => {
    const finding = { ...issue, source: 'model' as const, artifactId: artifact.id, sourceVersion: artifact.contentHash };
    const candidate = { candidateId: candidateSupportId('batch-1', finding), finding };
    const source = { artifact, content, lineStart: 1, lineEnd: content.split('\n').length };
    const row = { candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported', trigger: 'trigger', consequence: 'consequence', references: [{ role: 'sink', artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash, lineNumber: 1, evidence: content }], authorityReferences: [], limitation: null };
    expect(validateCandidateSupportResponse({ candidates: [] }, [candidate], [source]).feedback).toContainEqual({ candidateIndex: 1, code: 'missing_candidate' });
    expect(validateCandidateSupportResponse({ candidates: [row, row] }, [candidate], [source]).feedback).toContainEqual({ candidateIndex: 1, code: 'duplicate_candidate' });
    const unknown = validateCandidateSupportResponse({ candidates: [row, { ...row, candidateId: 'untrusted-id' }] }, [candidate], [source]);
    expect(unknown.complete).toBe(false);
    expect(unknown.feedback).toContainEqual({ candidateIndex: 0, code: 'unknown_candidate' });
    const changed = validateCandidateSupportResponse({ candidates: [{ ...row, references: [{ ...row.references[0], evidence: 'altered source' }] }] }, [candidate], [source]);
    expect(changed.feedback).toContainEqual({ candidateIndex: 1, code: 'reference_invalid', referenceIndex: 1,
      sourceIndex: 1, lineNumber: 1, referenceFailure: 'excerpt_mismatch' });
    const foreignVersion = validateCandidateSupportResponse({ candidates: [{ ...row, references: [{ ...row.references[0], sourceVersion: 'new-version' }] }] }, [candidate], [source]);
    expect(foreignVersion.feedback).toContainEqual({ candidateIndex: 1, code: 'reference_invalid', referenceIndex: 1,
      referenceFailure: 'version_mismatch' });
    const outside = validateCandidateSupportResponse({ candidates: [row] }, [candidate], [{ ...source, lineStart: 2 }]);
    expect(outside.feedback).toContainEqual({ candidateIndex: 1, code: 'reference_outside_batch', referenceIndex: 1,
      referenceFailure: 'line_out_of_range' });
    const malformed = validateCandidateSupportResponse({ candidates: [{ ...row, references: [{ ...row.references[0], evidence: 'private rejected reference' }] }] }, [candidate], [source]);
    expect(JSON.stringify(malformed.feedback)).not.toContain('private rejected reference');
  });
  it('validates original line offsets in later segments and rejects excerpts crossing segment boundaries', () => {
    const first = { artifact, content: 'first line\nsecond line', lineStart: 1, lineEnd: 2 };
    const later = { artifact, content: 'third line\nfourth line', lineStart: 3, lineEnd: 4 };
    const finding = { ...issue, source: 'model' as const, artifactId: artifact.id, sourceVersion: artifact.contentHash, lineNumber: 3, evidence: 'third line' };
    const candidate = { candidateId: candidateSupportId('split-batch', finding), finding };
    const laterReference = { role: 'sink', artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash, lineNumber: 3, evidence: 'third line' };
    const valid = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported',
      trigger: 'The later source line executes.', consequence: 'The result is exposed.', references: [laterReference], authorityReferences: [], limitation: null }] }, [candidate], [first, later]);
    expect(valid).toMatchObject({ complete: true, records: [{ references: [{ lineNumber: 3, evidence: 'third line' }] }] });
    const laterOnly = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported',
      trigger: 'The later source line executes.', consequence: 'The result is exposed.', references: [laterReference], authorityReferences: [], limitation: null }] }, [candidate], [later]);
    expect(laterOnly.complete).toBe(true);
    const crossing = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported',
      trigger: 'The later source lines execute.', consequence: 'The result is exposed.', references: [{ ...laterReference, lineNumber: 2, evidence: 'second line\nthird line' }], authorityReferences: [], limitation: null }] }, [candidate], [first, later]);
    expect(crossing.feedback).toContainEqual({ candidateIndex: 1, code: 'reference_outside_batch', referenceIndex: 1,
      sourceIndex: 1, lineNumber: 2, referenceFailure: 'line_out_of_range' });
    const shifted = validateCandidateSupportResponse({ candidates: [{ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported',
      trigger: 'The cited line differs.', consequence: 'The result is exposed.', references: [{ ...laterReference, lineNumber: 4, evidence: 'third line' }], authorityReferences: [], limitation: null }] }, [candidate], [first, later]);
    expect(shifted.complete).toBe(false);
    expect(shifted.feedback).toContainEqual({ candidateIndex: 1, code: 'reference_invalid', referenceIndex: 1,
      sourceIndex: 2, lineNumber: 4, referenceFailure: 'excerpt_mismatch' });
  });
  it('requires exact confirmed-rule identity alongside source evidence for requirement-backed findings', () => {
    const authority = { kind: 'requirement' as const, id: 'confirmed-ownership', version: null, secondaryVersion: null, reviewedVersionId: null, reviewedContentHash: null,
      title: 'Record ownership', statement: 'The selected user must own the record.' };
    const finding = { ...issue, source: 'model' as const, artifactId: artifact.id, sourceVersion: artifact.contentHash, requirementId: authority.id };
    const candidate = { candidateId: candidateSupportId('batch-1', finding), finding };
    const source = { artifact, content, lineStart: 1, lineEnd: content.split('\n').length };
    const ref = { role: 'sink', artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash, lineNumber: 1, evidence: content };
    const row = { candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported', trigger: 'The local branch runs.',
      consequence: 'The source behavior violates the confirmed rule.', references: [ref], authorityReferences: [{
        kind: authority.kind, id: authority.id, version: authority.version, secondaryVersion: authority.secondaryVersion,
        reviewedVersionId: authority.reviewedVersionId, reviewedContentHash: authority.reviewedContentHash,
      }], limitation: null };
    expect(validateCandidateSupportResponse({ candidates: [row] }, [candidate], [source], [authority])).toMatchObject({ complete: true });
    expect(validateCandidateSupportResponse({ candidates: [{ ...row, authorityReferences: [] }] }, [candidate], [source], [authority]).feedback)
      .toContainEqual({ candidateIndex: 1, code: 'authority_reference_required' });
    expect(validateCandidateSupportResponse({ candidates: [{ ...row, authorityReferences: [{ ...row.authorityReferences[0], version: 'forged' }] }] }, [candidate], [source], [authority]).feedback)
      .toContainEqual({ candidateIndex: 1, code: 'authority_reference_invalid' });
  });
  it('keeps caller uncertainty as a limitation without failing otherwise-complete local assessment or granting absence proof', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let generationCalls = 0, supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: candidateSupportResult(request, { disposition: 'insufficient', boundary: 'selected_call_path' }) };
      }
      generationCalls++;
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { findings: [{ ...issue, domain: 'security' }], featureAssessments: assessments(request) } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded', modelFindingCount: 1 });
    expect(generationCalls).toBe(2);
    expect(supportCalls).toBe(2);
    const map = analysisMapFromEvents(repository.audits);
    expect(map?.status).toBe('assessed');
    expect(map?.features[0].assessments.find(item => item.domain === 'security')).toMatchObject({ status: 'assessed', outcome: 'potential_gap' });
    expect(repository.audits.find(event => event.event === 'review_candidate_support_limited')?.detail).toMatchObject({ limitationCode: 'selected_call_path_unavailable' });
    expect(repository.audits.find(event => event.event === 'review_assessment_validated')?.detail).toMatchObject({ coverageStatus: 'assessed', assessedArtifactIds: [] });
    expect(repository.findings).toHaveLength(1);
    expect(repository.findings[0].sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification', reason: 'support_unverified' });
  });
  it('excludes every related artifact in an insufficient runtime claim from absence proof', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const related = { ...artifact, id: 'related', fileName: 'related.ts', filePath: 'src/related.ts', contentHash: 'related-version' };
    const unaffected = { ...artifact, id: 'unaffected', fileName: 'unaffected.ts', filePath: 'src/unaffected.ts', contentHash: 'unaffected-version' };
    const artifacts = [artifact, related, unaffected];
    const finding = { ...issue, domain: 'security' as const, relatedLocations: [{
      artifactId: related.id, sourceVersion: related.contentHash, filePath: related.filePath, lineNumber: 1, evidence: content,
    }] };
    const model: StaticAnalysisModelProvider = { analyze: async request => ({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' },
      result: isCandidateSupportRequest(request)
        ? candidateSupportResult(request, { disposition: 'insufficient', boundary: 'runtime_dependent' })
        : { findings: [finding], featureAssessments: assessments(request) },
    }) };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts });
    expect((await run.completion).status).toBe('pending_approval');
    const validated = repository.audits.find(event => event.event === 'review_assessment_validated')?.detail?.assessedArtifactIds as string[];
    expect(validated).toContain(unaffected.id);
    expect(validated).not.toContain(artifact.id);
    expect(validated).not.toContain(related.id);
    expect(repository.findings.filter(item => item.source === 'model')).toHaveLength(1);
    expect(repository.findings[0].sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
  });
  it.each([
    ['supported', 'contradicted'],
    ['contradicted', 'supported'],
  ] as const)('reconciles exact feature and source-sweep claims conservatively (%s then %s)', async (first, second) => {
    const repository = new InMemoryStaticReviewRepository();
    let supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' },
          result: candidateSupportResult(request, { disposition: supportCalls === 1 ? first : second, boundary: 'local_source' }) };
      }
      const rows = assessments(request).map((row: any) => ({ ...row, assessments: row.assessments.map((item: any) => item.domain === 'security'
        ? { ...item, outcome: 'potential_gap', summary: 'Fixture unsupported application consequence.' } : item) }));
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { findings: [{ ...issue, domain: 'security' }], featureAssessments: rows } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded', modelFindingCount: 0 });
    expect(supportCalls).toBe(2);
    const security = analysisMapFromEvents(repository.audits)?.features[0].assessments.find(item => item.domain === 'security');
    expect(security).toMatchObject({ status: 'assessed', outcome: 'potential_gap' });
    expect(security?.summary).not.toContain('Fixture unsupported application consequence');
    expect(security?.summary).toMatch(/clean absence/i);
    expect(repository.audits.some(event => event.event === 'review_candidate_support_conflict')).toBe(true);
    expect(repository.audits.find(event => event.event === 'review_assessment_validated')?.detail?.assessedArtifactIds).toEqual([]);
    expect(repository.findings.filter(finding => finding.source === 'model')).toHaveLength(0);
  });
  it('fails closed on insufficient local evidence but retains a separately supported local sibling', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const sibling = { ...issue, title: 'Second observation', description: 'A separate local consequence is alleged.', severity: 'medium', domain: 'technical' as const };
    let supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        const candidates = supportCandidateRows(request);
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { candidates: candidates.map((candidate, index) => ({
          candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: index === 0 ? 'supported' : 'insufficient',
          trigger: 'The source branch is inspected.', consequence: index === 0 ? 'The separate local result is exposed.' : 'The broader claim cannot be established.',
          references: index === 0 ? [{ role: 'sink', ...candidate.source }] : [], authorityReferences: [],
          limitation: index === 0 ? null : 'The local source packet does not establish this consequence.',
        })) } };
      }
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: [{ ...issue, domain: 'security' }, sibling], featureAssessments: assessments(request),
      } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial', modelFindingCount: 2 });
    expect(supportCalls).toBe(2); // independent source sweep also runs
    expect(repository.findings.filter(finding => finding.source === 'model').map(finding => finding.title).sort()).toEqual([issue.title, sibling.title].sort());
    expect(repository.findings.find(finding => finding.title === sibling.title)?.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
  });
  it('revokes an earlier support row when a repair later returns conflicting duplicates for that candidate', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const sibling = { ...issue, title: 'Second observation', description: 'A second separate behavior is alleged.', severity: 'medium' };
    let supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        const candidates = supportCandidateRows(request);
        const row = (candidate: typeof candidates[number]) => ({ candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported',
          trigger: 'The source branch runs.', consequence: 'The alleged operation is reached.', references: [{ role: 'sink', ...candidate.source }], authorityReferences: [], limitation: null });
        const first = row(candidates[0]);
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { candidates: supportCalls === 1 ? [first] : [first, { ...first, disposition: 'contradicted' }] } };
      }
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { findings: [{ ...issue, domain: 'security' }, sibling], featureAssessments: assessments(request) } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('failed');
    expect(supportCalls).toBe(4); // bounded repair in both independent packets
    expect(repository.findings.filter(finding => finding.source === 'model').every(finding =>
      (finding.sourceLocator?.citationEvidence as any)?.verification === 'needs_verification')).toBe(true);
    expect(repository.findings.some(finding => finding.title === issue.title)).toBe(false);
  });
  it('keeps a valid contradiction from an incomplete packet when a repair flips that candidate to supported', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const sibling = { ...issue, title: 'Separate numeric behavior', description: 'A separately evidenced local behavior is alleged.', severity: 'medium' };
    let supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        const candidates = supportCandidateRows(request);
        const row = (candidate: typeof candidates[number], disposition: 'supported' | 'contradicted') => ({
          candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition,
          trigger: 'The inspected local branch executes.', consequence: 'The candidate makes a local claim.',
          references: [{ role: disposition === 'contradicted' ? 'guard' : 'sink', ...candidate.source }],
          authorityReferences: [], limitation: null,
        });
        const rows = supportCalls === 1
          ? [row(candidates[0], 'contradicted')]
          : candidates.map(candidate => row(candidate, 'supported'));
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { candidates: rows } };
      }
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: [{ ...issue, domain: 'security' }, sibling], featureAssessments: assessments(request),
      } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded', modelFindingCount: 1 });
    expect(supportCalls).toBe(3); // contradiction + repair, then the independent source sweep
    expect(repository.findings.filter(finding => finding.source === 'model').map(finding => finding.title)).toEqual([sibling.title]);
    expect(repository.audits.some(event => event.event === 'review_candidate_support_conflict')).toBe(true);
    const security = analysisMapFromEvents(repository.audits)?.features[0].assessments.find(item => item.domain === 'security');
    expect(security?.summary).toMatch(/conflicting support outcomes/i);
    expect(security?.summary).not.toContain('Fixture unsupported application consequence');
    expect(repository.audits.find(event => event.event === 'review_assessment_validated')?.detail?.assessedArtifactIds).toEqual([]);
  });
  it('excludes artifacts referenced by both sides of a conflicting repair packet from absence proof', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const guardContent = 'export function guard() { if (owner) return record; return null; }';
    const guardArtifact: Artifact = { ...artifact, id: 'guard-code', fileName: 'guard.ts', filePath: 'src/guard.ts', contentHash: 'guard-version' };
    const sibling = { ...issue, title: 'Separate guard observation', description: 'A separate local guard behavior is alleged.', filePath: guardArtifact.filePath,
      lineNumber: 1, evidence: guardContent, artifactId: guardArtifact.id, sourceVersion: guardArtifact.contentHash, severity: 'medium' };
    let supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        const candidates = supportCandidateRows(request);
        const row = (candidate: typeof candidates[number], disposition: 'supported' | 'contradicted', reference: Record<string, unknown>) => ({
          candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition,
          trigger: 'The inspected local branch executes.', consequence: 'The candidate makes a local claim.',
          references: [{ role: disposition === 'contradicted' ? 'guard' : 'sink', ...reference }],
          authorityReferences: [], limitation: null,
        });
        const guardReference = { artifactId: guardArtifact.id, filePath: guardArtifact.filePath, sourceVersion: guardArtifact.contentHash, lineNumber: 1, evidence: guardContent };
        const rows = supportCalls === 1
          ? [row(candidates[0], 'contradicted', guardReference)]
          : candidates.map(candidate => row(candidate, 'supported', candidate.source));
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { candidates: rows } };
      }
      const isSweep = (request.outputSchema?.properties?.featureAssessments as any)?.maxItems === 0;
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: isSweep ? [] : [{ ...issue, domain: 'security' }, sibling], featureAssessments: assessments(request),
      } };
    } };
    const contents = new Map([[artifact.id, content], [guardArtifact.id, guardContent]]);
    const run = await service(repository, model, async source => contents.get(source.id) ?? content)
      .start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact, guardArtifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded', modelFindingCount: 1 });
    expect(repository.findings.filter(finding => finding.source === 'model').map(finding => finding.title)).toEqual([sibling.title]);
    const validated = repository.audits.find(event => event.event === 'review_assessment_validated')?.detail?.assessedArtifactIds as string[];
    expect(validated).not.toContain(artifact.id);
    expect(validated).not.toContain(guardArtifact.id);
  });
  it('preserves five reserved paid calls across generation repair and support repair on one durable batch stage', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let generationCalls = 0, supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        if (supportCalls === 1) throw new ModelProviderError('safe malformed support fixture', { code: 'malformed_response', malformed: true, retryable: true });
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: candidateSupportResult(request) };
      }
      const mapFeatures = assessments(request);
      generationCalls++;
      if (generationCalls > 3 || (request.outputSchema?.properties?.featureAssessments as any)?.maxItems === 0) {
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { findings: [], featureAssessments: mapFeatures } };
      }
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: generationCalls < 3 ? [{ title: 'Malformed candidate packet' }] : [{ ...issue, domain: 'security' }], featureAssessments: mapFeatures,
      } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('pending_approval');
    expect(generationCalls).toBe(4);
    expect(supportCalls).toBe(2);
    const batchId = repository.audits.find(event => event.event === 'review_candidate_support_scheduled')?.detail?.batchId;
    const stageAttempts = repository.attempts.filter(attempt => attempt.stage === `model_analysis:${batchId}`);
    expect(stageAttempts.map(attempt => attempt.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(stageAttempts.every(attempt => attempt.stage === `model_analysis:${batchId}`)).toBe(true);
  });
  it('stops immediately on support capacity pause and does not call the later source sweep', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let generationCalls = 0, supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        throw new ModelProviderError('structured capacity stop', { code: 'credits_exhausted', retryable: false });
      }
      generationCalls++;
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { findings: [{ ...issue, domain: 'security' }], featureAssessments: assessments(request) } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'blocked', progress: { stage: 'provider_paused', pauseCode: 'credits_exhausted' } });
    expect(generationCalls).toBe(1);
    expect(supportCalls).toBe(1);
    expect(repository.attempts).toHaveLength(2);
    expect(repository.findings.filter(finding => finding.source === 'model')).toHaveLength(1);
    expect(repository.findings[0].sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
  });
  it('retains the supported sibling plus flagged evidence and stops immediately at capacity', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const sibling = { ...issue, title: 'Second observation', description: 'A separate branch effect is alleged.', severity: 'medium' };
    let generationCalls = 0, supportCalls = 0;
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportCalls++;
        if (supportCalls === 2) throw new ModelProviderError('capacity pause', { code: 'credits_exhausted', retryable: false });
        const candidate = supportCandidateRows(request)[0];
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: { candidates: [{
          candidateId: candidate.candidateId, claimBoundary: 'local_source', disposition: 'supported', trigger: 'The inspected branch is reached.',
          consequence: 'The first local result is exposed.', references: [{ role: 'sink', ...candidate.source }], authorityReferences: [], limitation: null,
        }] } };
      }
      generationCalls++;
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: [{ ...issue, domain: 'security' }, sibling], featureAssessments: assessments(request),
      } };
    } };
    const run = await service(repository, model).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'blocked', modelStatus: 'partial', modelFindingCount: 2, progress: { stage: 'provider_paused', pauseCode: 'credits_exhausted' } });
    expect(generationCalls).toBe(1);
    expect(supportCalls).toBe(2);
    expect(repository.findings.filter(finding => finding.source === 'model').map(finding => finding.title).sort()).toEqual([issue.title, sibling.title].sort());
    expect(repository.findings.find(finding => finding.title === sibling.title)?.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    expect(repository.audits.find(event => event.event === 'review_candidate_support_incomplete')?.detail).toMatchObject({ supportedCount: 1 });
  });
  it('keeps confirmed manual requirements available during support without inventing a source-line authority', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const grounding = new InMemoryGroundingRepository();
    grounding.requirements.set('confirmed-ownership', {
      id: 'confirmed-ownership', projectId: 'project', title: 'Record ownership', description: 'Only the selected user may access the record.',
      category: 'manual', priority: 'high', sourceCandidateId: null, sourceLocator: null, sourceVersion: null, confidence: null, createdAt: '2026-10-25T00:00:00Z',
    });
    let supportPrompt = '';
    const model: StaticAnalysisModelProvider = { analyze: async request => {
      if (isCandidateSupportRequest(request)) {
        supportPrompt = request.prompt;
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: candidateSupportResult(request) };
      }
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
        findings: [{ ...issue, title: 'Ownership rule mismatch', description: 'The code does not enforce the confirmed ownership rule.', category: 'business', domain: 'business', requirementId: 'confirmed-ownership' }],
        featureAssessments: assessments(request),
      } };
    } };
    const run = await createStaticReviewOrchestrator({ repository, groundingRepository: grounding, readArtifactContent: async () => content,
      deterministic: async () => [], modelProvider: model, retry: { sleep: async () => undefined },
    }).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await run.completion).status).toBe('pending_approval');
    expect(supportPrompt).toContain('confirmed-ownership');
    expect(supportPrompt).toContain('Only the selected user may access the record.');
    expect(repository.findings.some(finding => finding.requirementId === 'confirmed-ownership')).toBe(true);
  });
  it('reports bounded field-specific repair codes without retaining rejected source text', () => {
    const invalid = { ...issue, source: 'model' as const, evidence: 'private rejected payload' };
    const result=validateFindingEvidence([invalid,{...invalid,lineNumber:999},{...invalid,filePath:'missing.ts'}],[{artifact,content}]);
    expect(result.feedback).toEqual([
      {findingIndex:1,field:'evidence',code:'excerpt_mismatch'},
      {findingIndex:2,field:'lineNumber',code:'line_out_of_range'},
      {findingIndex:3,field:'filePath',code:'path_not_unique'},
    ]);
    expect(JSON.stringify(result.feedback)).not.toContain('private rejected payload');
    expect(validateFindingEvidence(Array.from({length:30},()=>invalid),[{artifact,content}]).feedback).toHaveLength(16);
  });
  it('supplies safe evidence repair feedback to the next bounded provider attempt', async () => {
    const repository=new InMemoryStaticReviewRepository();
    const requests:StaticModelRequest[]=[];
    const model=provider(request=>{
      requests.push(request);
      return {findings:requests.length===1?[{title:'malformed predecessor'}, {...issue,evidence:'private invalid excerpt'}]:[issue],featureAssessments:assessments(request)};
    });
    const run=await service(repository,model).start({projectId:'project',reviewType:'code_review',artifacts:[artifact]});
    expect((await run.completion).modelStatus).toBe('succeeded');
    expect(requests).toHaveLength(3);
    expect(requests[1].prompt).toContain('finding_shape');
    expect(requests[1].prompt).not.toContain('private invalid excerpt');
    expect(requests[2].prompt).not.toContain('private invalid excerpt');
    const repair=repository.audits.find(event=>event.event==='review_assessment_repair_scheduled');
    expect(repair?.detail).toMatchObject({ reason: 'finding_shape' });
    expect(JSON.stringify(repository.audits)).not.toContain('private invalid excerpt');
    const supportAudit = repository.audits.find(event => event.event === 'review_candidate_support_saved');
    expect((supportAudit?.detail?.candidates as Array<Record<string, unknown>>)?.[0]?.referenceIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(supportAudit?.detail)).not.toContain(content);
  });
  it('validates every interacting code segment and omits forged secondary evidence', () => {
    const second = { ...artifact, id: 'second', fileName: 'worker.ts', filePath: 'src/worker.ts', originalPath: 'src/worker.ts', contentHash: 'worker-hash', versionId: 'worker-version' };
    const sources = [{ artifact, content }, { artifact: second, content: 'export function write() { return true; }' }];
    const finding = { ...issue, source: 'model' as const, relatedLocations: [{ filePath: second.filePath, lineNumber: 1, evidence: 'export function write() { return true; }', sourceVersion: 'worker-version' }] };
    const valid = validateFindingEvidence([finding], sources);
    expect(valid.rejectedCount).toBe(0);
    expect(valid.findings[0].relatedLocations?.[0]).toMatchObject({ artifactId: 'second', sourceVersion: 'worker-hash' });
    const invalid = validateFindingEvidence([{ ...finding, relatedLocations: [{ ...finding.relatedLocations[0], evidence: 'invented content' }] }], sources);
    expect(invalid.rejectedCount).toBe(1);
    expect(invalid.feedback).toEqual([{findingIndex:1,relatedLocationIndex:1,field:'evidence',code:'excerpt_mismatch'}]);
    expect(invalid.findings[0].relatedLocations).toEqual([]);
  });
  it('persists the public domain, issue type, causal explanation and validated related source', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const run = await service(repository, provider(request => ({ findings: [{ ...issue, domain: 'technical', issueType: 'race_condition', logicFlow: ['Two requests read the same state before either writes.'], relatedLocations: [{ filePath: artifact.filePath, lineNumber: 1, evidence: content }] }], featureAssessments: assessments(request) }))).start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    await run.completion;
    expect(repository.findings[0]).toMatchObject({ domain: 'technical', issueType: 'race_condition', logicFlow: ['Two requests read the same state before either writes.'], relatedLocations: [expect.objectContaining({ artifactId: artifact.id })] });
  });
});
