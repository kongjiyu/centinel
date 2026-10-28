import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { analysisMapForBatchPrompt, analysisMapFromEvents, contextForAssessmentBatch, findingsWithinBatch, planAssessmentBatches, REVIEW_FEATURE_BATCH_SIZE, REVIEW_SOURCE_BATCH_CHARACTERS } from '../../src/review/assessmentBatches.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import type { ReviewAnalysisFeature, ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { chunkFrozenSource } from '../../src/review/sourceChunks.js';
import type { RetrievedContext } from '../../src/review/contextTypes.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { CONTRACT_COMPARISON_INSTRUCTIONS } from '../../src/review/sourcePrompt.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import { candidateSupportResult, isCandidateSupportRequest } from '../fixtures/semanticSupport.js';

function item(id: string, content: string, type: Artifact['type'] = 'source_code') {
  return { artifact: { id, projectId: 'p', type, source: 'repository', fileName: id, filePath: id, originalPath: null,
    versionId: `version-${id}`, contentHash: crypto.createHash('sha256').update(content).digest('hex'), createdAt: '2026-10-23T00:00:00Z' } as Artifact, content };
}
function mappedFeature(id: string, source: ReturnType<typeof item>, lineNumber: number): ReviewAnalysisFeature {
  return { id, label: id, provisional: true, entryPoints: [{ artifactId: source.artifact.id, filePath: source.artifact.filePath,
    lineNumber, sourceVersion: source.artifact.contentHash }], paths: [], assessments: [], unresolved: [] };
}
function mapFor(features: ReviewAnalysisFeature[]): ReviewAnalysisMap {
  return { ...deriveReviewAnalysisMap([]), features };
}
function retrievedContext(source: ReturnType<typeof item>, symbol: string): RetrievedContext {
  const chunk = chunkFrozenSource({ id: source.artifact.id, filePath: source.artifact.filePath, type: source.artifact.type }, source.content)
    .find(candidate => candidate.kind === 'function' && candidate.symbol === symbol);
  if (!chunk) throw new Error(`Missing frozen function chunk: ${symbol}`);
  return { files: [], totalSymbols: 1, estimatedTokens: Math.ceil(chunk.content.length / 4), reason: 'fixture', selectedChunks: [{
    artifactId: source.artifact.id, artifactVersionId: source.artifact.versionId!, filePath: source.artifact.filePath,
    contentHash: crypto.createHash('sha256').update(chunk.content, 'utf8').digest('hex'), ordinal: chunk.ordinal, content: chunk.content,
    lineStart: chunk.lineStart, lineEnd: chunk.lineEnd, startOffset: chunk.startOffset, endOffset: chunk.endOffset,
    kind: chunk.kind, indexOrdinal: chunk.ordinal,
  }] };
}
function response(request: StaticModelRequest) {
  if (isCandidateSupportRequest(request)) return candidateSupportResult(request);
  const map = readPromptAnalysisMap(request);
  return { findings: [], featureAssessments: map.features.map((feature: any) => ({ featureId: feature.id,
    assessments: ['security','business','technical','personnel'].map(domain => ({domain,status:'assessed',outcome:'no_issue_identified',summary:'The bounded fixture branch was inspected.',evidence:feature.entryPoints})) })) };
}
describe('bounded Review assessment batches', () => {
  it('keeps ranked excerpts inside the exact supplied version and segment', () => {
    const input={...item('api.ts','visible code'),lineStart:100,lineEnd:100};
    const chunk={filePath:'api.ts',artifactVersionId:input.artifact.versionId!,ordinal:1,content:'visible code'};
    const result=contextForAssessmentBatch({files:[],totalSymbols:0,estimatedTokens:20,reason:'fixture',selectedChunks:[chunk,{...chunk,artifactVersionId:'other-version'},{...chunk,content:'unseen code'},{...chunk,content:''}]},[input]);
    expect(result?.selectedChunks).toEqual([{ ...chunk,
      content: 'Exact text is included in the numbered frozen source below; use that source for evidence.',
    }]);
    expect(result?.selectedChunks?.[0].content).not.toContain('visible code');
  });
  it('keeps a complete canonical map while limiting prompt coverage details to the batch files', () => {
    const selected = item('selected.ts', 'export function selected() { return true; }');
    const elsewhere = item('elsewhere.ts', 'export function elsewhere() { return false; }');
    const map = deriveReviewAnalysisMap([selected, elsewhere]);
    map.coverage.unsupportedArtifacts = [
      { artifactId: selected.artifact.id, filePath: selected.artifact.filePath, reason: 'selected source limitation' },
      { artifactId: elsewhere.artifact.id, filePath: elsewhere.artifact.filePath, reason: 'unrelated source limitation' },
    ];
    map.coverage.unsupportedArtifactCount = 2;
    map.coverage.unsupportedArtifactsTruncated = true;
    map.coverage.declarationArtifacts = [
      { artifactId: selected.artifact.id, filePath: selected.artifact.filePath, reason: 'selected declaration' },
      { artifactId: elsewhere.artifact.id, filePath: elsewhere.artifact.filePath, reason: 'unrelated declaration' },
    ];
    map.coverage.nonExecutableArtifacts = [
      { artifactId: selected.artifact.id, filePath: selected.artifact.filePath, reason: 'selected data input' },
      { artifactId: elsewhere.artifact.id, filePath: elsewhere.artifact.filePath, reason: 'unrelated data input' },
    ];
    const canonical = structuredClone(map);
    const projected = analysisMapForBatchPrompt(map, [{ ...selected, lineStart: 1, lineEnd: 1 }]);

    expect(projected.features).toEqual(map.features);
    expect(projected.coverage.unsupportedArtifacts).toEqual([map.coverage.unsupportedArtifacts[0]]);
    expect(projected.coverage.declarationArtifacts).toEqual([map.coverage.declarationArtifacts![0]]);
    expect(projected.coverage.nonExecutableArtifacts).toEqual([map.coverage.nonExecutableArtifacts![0]]);
    expect(projected.coverage.unsupportedArtifactCount).toBe(2);
    expect(projected.coverage.unsupportedArtifactsTruncated).toBe(true);
    expect(projected.coverage.limitations).toEqual(map.coverage.limitations);
    expect(map).toEqual(canonical);
  });
  it('includes every operation beyond the old ceiling and sweeps unrelated sources', () => {
    const code = item('api.ts', Array.from({length: 41}, (_, index) => `export function operation${index}() { return ${index}; }`).join('\n'));
    const document = item('policy.md', 'Original project policy.', 'other');
    const config = item('settings.json', '{"setting":true}', 'source_code');
    const sources = [code,document,config];
    const map = deriveReviewAnalysisMap(sources);
    const batches = planAssessmentBatches(map,sources);
    expect(batches.flatMap(batch => batch.features.map(feature => feature.id)).sort()).toEqual(map.features.map(feature => feature.id).sort());
    expect(map.features.length).toBeGreaterThan(30);
    expect(batches.every(batch => batch.features.length <= REVIEW_FEATURE_BATCH_SIZE)).toBe(true);
    expect(new Set(batches.flatMap(batch => batch.sources.map(source => source.artifact.id)))).toEqual(new Set(sources.map(source => source.artifact.id)));
    expect(batches.some(batch => !batch.features.length && batch.sources.some(source => source.artifact.id === config.artifact.id))).toBe(true);
    expect(batches).toEqual(planAssessmentBatches(map,sources));
  });
  it('preserves original offsets and complete text across source-only segments', () => {
    const input = item('large.md', Array.from({length:1000},(_,i)=>`${i}: ${'x'.repeat(80)}`).join('\n'),'other');
    const batches = planAssessmentBatches(deriveReviewAnalysisMap([input]),[input]);
    const segments = batches.flatMap(batch => batch.sources);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map(segment => segment.content).join('\n')).toBe(input.content);
    expect(segments[1].lineStart).toBe(segments[0].lineEnd+1);
    expect(batches.every(batch => batch.sources.reduce((n,s)=>n+s.content.length,0)<=REVIEW_SOURCE_BATCH_CHARACTERS)).toBe(true);
    expect(()=>planAssessmentBatches(deriveReviewAnalysisMap([]),[item('huge.txt','x'.repeat(70_000),'other')])).toThrow('bounded source context');
  });
  it('sends exact contiguous evidence ranges for features and keeps the independent full-source sweep', () => {
    const input = item('packet.ts', 'const state = true;\r\nfunction selected() { return state; }\r\nfunction unrelated() { return false; }\r\n');
    const batches = planAssessmentBatches(mapFor([mappedFeature('selected', input, 2)]), [input]);
    const featureBatch = batches.find(batch => batch.features.length)!;
    const featureSource = featureBatch.sources.find(source => source.artifact.id === input.artifact.id)!;
    const sourceSweep = batches.find(batch => !batch.features.length)!.sources.find(source => source.artifact.id === input.artifact.id)!;

    expect(featureSource).toMatchObject({ lineStart: 1, lineEnd: 2 });
    expect(featureSource.content).toBe(input.content.split('\n').slice(0, 2).join('\n'));
    expect(featureSource.content).not.toContain('unrelated');
    expect(featureBatch.packetDiagnostics).toMatchObject({ schemaVersion: 1, method: 'ast_dependency_units', selectedUnitCount: 1, retainedRangeCount: 1 });
    expect(sourceSweep.content).toBe(input.content.split('\n').join('\n'));
  });
  it('drops optional retrieved units before splitting or failing a required packet', () => {
    const body = Array.from({ length: 250 }, () => `//${'x'.repeat(240)}`).join('\n');
    const required = item('required.ts', `${body}\nfunction selected() { return true; }`);
    const optional = item('optional.ts', `function extra() { return '${'y'.repeat(5_000)}'; }`);
    const context = retrievedContext(optional, 'extra');
    const batches = planAssessmentBatches(mapFor([mappedFeature('selected', required, 251)]), [required, optional], context);
    const featureBatch = batches.find(batch => batch.features.length)!;

    expect(featureBatch.sources.map(source => source.artifact.id)).toEqual(['required.ts']);
    expect(featureBatch.packetDiagnostics?.addedRetrievedUnitCount).toBe(0);
    expect(featureBatch.sources.reduce((sum, source) => sum + source.content.length, 0)).toBeLessThanOrEqual(REVIEW_SOURCE_BATCH_CHARACTERS);
    expect(batches.some(batch => !batch.features.length && batch.sources.some(source => source.artifact.id === optional.artifact.id))).toBe(true);
  });
  it('fails before provider execution when one mapped feature has over-budget required context', () => {
    const body = Array.from({ length: 270 }, () => `//${'x'.repeat(240)}`).join('\n');
    const required = item('oversized.ts', `${body}\nfunction selected() { return true; }`);

    expect(() => planAssessmentBatches(mapFor([mappedFeature('selected', required, 271)]), [required]))
      .toThrow('bounded source context');
  });
  it('adds a source-only sweep for code already present in a feature batch', () => {
    const input = item('selected.ts', 'export function selectedOperation() { return true; }');
    const batches = planAssessmentBatches(deriveReviewAnalysisMap([input]), [input]);
    expect(batches.some(batch => batch.features.length && batch.sources.some(source => source.artifact.id === input.artifact.id))).toBe(true);
    expect(batches.some(batch => !batch.features.length && batch.sources.some(source => source.artifact.id === input.artifact.id))).toBe(true);
  });
  it('packs only selected contract and implementation sources for generic comparison', () => {
    const contract = item('interface.ts', 'export interface Store { read(key: string): string | null; }');
    const selectedA = item('adapter-a.ts', 'export function readA(key: string) { return store.read(key); }');
    const selectedB = item('adapter-b.ts', 'export function readB(key: string) { return cache.read(key) ?? store.read(key); }');
    const outsideScope = item('adapter-outside-scope.ts', 'export function unselectedRead(key: string) { return remote.read(key); }');
    const selected = [contract, selectedA, selectedB];
    const batches = planAssessmentBatches(deriveReviewAnalysisMap(selected), selected);
    const sweep = batches.find(batch => !batch.features.length && batch.sources.length === selected.length);
    expect(sweep?.sources.map(source => source.artifact.id).sort()).toEqual(selected.map(source => source.artifact.id).sort());
    expect(sweep?.sources.map(source => source.content)).toEqual(selected.map(source => source.content));
    expect(sweep?.sources.some(source => source.content.includes(outsideScope.content))).toBe(false);
    expect(CONTRACT_COMPARISON_INSTRUCTIONS).toContain('Distinguish documented or intentional differences');
    expect(CONTRACT_COMPARISON_INSTRUCTIONS).toContain('do not infer behavior for unselected implementations');
    // This verifies bounded packet selection and prompt policy only; a model's semantic recall still needs blinded evaluation.
  });
  it('fails the combined feature and source-sweep batch ceiling before provider resolution', async () => {
    const code = item('operations.ts', Array.from({ length: 980 }, (_, index) => `export function operation${index}() { return ${index}; }`).join('\n'));
    const commentOnly = item('generated.ts', Array.from({ length: 17 }, () => `//${'x'.repeat(23_500)}`).join('\n'));
    const contents = new Map([[code.artifact.id, code.content], [commentOnly.artifact.id, commentOnly.content]]);
    const repository = new InMemoryStaticReviewRepository();
    const resolveProvider = vi.fn(async () => { throw new Error('provider resolution must not run before batch preflight'); });
    const analyze = vi.fn();
    const runner = createStaticReviewOrchestrator({ repository,
      readArtifactContent: async artifact => contents.get(artifact.id)!, deterministic: async () => [],
      modelProvider: { analyze }, modelProviderResolver: resolveProvider,
    });
    const run = await runner.start({ projectId: 'p', reviewType: 'code_review', artifacts: [code.artifact, commentOnly.artifact] });
    expect((await run.completion).status).toBe('failed');
    expect((await run.completion).failureReason).toContain('bounded source context');
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(repository.attempts).toHaveLength(0);
  });
  it('executes independent batches with durable budgets, then validates full coverage once', async () => {
    const input = item('api.ts',Array.from({length:9},(_,i)=>`export function operation${i}() { return ${i}; }`).join('\n'));
    const repository = new InMemoryStaticReviewRepository();
    const requests: StaticModelRequest[] = [];
    const reader = vi.fn(async()=>input.content);
    const deterministic = vi.fn(async (_p,_a,_r,_s,_h,frozenReader) => { expect(await frozenReader(input.artifact)).toBe(input.content); return []; });
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:reader,deterministic,
      modelProvider:{analyze:async request=>{ requests.push(request); return {result:response(request),settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}};}}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:[input.artifact]});
    expect((await run.completion).status).toBe('pending_approval');
    expect(requests).toHaveLength(3);
    expect(new Set(repository.attempts.map(attempt=>attempt.stage)).size).toBe(3);
    expect(repository.attempts.map(attempt=>attempt.attempt)).toEqual([1,1,1]);
    expect(repository.audits.filter(event=>event.event==='review_assessment_validated')).toHaveLength(1);
    expect(reader).toHaveBeenCalledOnce();
  });
  it('repairs one invalid result and retains token usage without exceeding five calls', async () => {
    const input=item('api.ts','export function operation() { return true; }');
    const repository=new InMemoryStaticReviewRepository();
    let calls=0;
    const requests: StaticModelRequest[]=[];
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async()=>input.content,deterministic:async()=>[],retry:{sleep:async()=>undefined},
      modelProvider:{analyze:async request=>{ requests.push(request); calls++;return{result:calls===1?{findings:[],featureAssessments:[]}:response(request),usage:{inputTokens:100,outputTokens:20,totalTokens:120},settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}};}}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:[input.artifact]});
    expect((await run.completion).modelStatus).toBe('succeeded');
    expect(calls).toBe(3); // two generation batches, then their independent source sweep
    expect(requests[1].repair).toBe(true);
    expect(requests[1].prompt).toContain('Validation repair: domain_coverage');
    expect(repository.attempts[0]).toMatchObject({attempt:1,outcome:'malformed_response',usage:{inputTokens:100}});
  });
  it.each(['credits_exhausted', 'provider_unavailable'])('retains validated prefix findings when a later batch stops: %s', async code => {
    const input=item('api.ts',Array.from({length:9},(_,i)=>`export function operation${i}() { return ${i}; }`).join('\n'));
    const repository=new InMemoryStaticReviewRepository();
    let calls=0;
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async()=>input.content,
      deterministic:async()=>[{ruleId:'fixture-rule',message:'Fixture observation',filePath:'api.ts',lineNumber:1,evidence:input.content.split('\n')[0],severity:'info',category:'code_quality'}],allowDeterministicOnly:false,
      modelProvider:{analyze:async request=>{
        if (isCandidateSupportRequest(request)) return { result: candidateSupportResult(request), settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'} };
        if (++calls===2) throw new ModelProviderError('Unavailable', {code,retryable:false});
        const result=response(request);
        result.findings.push({title:'Fixture finding',description:'A retained independent check.',severity:'low',category:'technical',domain:'technical',issueType:'fixture_issue',filePath:'api.ts',lineNumber:1,evidence:input.content.split('\n')[0],recommendation:'Inspect the fixture.',confidence:'high'} as never);
        return {result,settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}};
      }}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:[input.artifact]});
    const completed = await run.completion;
    expect(completed).toMatchObject({status:code==='credits_exhausted'?'blocked':'failed',modelStatus:'partial',modelFindingCount:1,deterministicFindingCount:1});
    expect(calls).toBe(2);
    expect(repository.findings).toHaveLength(2);
    expect(repository.audits.some(event=>event.event==='review_assessment_validated')).toBe(false);
    const map=analysisMapFromEvents(repository.audits)!;
    expect(map.status).toBe('partial');
    expect(map.features.filter(feature=>feature.assessments.every(row=>row.status==='assessed'))).toHaveLength(8);
  });
  it('rejects evidence extending beyond the segment supplied to that request', () => {
    const source={...item('api.ts','line two\nline three'),lineStart:2,lineEnd:3};
    const finding={artifactId:'api.ts',lineNumber:2,evidence:'line two'} as any;
    expect(findingsWithinBatch([finding],[source])).toHaveLength(1);
    expect(findingsWithinBatch([{...finding,lineNumber:1}],[source])).toHaveLength(0);
    expect(findingsWithinBatch([{...finding,evidence:'line two\nline three\nline four'}],[source])).toHaveLength(0);
    expect(findingsWithinBatch([{...finding,relatedLocations:[{...finding,lineNumber:4}]}],[source])).toHaveLength(0);
  });
  it.each([true,false])('completes validated configuration sweeps without inventing executable coverage (code=%s)', async includeCode => {
    const inputs=[item('settings.json','{"access":"private"}')];
    if(includeCode) inputs.push(item('api.ts','export function operation() { return true; }'));
    const repository=new InMemoryStaticReviewRepository();
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async artifact=>inputs.find(source=>source.artifact.id===artifact.id)!.content,deterministic:async()=>[],
      modelProvider:{analyze:async request=>({result:response(request),settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}})}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:inputs.map(input=>input.artifact)});
    expect(await run.completion).toMatchObject({status:'pending_approval',modelStatus:'succeeded'});
    const map=analysisMapFromEvents(repository.audits)!;
    expect(map.coverage.unsupportedArtifacts).toEqual([expect.objectContaining({artifactId:'settings.json',parserExclusion:'configuration'})]);
    expect(map.features.flatMap(feature=>feature.entryPoints).some(ref=>ref.artifactId==='settings.json')).toBe(false);
  });
  it.each([
    ['external.cjs', 'module.exports = require("unselected-package");'],
    ['factory.ts', 'export default unknownFactory();'],
    ['value.ts', 'export const value = globalThis.selectedValue;'],
  ])('assesses selected initialization in %s while withholding external-surface resolution proof', async (fileName,content) => {
    const input=item(fileName,content);
    const repository=new InMemoryStaticReviewRepository();
    const requests:StaticModelRequest[]=[];
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async()=>input.content,deterministic:async()=>[],
      modelProvider:{analyze:async request=>{requests.push(request);return{result:response(request),settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}};}}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:[input.artifact]});
    expect(await run.completion).toMatchObject({status:'pending_approval',modelStatus:'succeeded'});
    expect(requests.some(request=>request.prompt.includes(content))).toBe(true);
    const map=analysisMapFromEvents(repository.audits)!;
    expect(map.features.length).toBeGreaterThan(0);
    expect(map.features.some(feature=>feature.unresolved.some(boundary=>!boundary.reason.startsWith('The map covers only syntax inside this handler;')))).toBe(true);
    expect(repository.audits.find(event=>event.event==='review_assessment_validated')?.detail?.assessedArtifactIds).toEqual([]);
  });
  it.each([
    ['api.d.ts','export declare class Client { request(url: string): Promise<void>; }'],
    ['constants.ts','export const LABEL = "constant value";'],
  ])('sweeps contract/data source %s without inventing executable or resolution proof', async (fileName,content) => {
    const input=item(fileName,content);
    const repository=new InMemoryStaticReviewRepository();
    const requests:StaticModelRequest[]=[];
    const runner=createStaticReviewOrchestrator({repository,readArtifactContent:async()=>input.content,deterministic:async()=>[],
      modelProvider:{analyze:async request=>{requests.push(request);return{result:response(request),settings:{provider:'custom',apiFormat:'openai-compatible',model:'offline'}};}}});
    const run=await runner.start({projectId:'p',reviewType:'code_review',artifacts:[input.artifact]});
    expect(await run.completion).toMatchObject({status:'pending_approval',modelStatus:'succeeded'});
    expect(requests[0].prompt).toContain(content);
    const map=analysisMapFromEvents(repository.audits)!;
    expect(map.features).toHaveLength(0);
    expect(map.coverage.executableArtifacts).toBe(0);
    const validated=repository.audits.find(event=>event.event==='review_assessment_validated');
    expect(validated?.detail?.assessedArtifactIds).toEqual([]);
  });
});
