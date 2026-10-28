import fs from 'node:fs';
import path from 'node:path';
import { deriveReviewAnalysisMap } from '../../sidecar/src/review/featurePathAnalysis.js';
import {
  analysisMapForBatchPrompt,
  contextForAssessmentBatch,
  planAssessmentBatches,
  type AssessmentSourceSegment,
} from '../../sidecar/src/review/assessmentBatches.js';
import { StaticReviewOrchestratorService } from '../../sidecar/src/review/orchestrator.js';
import {
  buildCitationRepairPrompt,
  buildDomainCoverageRepairPrompt,
  assertReviewPromptWithinContext,
} from '../../sidecar/src/review/sourcePrompt.js';
import { runStaticAnalysis } from '../../sidecar/src/staticEngine.js';
import { normalizeDeterministicFinding } from '../../sidecar/src/review/findings.js';

process.chdir(path.resolve(import.meta.dirname, '../..'));

const evidenceRoot = 'evidence/public-repo-outcomes-2026-10-22';
const run = fs.readFileSync(path.join(evidenceRoot, 'active-mitigation-run.txt'), 'utf8').trim();
const manifest = JSON.parse(fs.readFileSync('docs/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json', 'utf8'));
const events = fs.readdirSync(run).filter(file => /^\d{4}-.+\.json$/.test(file)).sort()
  .map(file => JSON.parse(fs.readFileSync(path.join(run, file), 'utf8')));
const orchestrator = new StaticReviewOrchestratorService({ repository: {} as any }) as any;
const output = {
  kind: 'offline-v10-prompt-packet-character-comparison-not-model-assessment',
  capturedAt: new Date().toISOString(),
  methodology: {
    inputs: 'Same frozen selected-source files and artifact manifests for before and after.',
    before: 'v10 baseline packet behavior: exact-version excerpt filtering, with full excerpt bodies and the complete batch coverage lists.',
    after: 'Same sources and feature IDs; exact-substring ranked excerpt bodies are replaced by source references and unrelated artifact-list entries are filtered from the prompt map.',
    sourceProof: 'Unique planned source segments are reconstructed by original line range, encoded as UTF-8 and byte-compared to each selected file; all feature IDs must be present exactly once.',
    tokenEstimate: 'Character counts divided by four, rounded up, are rough estimates only; this is not provider tokenization or billable usage.',
    execution: 'Uses only the local TypeScript parser and deterministic static rules. Does not call a provider or execute repository code.',
    excluded: 'Provider framing, output tokens, live repair frequency, embedding provider usage and semantic quality are not measured here.',
  },
  repositories: [] as any[],
};

function baselineContext(context: any, sources: AssessmentSourceSegment[]) {
  return context ? { ...context, selectedChunks: context.selectedChunks?.filter((chunk: any) => sources.some(source =>
    source.artifact.filePath === chunk.filePath && source.artifact.versionId === chunk.artifactVersionId
    && chunk.content.length > 0 && source.content.includes(chunk.content))).slice(0, 8) } : null;
}

function coverageProof(originalSources: Array<{ artifact: any; content: string; inputBytes: Buffer }>, batches: Array<{ features: any[]; sources: AssessmentSourceSegment[] }>, featureIds: string[]) {
  const features = batches.flatMap(batch => batch.features.map(feature => feature.id));
  const uniqueFeatureIds = new Set(features);
  const featureCoverageExact = features.length === featureIds.length
    && uniqueFeatureIds.size === featureIds.length && featureIds.every(id => uniqueFeatureIds.has(id));

  const segmentByKey = new Map<string, AssessmentSourceSegment>();
  for (const batch of batches) for (const source of batch.sources) {
    segmentByKey.set(`${source.artifact.id}\u0000${source.lineStart}\u0000${source.lineEnd}`, source);
  }
  const files = originalSources.map(original => {
    const segments = Array.from(segmentByKey.values()).filter(source => source.artifact.id === original.artifact.id)
      .sort((left, right) => left.lineStart - right.lineStart);
    let nextLine = 1;
    let exact = segments.length > 0;
    for (const segment of segments) {
      if (segment.lineStart !== nextLine) exact = false;
      nextLine = segment.lineEnd + 1;
    }
    const reconstructed = segments.map(segment => segment.content).join('\n');
    const bytesMatch = Buffer.compare(Buffer.from(reconstructed, 'utf8'), original.inputBytes) === 0;
    exact = exact && nextLine - 1 === original.content.split('\n').length && reconstructed === original.content && bytesMatch;
    return { artifactId: original.artifact.id, filePath: original.artifact.filePath, segments: segments.length,
      exactTextCoverage: exact, exactByteCoverage: bytesMatch };
  });
  return { featureCoverageExact, selectedFileCount: originalSources.length, files, allSelectedTextCovered: files.every(file => file.exactTextCoverage) };
}

