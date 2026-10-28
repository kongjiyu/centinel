import { describe, expect, it } from 'vitest';
import { projectReviewUsageAccounting, type ReviewUsageAttemptRow } from '../../src/review/stageUsageProjection.js';

const sourceV1 = {
  artifactId: 'artifact-a', artifactVersionId: 'version-1', contentHash: 'hash-1',
  filePath: 'src/auth.ts', lineStart: 10, lineEnd: 40,
};

function attempt(overrides: Partial<ReviewUsageAttemptRow> & Pick<ReviewUsageAttemptRow, 'id' | 'stage'>): ReviewUsageAttemptRow {
  return {
    id: overrides.id,
    stage: overrides.stage,
    attempt: overrides.attempt ?? 1,
    provider: overrides.provider ?? 'codex', apiFormat: overrides.apiFormat ?? 'codex-app-server', model: overrides.model ?? 'fixture',
    outcome: overrides.outcome ?? 'success',
    input_tokens: overrides.input_tokens === undefined ? 100 : overrides.input_tokens,
    output_tokens: overrides.output_tokens === undefined ? 10 : overrides.output_tokens,
    cache_read_tokens: overrides.cache_read_tokens === undefined ? 40 : overrides.cache_read_tokens,
    cache_creation_tokens: overrides.cache_creation_tokens === undefined ? 0 : overrides.cache_creation_tokens,
    metadata: overrides.metadata === undefined ? {
      providerReportedTotalTokens: 110,
      usageContext: { phase: 'initial_analysis', sources: [sourceV1] },
    } : overrides.metadata,
    duration_ms: 1,
    created_at: '2026-10-25T00:00:00.000Z',
  };
}