function componentSummary() {
  return { total: 0, max: 0 };
}

for (const item of manifest.cases) {
  const artifacts = events.filter((event: any) => event.instanceId === item.instanceId && event.kind === 'imported-artifacts').at(-1)?.data;
  if (!Array.isArray(artifacts)) throw new Error(`Missing frozen artifact manifest for ${item.alias}.`);
  const sources = artifacts.map((artifact: any) => {
    const inputBytes = fs.readFileSync(path.join(item.inputDirectory, artifact.filePath));
    return { artifact, state: 'available', inputBytes, content: inputBytes.toString('utf8') };
  });
  const sourceById = new Map(sources.map((source: any) => [source.artifact.id, source]));
  const staticFindings = await runStaticAnalysis(item.alias, artifacts, 'offline-v10-prompt-packet-benchmark', {
    contentReader: async (artifact: any) => (sourceById.get(artifact.id) as any).content,
  });
  const deterministic = staticFindings.map(finding => normalizeDeterministicFinding(
    finding, artifacts.find((artifact: any) => artifact.filePath === finding.filePath)?.id,
  ));
  const map = deriveReviewAnalysisMap(sources);
  const batches = planAssessmentBatches(map, sources);
  const proof = coverageProof(sources, batches, map.features.map(feature => feature.id));
  if (!proof.featureCoverageExact || !proof.allSelectedTextCovered) {
    throw new Error(`Source or feature coverage proof failed for ${item.alias}.`);
  }

  const metrics = {
    batches: batches.length,
    features: map.features.length,
    selectedFiles: sources.length,
    sourceSegments: 0,
    before: { prompt: componentSummary(), system: componentSummary(), schema: componentSummary(), citationRepair: componentSummary(), domainRepair: componentSummary() },
    after: { prompt: componentSummary(), system: componentSummary(), schema: componentSummary(), citationRepair: componentSummary(), domainRepair: componentSummary() },
  };

  for (const batch of batches) {
    const chunkContext = {
      files: [], totalSymbols: 0, estimatedTokens: 4_800,
      reason: 'Offline bounded ranking-aid stress fixture.',
      selectedChunks: Array.from({ length: 8 }, (_, index) => {
        const source = batch.sources[index % batch.sources.length];
        return { artifactVersionId: source.artifact.versionId, filePath: source.artifact.filePath,
          ordinal: index, content: source.content.slice(0, 2_400) };
      }),
    };
    const fullBatchMap = { ...map, features: batch.features };
    const beforeRequest = await orchestrator.buildModelRequest({ id: 'offline', projectId: item.alias, reviewType: 'code_review',
      config: { instructions: 'Assess supplied frozen sources across four domains using exact evidence.' } },
      baselineContext(chunkContext, batch.sources), deterministic, new AbortController().signal,
      batch.sources, [], [], null, fullBatchMap, []);
    const afterRequest = await orchestrator.buildModelRequest({ id: 'offline', projectId: item.alias, reviewType: 'code_review',
      config: { instructions: 'Assess supplied frozen sources across four domains using exact evidence.' } },
      contextForAssessmentBatch(chunkContext, batch.sources), deterministic, new AbortController().signal,
      batch.sources, [], [], null, analysisMapForBatchPrompt(fullBatchMap, batch.sources), []);
    const findings = Array.from({ length: 16 }, (_, index) => {
      const source = batch.sources[index % batch.sources.length];
      return { filePath: source.artifact.filePath, lineNumber: Math.floor((source.lineStart + source.lineEnd) / 2) };
    });
    const feedback = findings.map((_, index) => ({ findingIndex: index + 1, field: 'evidence' as const, code: 'excerpt_mismatch' as const }));
    const beforeCitation = buildCitationRepairPrompt(beforeRequest.prompt, 'source_evidence', feedback, { findings }, batch.sources);
    const afterCitation = buildCitationRepairPrompt(afterRequest.prompt, 'source_evidence', feedback, { findings }, batch.sources);
    const issues = batch.features.flatMap(feature => (['security', 'business', 'technical', 'personnel'] as const)
      .map(domain => ({ featureId: feature.id, domain, code: 'local_domain_unverified' as const })));
    const beforeDomain = buildDomainCoverageRepairPrompt(beforeRequest.prompt, issues, fullBatchMap);
    const compactBatchMap = analysisMapForBatchPrompt(fullBatchMap, batch.sources);
    const afterDomain = buildDomainCoverageRepairPrompt(afterRequest.prompt, issues, compactBatchMap);

    for (const [target, prompt, systemPrompt, schema, citationRepair, domainRepair] of [
      [metrics.before, beforeRequest.prompt, beforeRequest.systemPrompt, beforeRequest.outputSchema, beforeCitation, beforeDomain],
      [metrics.after, afterRequest.prompt, afterRequest.systemPrompt, afterRequest.outputSchema, afterCitation, afterDomain],
    ] as const) {
      assertReviewPromptWithinContext(prompt, 200_000);
      assertReviewPromptWithinContext(citationRepair, 200_000);
      assertReviewPromptWithinContext(domainRepair, 200_000);
      for (const [key, value] of [['prompt', prompt.length], ['system', systemPrompt.length],
        ['schema', JSON.stringify(schema).length], ['citationRepair', citationRepair.length], ['domainRepair', domainRepair.length]] as const) {
        target[key].total += value;
        target[key].max = Math.max(target[key].max, value);
      }
    }
  }

  metrics.sourceSegments = new Set(batches.flatMap(batch => batch.sources.map(source =>
    `${source.artifact.id}\u0000${source.lineStart}\u0000${source.lineEnd}`))).size;
  const charDelta = (key: 'prompt' | 'system' | 'schema' | 'citationRepair' | 'domainRepair') => ({
    totalCharactersSaved: metrics.before[key].total - metrics.after[key].total,
    maxCharactersSaved: metrics.before[key].max - metrics.after[key].max,
    estimatedInputTokensSavedTotal: Math.ceil(Math.max(0, metrics.before[key].total - metrics.after[key].total) / 4),
  });
  output.repositories.push({ alias: item.alias, ...metrics, estimatedInputTokensByComponent: {
    beforePrompt: Math.ceil(metrics.before.prompt.total / 4), afterPrompt: Math.ceil(metrics.after.prompt.total / 4),
    beforeSchema: Math.ceil(metrics.before.schema.total / 4), afterSchema: Math.ceil(metrics.after.schema.total / 4),
  }, savings: {
    prompt: charDelta('prompt'), system: charDelta('system'), schema: charDelta('schema'),
    citationRepair: charDelta('citationRepair'), domainRepair: charDelta('domainRepair'),
  }, coverage: proof,
  invariantSchemaCharsEqual: metrics.before.schema.total === metrics.after.schema.total,
  invariantSystemCharsEqual: metrics.before.system.total === metrics.after.system.total,
  passed: metrics.before.prompt.total >= metrics.after.prompt.total && proof.featureCoverageExact && proof.allSelectedTextCovered,
  });
}

if (output.repositories.length !== 5 || output.repositories.some((repository: any) => !repository.passed)) {
  throw new Error('The five-repository prompt benchmark failed its acceptance checks.');
}
const outputPath = path.join(import.meta.dirname, 'five-repository-prompt-comparison.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