describe('Review stage usage projection', () => {
  it('counts a repeated versioned file once across stages and reports appearances separately', () => {
    const result = projectReviewUsageAccounting({
      records: [
        attempt({ id: 'analysis', stage: 'model_analysis:batch-1' }),
        attempt({ id: 'support', stage: 'model_analysis:batch-1', attempt: 2,
          metadata: { providerReportedTotalTokens: 110, usageContext: { phase: 'semantic_support', sources: [sourceV1] } } }),
      ],
      physicalReads: [],
      knownWorkflowStages: ['model_analysis'],
    });

    const model = result.byStage.find(stage => stage.stage === 'model_analysis')!;
    expect(model.operations).toEqual(['model_analysis:batch-1']);
    expect(model.calls).toBe(2);
    expect(model.aiFileCount).toBe(1);
    expect(model.aiFileAppearances).toBe(2);
    expect(model.phases.find(phase => phase.phase === 'initial_analysis')).toMatchObject({
      calls: 1, inputTokens: 100, unknownInputCalls: 0,
      outputTokens: 10, unknownOutputCalls: 0,
      cacheReadTokens: 40, unknownCacheReadCalls: 0,
      cacheCreationTokens: 0, unknownCacheCreationCalls: 0,
      providerReportedTotalTokens: 110, providerReportedTotalCalls: 1, unknownProviderTotalCalls: 0,
      canonicalTotalTokens: 110, unknownCanonicalTotalCalls: 0,
    });
    expect(model.phases.find(phase => phase.phase === 'semantic_support')).toMatchObject({
      calls: 1, canonicalTotalTokens: 110, unknownCanonicalTotalCalls: 0,
    });
    expect(result.sourceInventory.totalUniqueFiles).toBe(1);
    expect(result.sourceInventory.aiFileAppearances).toBe(2);
    expect(result.sourceInventory.repeatedFileAppearances).toBe(1);
    expect(result.sourceInventory.files[0].stages).toEqual(['model_analysis']);
  });

  it('counts the same path at a new frozen version as a distinct file identity', () => {
    const sourceV2 = { ...sourceV1, artifactVersionId: 'version-2', contentHash: 'hash-2' };
    const result = projectReviewUsageAccounting({
      records: [
        attempt({ id: 'v1', stage: 'model_analysis:batch-1' }),
        attempt({ id: 'v2', stage: 'model_analysis:batch-2', metadata: {
          providerReportedTotalTokens: 110, usageContext: { phase: 'citation_repair', sources: [sourceV2] },
        } }),
      ],
      physicalReads: [],
    });

    expect(result.sourceInventory.totalUniqueFiles).toBe(2);
    expect(result.sourceInventory.knownUniqueFiles).toBe(2);
    expect(result.sourceInventory.files.map(file => file.artifactVersionId).sort()).toEqual(['version-1', 'version-2']);
    expect(result.byStage.find(stage => stage.stage === 'model_analysis')?.aiFileCount).toBe(2);
  });

  it('deduplicates a durable reservation and its final usage row by stable attempt id', () => {
    const reservation = attempt({ id: 'stable-attempt', stage: 'model_analysis:batch-1', outcome: 'in_progress',
      input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
      metadata: { usageContext: { phase: 'initial_analysis', sources: [sourceV1] } } });
    const final = attempt({ ...reservation, outcome: 'success', input_tokens: 100, output_tokens: 10,
      cache_read_tokens: 40, cache_creation_tokens: 0, metadata: {
        providerReportedTotalTokens: 110,
        usageContext: { phase: 'initial_analysis', sources: [sourceV1] },
      } });
    const result = projectReviewUsageAccounting({ records: [reservation, final, final], physicalReads: [] });

    const model = result.byStage.find(stage => stage.stage === 'model_analysis')!;
    expect(model.calls).toBe(1);
    expect(model.successfulCalls).toBe(1);
    expect(model.inputTokens).toBe(100);
    expect(model.providerReportedTotalTokens).toBe(110);
    expect(result.sourceInventory.aiFileAppearances).toBe(1);
  });

  it('keeps missing provider usage unknown and preserves stopped versus unreached stages', () => {
    const result = projectReviewUsageAccounting({
      records: [attempt({ id: 'unknown', stage: 'model_analysis:batch-1', outcome: 'cancelled',
        input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
        metadata: { usageContext: { phase: 'initial_analysis', sources: [] } } })],
      physicalReads: [],
      stageStates: { model_analysis: 'stopped', persisting_evidence: 'not_reached' },
      knownWorkflowStages: ['model_analysis', 'persisting_evidence'],
    });

    const model = result.byStage.find(stage => stage.stage === 'model_analysis')!;
    const evidence = result.byStage.find(stage => stage.stage === 'persisting_evidence')!;
    expect(model).toMatchObject({ state: 'stopped', cancelledCalls: 1, inputTokens: 0, unknownInputCalls: 1,
      providerReportedTotalTokens: 0, providerReportedTotalCalls: 0, unknownProviderTotalCalls: 1,
      canonicalTotalTokens: 0, unknownCanonicalTotalCalls: 1, aiFileCount: 0 });
    expect(evidence).toMatchObject({ state: 'not_reached', calls: 0, inputTokens: 0, unknownInputCalls: 0 });
    expect(model.phases.find(phase => phase.phase === 'initial_analysis')).toMatchObject({
      inputTokens: 0, unknownInputCalls: 1,
      outputTokens: 0, unknownOutputCalls: 1,
      cacheReadTokens: 0, unknownCacheReadCalls: 1,
      cacheCreationTokens: 0, unknownCacheCreationCalls: 1,
      providerReportedTotalTokens: 0, providerReportedTotalCalls: 0, unknownProviderTotalCalls: 1,
      canonicalTotalTokens: 0, unknownCanonicalTotalCalls: 1,
    });
  });

  it('separates explicit no-response zero from unknown responses, partial counters, and reservations', () => {
    const context = { phase: 'initial_analysis' as const, sources: [] };
    const result = projectReviewUsageAccounting({
      records: [
        attempt({ id: 'no-response', stage: 'model_analysis:batch-1', outcome: 'permanent_error',
          input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
          metadata: { responseReceived: false, usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 }, usageContext: context } }),
        attempt({ id: 'http-response', stage: 'model_analysis:batch-1', outcome: 'permanent_error',
          input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
          metadata: { responseReceived: true, usageObservation: { source: 'provider_error_response', completeness: 'partial', missingCounters: ['inputTokens'] }, usageContext: context } }),
        attempt({ id: 'spoof-partial', stage: 'model_analysis:batch-1', outcome: 'permanent_error',
          input_tokens: 1, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
          metadata: { responseReceived: false, usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 }, usageObservation: { source: 'codex_turn_last', completeness: 'partial' }, usageContext: context } }),
        attempt({ id: 'reservation', stage: 'model_analysis:batch-1', outcome: 'in_progress',
          input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
          metadata: { responseReceived: false, usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 }, usageContext: context } }),
        attempt({ id: 'contradictory-success', stage: 'model_analysis:batch-1', outcome: 'success',
          input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
          metadata: { responseReceived: false, usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 }, usageContext: context } }),
      ],
      physicalReads: [],
    });
    const stage = result.byStage.find(item => item.stage === 'model_analysis')!;
    expect(result).toMatchObject({ accountedTokens: 0, assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0 });
    expect(stage).toMatchObject({ calls: 5, unknownCanonicalTotalCalls: 5, accountedTokens: 0,
      assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0 });
    expect(stage.phases[0]).toMatchObject({ calls: 5, unknownCanonicalTotalCalls: 5, accountedTokens: 0,
      assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0 });
  });

  it('uses provenance-tagged adapter totals canonically while keeping raw provider totals distinct', () => {
    const result = projectReviewUsageAccounting({
      records: [
        attempt({ id: 'normalized-anthropic', stage: 'model_analysis:batch-a', apiFormat: 'anthropic-compatible',
          input_tokens: 5, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 1,
          metadata: { normalizedTotalTokens: 11, normalizedTotalTokensSource: 'adapter_derived',
            usageContext: { phase: 'initial_analysis', sources: [] } } }),
        attempt({ id: 'legacy-anthropic', stage: 'model_analysis:batch-a', apiFormat: 'anthropic-compatible',
          input_tokens: 5, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 1,
          metadata: { usageContext: { phase: 'initial_analysis', sources: [] } } }),
      ],
      physicalReads: [],
    });

    expect(result).toMatchObject({
      totalProviderReportedTokens: 0, unknownProviderTotalCalls: 2,
      canonicalTotalTokens: 11, unknownCanonicalTotalCalls: 1,
    });
    expect(result.byStage.find(stage => stage.stage === 'model_analysis')?.phases[0]).toMatchObject({
      providerReportedTotalTokens: 0, providerReportedTotalCalls: 0, unknownProviderTotalCalls: 2,
      canonicalTotalTokens: 11, unknownCanonicalTotalCalls: 1,
    });
  });

  it('does not report zero files when request metadata has a phase but omits its source list', () => {
    const result = projectReviewUsageAccounting({
      records: [attempt({ id: 'missing-sources', stage: 'model_analysis:batch-a', metadata: {
        usageContext: { phase: 'semantic_support' },
      } })],
      physicalReads: [],
    });

    expect(result.byStage.find(stage => stage.stage === 'model_analysis')).toMatchObject({
      aiFileCount: null, aiFileAppearances: null,
    });
    expect(result.sourceInventory).toMatchObject({
      totalUniqueFiles: null, unknownAiFileAttempts: 1, status: 'partial',
    });
  });

  it('projects only allowlisted request metadata and never returns prompts, source bodies, or secrets', () => {
    const result = projectReviewUsageAccounting({
      records: [attempt({ id: 'safe', stage: 'model_analysis:batch-1', metadata: {
        providerReportedTotalTokens: 110,
        apiKey: 'PRIVATE_API_KEY', prompt: 'PRIVATE_PROMPT',
        usageContext: { phase: 'initial_analysis', sources: [{ ...sourceV1, sourceBody: 'PRIVATE_SOURCE' }],
          components: { promptCharacters: 200, privateField: 'PRIVATE_CONTEXT' }, estimation: { inputTokens: 100, method: 'characters_divided_by_2' },
          rejectedResponse: 'PRIVATE_MODEL_RESPONSE' },
      } })],
      physicalReads: [],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PRIVATE_');
    expect(result.sourceInventory.files[0]).toMatchObject({ artifactId: 'artifact-a', filePath: 'src/auth.ts', artifactVersionId: 'version-1' });
    expect(result.byStage.find(stage => stage.stage === 'model_analysis')?.requestContext).toMatchObject({
      callsWithContext: 1, estimatedInputTokens: 100, componentsCharacters: { promptCharacters: 200 },
    });
  });

  it('marks oversized and invalid source reference lists partial instead of reporting a truncated exact count', () => {
    const oversizedSources = Array.from({ length: 1_025 }, (_, index) => ({
      artifactId: `artifact-${index}`, artifactVersionId: `version-${index}`, contentHash: `hash-${index}`,
      filePath: `src/file-${index}.ts`, lineStart: 1, lineEnd: 2,
    }));
    const result = projectReviewUsageAccounting({
      records: [attempt({ id: 'oversized', stage: 'model_analysis:batch-a', metadata: {
        usageContext: { phase: 'initial_analysis', sources: oversizedSources },
      } })],
      physicalReads: [],
    });

    expect(result.sourceInventory).toMatchObject({ status: 'partial', totalUniqueFiles: null, knownUniqueFiles: 1_024, unknownAiFileAttempts: 1 });
    expect(result.byStage.find(stage => stage.stage === 'model_analysis')).toMatchObject({ aiFileCount: null, aiFileAppearances: null });

    const invalid = projectReviewUsageAccounting({
      records: [attempt({ id: 'invalid', stage: 'model_analysis:batch-a', metadata: {
        usageContext: { phase: 'initial_analysis', sources: [{ ...sourceV1, filePath: 'x'.repeat(2_049) }] },
      } })],
      physicalReads: null,
    });
    expect(invalid.sourceInventory).toMatchObject({ status: 'unavailable', totalUniqueFiles: null, knownUniqueFiles: 0, unknownAiFileAttempts: 1 });
  });
});
