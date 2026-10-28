import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import { assessProjectReadiness } from '../../src/readiness/engine.js';
import type { ReadinessArtifact, ReadinessCategory } from '../../src/readiness/types.js';

const projectId = 'readiness-batch-proof';
const quotes = {
  requirements: {
    clarity: 'The service calculates order totals before accepting a checkout.',
    consistency: [
      'The service must keep order totals consistent across checkout, invoices, and refunds.',
      'Invoices and refunds must use the order total recorded at checkout.',
    ],
    testability: 'A completed checkout returns HTTP 201 and an invoice ID.',
    business_decisions: 'Orders above $5,000 require manager approval before payment capture.',
    boundaries: 'Order totals use USD, include tax, and exclude shipping.',
    exceptions: 'If payment capture fails, the order stays pending and no invoice is issued.',
    scope: 'The first release supports checkout, invoicing, refunds, and manager approval.',
  },
  design: {
    responsibilities: 'Checkout service validates orders and calculates totals.',
    interfaces: 'POST /checkout accepts order lines and returns an order ID.',
    data: 'Order records store lines, currency, tax, payment status, and invoice ID.',
    flows: 'Checkout saves the order, captures payment, then creates the invoice.',
    failure_decisions: 'If payment capture fails, the order remains pending and invoice creation stops.',
    scope: 'The design supports checkout, invoicing, refunds, and manager approval.',
  },
  standards: {
    applicability: 'This policy applies to the Centinel TypeScript sidecar.',
    checkability: 'CI checks TypeScript changes with pnpm lint and pnpm typecheck.',
    conflicts: [
      'TypeScript files use single quotes.',
      'String literals in TypeScript must use single quotes.',
    ],
  },
} as const;
const body = Object.values(quotes).flatMap(category => Object.values(category).flat()).join('\n');

const criteria: Record<Exclude<ReadinessCategory, 'repository'>, string[]> = {
  requirements: ['clarity', 'consistency', 'testability', 'business_decisions', 'boundaries', 'exceptions', 'scope'],
  design: ['responsibilities', 'interfaces', 'data', 'flows', 'failure_decisions', 'scope'],
  standards: ['applicability', 'checkability', 'conflicts'],
};

function artifact(index: number): Artifact {
  const filePath = `docs/spec-${index}.md`;
  return {
    id: `batch-source-${index}`, projectId, versionId: `version-${index}`, type: 'requirement', source: 'documents',
    fileName: `spec-${index}.md`, filePath, originalPath: filePath, contentHash: `hash-${index}`, createdAt: '2026-10-23T00:00:00.000Z',
  };
}

function input(count: number): ReadinessArtifact[] {
  return Array.from({ length: count }, (_, index) => ({ artifact: artifact(index), content: body }));
}

function categoryQuotes(category: keyof typeof criteria, criterion: string): string[] {
  const value = quotes[category][criterion as keyof typeof quotes[typeof category]];
  return Array.isArray(value) ? [...value] : [value as string];
}

function presentResponse(sourceIds: string[]) {
  const sourceId = sourceIds[0];
  return {
    categories: (Object.keys(criteria) as Array<keyof typeof criteria>).map(category => ({
      category,
      presence: 'present',
      classificationBasis: `Explicit ${category} material was found while reviewing every source in this batch.`,
      reviewedSourceIds: sourceIds,
      classificationEvidence: [{ sourceId, excerpt: categoryQuotes(category, criteria[category][0])[0] }],
      scopeCoverage: [{
        scopeItem: 'Checkout Flow',
        scopeEvidence: { sourceId, excerpt: quotes.requirements.scope },
        status: 'covered',
        coverageEvidence: [{
          sourceId,
          excerpt: category === 'requirements'
            ? quotes.requirements.testability
            : category === 'design' ? quotes.design.responsibilities : quotes.standards.applicability,
        }],
      }],
      checks: criteria[category].map(criterion => ({
        criterion,
        status: 'pass',
        basis: `The supplied material gives explicit, criterion-specific guidance for ${criterion} in this project.`,
        title: `${criterion} is supported`,
        detail: `${criterion} has explicit project guidance.`,
        recommendation: 'Keep the guidance current as the project changes.',
        evidence: categoryQuotes(category, criterion).map(excerpt => ({ sourceId, excerpt })),
      })),
    })),
  };
}

function missingResponse(sourceIds: string[]) {
  return {
    categories: (Object.keys(criteria) as Array<keyof typeof criteria>).map(category => ({
      category,
      presence: 'missing',
      classificationBasis: `Every source in this batch was reviewed and no ${category} material was found.`,
      reviewedSourceIds: sourceIds,
      classificationEvidence: [],
      scopeCoverage: [],
      checks: criteria[category].map(criterion => ({
        criterion,
        status: 'unknown',
        basis: `There is no ${category} content to assess for ${criterion} in this source batch.`,
        title: `${criterion} cannot be assessed`,
        detail: `No ${category} content was found in this batch.`,
        recommendation: 'Add relevant project material and rerun readiness.',
        evidence: [],
      })),
    })),
  };
}

function requestData<T>(request: StaticModelRequest): T {
  return JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2)) as T;
}

function providerFor(options: {
  comparison?: (payload: { tasks: Array<{ category: string; criterion: string }>; candidates: Array<{ category: string; criterion: string; batchNumber: number; sourceId: string; excerpt: string }> }) => unknown;
  missing?: boolean;
  invalidMissingBatch?: number;
  transform?: (response: ReturnType<typeof presentResponse>, batchNumber: number) => void;
}) {
  const analyze = vi.fn(async (request: StaticModelRequest) => {
    if (request.stage === 'project_readiness_assessment') {
      const batch = requestData<{ sources: Array<{ sourceId: string }>; batchNumber: number }>(request);
      const sourceIds = batch.sources.map(source => source.sourceId);
      if (!options.missing) {
        const response = presentResponse(sourceIds);
        options.transform?.(response, batch.batchNumber);
        return { result: response };
      }
      const response = missingResponse(sourceIds);
      if (options.invalidMissingBatch === Number(requestData<{ batchNumber: number }>(request).batchNumber)) {
        response.categories.find(category => category.category === 'requirements')!.scopeCoverage = [{
          scopeItem: 'Checkout Flow',
          scopeEvidence: { sourceId: sourceIds[0], excerpt: quotes.requirements.scope },
          status: 'unknown',
          coverageEvidence: [],
        }];
      }
      return { result: response };
    }
    const payload = requestData<Parameters<NonNullable<typeof options.comparison>>[0]>(request);
    return { result: options.comparison?.(payload) ?? { comparisons: [] } };
  });
  return { analyze };
}

function allBatchPass(payload: Parameters<NonNullable<Parameters<typeof providerFor>[0]['comparison']>>[0]) {
  return {
    comparisons: payload.tasks.map(task => {
      const candidates = payload.candidates.filter(item => item.category === task.category && item.criterion === task.criterion);
      const evidence = [...new Set(candidates.map(item => item.batchNumber))].map(batchNumber => {
        const item = candidates.find(candidate => candidate.batchNumber === batchNumber)!;
        return { batchNumber, sourceId: item.sourceId, excerpt: item.excerpt };
      });
      return { ...task, status: 'pass', basis: 'Exact candidate statements from every relevant batch were reviewed together.', evidence };
    }),
  };
}

const readinessInput = (artifacts: ReadinessArtifact[]) => ({
  projectId, description: 'A checkout application.', artifacts, sourceFingerprint: 'frozen-input',
});

describe('Readiness semantic batching and cross-batch evidence', () => {
  it('examines the full source inventory and requires pass evidence from all three relevant batches', async () => {
    const artifacts = input(65);
    const provider = providerFor({ comparison: allBatchPass });
    const result = await assessProjectReadiness(readinessInput(artifacts), provider);
    const semanticRequests = provider.analyze.mock.calls.filter(([request]) => request.stage === 'project_readiness_assessment');
    const submittedIds = semanticRequests.flatMap(([request]) => requestData<{ sources: Array<{ sourceId: string }> }>(request).sources.map(source => source.sourceId));

    expect(semanticRequests).toHaveLength(3);
    expect(semanticRequests.map(([request]) => requestData<{ sources: unknown[] }>(request).sources.length)).toEqual([32, 32, 1]);
    expect(submittedIds).toEqual(artifacts.map(item => item.artifact.id));
    expect(result.validationDiagnostics).toMatchObject({
      batchCount: 3,
      categories: expect.arrayContaining([
        expect.objectContaining({ category: 'requirements', sourceInventoryValid: true, crossBatchComparison: 'pass' }),
        expect.objectContaining({ category: 'standards', sourceInventoryValid: true, crossBatchComparison: 'pass' }),
      ]),
    });
    expect(result.categories.filter(category => category.id !== 'repository').map(category => category.state)).toEqual(['completed', 'completed', 'completed']);
  });

  it('keeps a cross-batch pass unknown when it cites only two of three batches', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({
      comparison: payload => ({
        comparisons: payload.tasks.map(task => {
          const candidates = payload.candidates.filter(item => item.category === task.category && item.criterion === task.criterion);
          const evidence = [1, 2].map(batchNumber => {
            const item = candidates.find(candidate => candidate.batchNumber === batchNumber)!;
            return { batchNumber, sourceId: item.sourceId, excerpt: item.excerpt };
          });
          return { ...task, status: 'pass', basis: 'Two source batches support the comparison, while one relevant batch is absent.', evidence };
        }),
      }),
    }));

    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.crossBatchComparison).toBe('unknown');
    expect(result.categories.find(category => category.id === 'requirements')?.state).toBe('incomplete');
    expect(result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'consistency')?.status).toBe('unknown');
    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.checks
      .find(check => check.id === 'consistency')?.reasonCounts?.cross_batch_batch_coverage_incomplete).toBe(1);
  });

  it('rejects exact citations offered for another category and criterion task', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({
      comparison: payload => ({
        comparisons: payload.tasks.map(task => {
          const wrongTask = task.category === 'requirements' ? 'standards' : 'requirements';
          const wrongCriterion = task.category === 'requirements' ? 'conflicts' : 'consistency';
          const candidates = payload.candidates.filter(item => item.category === wrongTask && item.criterion === wrongCriterion);
          const evidence = [1, 2, 3].map(batchNumber => {
            const item = candidates.find(candidate => candidate.batchNumber === batchNumber)!;
            return { batchNumber, sourceId: item.sourceId, excerpt: item.excerpt };
          });
          return { ...task, status: 'pass', basis: 'Exact quotes from a different category and criterion were compared.', evidence };
        }),
      }),
    }));

    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.crossBatchComparison).toBe('unknown');
    expect(result.categories.find(category => category.id === 'requirements')?.state).toBe('incomplete');
    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.checks
      .find(check => check.id === 'consistency')?.reasonCounts?.cross_batch_candidate_mismatch).toBe(1);
  });

  it('distinguishes an explicit cross-batch unknown from invalid candidate evidence', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({
      comparison: payload => ({
        comparisons: payload.tasks.map(task => {
          const candidates = payload.candidates.filter(item => item.category === task.category && item.criterion === task.criterion);
          const evidence = [...new Set(candidates.map(item => item.batchNumber))].slice(0, 2).map(batchNumber => {
            const item = candidates.find(candidate => candidate.batchNumber === batchNumber)!;
            return { batchNumber, sourceId: item.sourceId, excerpt: item.excerpt };
          });
          return { ...task, status: 'unknown', basis: 'The valid candidate statements do not support a confident comparison.', evidence };
        }),
      }),
    }));

    const diagnostic = result.validationDiagnostics?.categories.find(category => category.category === 'requirements');
    expect(diagnostic?.checks.find(check => check.id === 'consistency')?.reasonCounts?.cross_batch_model_unknown).toBe(1);
    expect(diagnostic?.checks.find(check => check.id === 'consistency')?.reasonCounts?.cross_batch_candidate_mismatch).toBeUndefined();
  });

  it('keeps contradictory non-scope batch pass and gap results unknown with their exact evidence', async () => {
    const result = await assessProjectReadiness(readinessInput(input(33)), providerFor({
      transform: (response, batchNumber) => {
        if (batchNumber !== 2) return;
        const testability = response.categories.find(category => category.category === 'requirements')!
          .checks.find(check => check.criterion === 'testability')!;
        testability.status = 'gap';
        testability.basis = 'The second batch does not state an observable checkout outcome.';
        testability.title = 'Checkout behavior is not testable';
        testability.detail = 'No observable checkout outcome is stated in this source batch.';
        testability.recommendation = 'Define a measurable checkout outcome.';
      },
    }));

    const requirements = result.categories.find(category => category.id === 'requirements');
    const testability = requirements?.criteria?.find(item => item.id === 'testability');
    const diagnostic = result.validationDiagnostics?.categories.find(category => category.category === 'requirements');
    const checkDiagnostic = diagnostic?.checks.find(check => check.id === 'testability');
    const finding = result.findings.find(item => item.category === 'requirements' && item.title === 'Evidence is needed for testability');

    expect(result.policyVersion).toBe('readiness-2026-10-23.3');
    expect(result.validationDiagnostics?.schemaVersion).toBe('readiness-validation-2026-10-23.3');
    expect(requirements?.state).toBe('incomplete');
    expect(testability?.status).toBe('unknown');
    expect(testability?.basis).toContain('both pass and gap assessments');
    expect(testability?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'batch-source-0', excerpt: quotes.requirements.testability }),
      expect.objectContaining({ artifactId: 'batch-source-32', excerpt: quotes.requirements.testability }),
    ]));
    expect(checkDiagnostic).toMatchObject({
      rawStatusCounts: { pass: 1, gap: 1, unknown: 0, invalid: 0 },
      effectiveStatus: 'unknown',
      reasonCounts: { batch_status_conflict: 1 },
    });
    expect(diagnostic?.reasonCounts?.batch_status_conflict).toBe(1);
    expect(finding).toMatchObject({
      title: 'Evidence is needed for testability',
      description: 'The assessed source batches disagree about testability. The result remains unresolved until the cited statements are reconciled.',
      recommendation: 'Review the cited testability statements together, resolve the discrepancy, then rerun readiness.',
    });
    expect(finding?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'batch-source-0', excerpt: quotes.requirements.testability }),
      expect.objectContaining({ artifactId: 'batch-source-32', excerpt: quotes.requirements.testability }),
    ]));
  });

  it('preserves an all-gap non-scope criterion across batches', async () => {
    const result = await assessProjectReadiness(readinessInput(input(33)), providerFor({
      transform: response => {
        const testability = response.categories.find(category => category.category === 'requirements')!
          .checks.find(check => check.criterion === 'testability')!;
        testability.status = 'gap';
        testability.basis = 'The source batch does not state an observable checkout outcome.';
        testability.title = 'Checkout behavior is not testable';
        testability.detail = 'The source batch has no observable checkout outcome.';
        testability.recommendation = 'Define a measurable checkout outcome.';
      },
    }));

    const check = result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'testability');
    const diagnostic = result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.checks
      .find(item => item.id === 'testability');
    expect(check?.status).toBe('gap');
    expect(diagnostic).toMatchObject({ rawStatusCounts: { pass: 0, gap: 2, unknown: 0, invalid: 0 }, effectiveStatus: 'gap' });
    expect(diagnostic?.reasonCounts?.batch_status_conflict).toBeUndefined();
  });

  it('keeps pass and unknown batch results unknown without labeling them a pass-gap conflict', async () => {
    const result = await assessProjectReadiness(readinessInput(input(33)), providerFor({
      transform: (response, batchNumber) => {
        if (batchNumber !== 2) return;
        response.categories.find(category => category.category === 'requirements')!
          .checks.find(check => check.criterion === 'testability')!.status = 'unknown';
      },
    }));

    const check = result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'testability');
    const diagnostic = result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.checks
      .find(item => item.id === 'testability');
    expect(check?.status).toBe('unknown');
    expect(diagnostic).toMatchObject({ rawStatusCounts: { pass: 1, gap: 0, unknown: 1, invalid: 0 }, effectiveStatus: 'unknown' });
    expect(diagnostic?.reasonCounts?.batch_status_conflict).toBeUndefined();
  });

  it('keeps a verified cross-batch comparison outcome authoritative', async () => {
    const result = await assessProjectReadiness(readinessInput(input(33)), providerFor({
      comparison: payload => ({
        comparisons: payload.tasks.map(task => {
          const candidates = payload.candidates.filter(item => item.category === task.category && item.criterion === task.criterion);
          const evidence = [...new Set(candidates.map(item => item.batchNumber))].map(batchNumber => {
            const item = candidates.find(candidate => candidate.batchNumber === batchNumber)!;
            return { batchNumber, sourceId: item.sourceId, excerpt: item.excerpt };
          });
          return {
            ...task,
            status: task.category === 'requirements' && task.criterion === 'consistency' ? 'gap' : 'pass',
            basis: 'Exact statements from every relevant batch were compared together.',
            evidence,
          };
        }),
      }),
    }));

    const requirements = result.categories.find(category => category.id === 'requirements');
    const consistency = requirements?.criteria?.find(item => item.id === 'consistency');
    const diagnostic = result.validationDiagnostics?.categories.find(category => category.category === 'requirements');
    expect(consistency?.status).toBe('gap');
    expect(diagnostic?.crossBatchComparison).toBe('gap');
    expect(diagnostic?.checks.find(check => check.id === 'consistency')?.effectiveStatus).toBe('gap');
  });

  it('leaves single-batch criterion outcomes unchanged', async () => {
    const result = await assessProjectReadiness(readinessInput(input(1)), providerFor({}));

    expect(result.validationDiagnostics?.batchCount).toBe(1);
    expect(result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'testability')?.status)
      .toBe('pass');
  });

  it('merges duplicate scope labels while preserving every exact source anchor', async () => {
    const provider = providerFor({
      transform: (response, batchNumber) => {
        if (batchNumber !== 1) return;
        const requirements = response.categories.find(category => category.category === 'requirements')!;
        requirements.scopeCoverage.push({
          scopeItem: requirements.scopeCoverage[0].scopeItem,
          scopeEvidence: { sourceId: 'batch-source-1', excerpt: quotes.design.scope },
          status: 'covered',
          coverageEvidence: [{ sourceId: 'batch-source-1', excerpt: quotes.requirements.business_decisions }],
        });
      },
    });
    const result = await assessProjectReadiness(readinessInput(input(2)), provider);

    expect(result.categories.find(category => category.id === 'requirements')?.state).toBe('completed');
    const scope = result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'scope');
    expect(scope?.status).toBe('pass');
    expect(scope?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'batch-source-0', excerpt: quotes.requirements.scope }),
      expect.objectContaining({ artifactId: 'batch-source-1', excerpt: quotes.design.scope }),
    ]));
    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.reasonCounts?.scope_duplicate_merged)
      .toBeGreaterThan(0);
  });

  it('keeps conflicting duplicate scope statuses unknown', async () => {
    const provider = providerFor({
      transform: (response, batchNumber) => {
        if (batchNumber !== 1) return;
        const requirements = response.categories.find(category => category.category === 'requirements')!;
        requirements.scopeCoverage.push({
          scopeItem: requirements.scopeCoverage[0].scopeItem,
          scopeEvidence: { sourceId: 'batch-source-1', excerpt: quotes.design.scope },
          status: 'gap',
          coverageEvidence: [],
        });
      },
    });
    const result = await assessProjectReadiness(readinessInput(input(2)), provider);

    expect(result.categories.find(category => category.id === 'requirements')?.state).toBe('incomplete');
    expect(result.categories.find(category => category.id === 'requirements')?.criteria?.find(item => item.id === 'scope')?.status).toBe('unknown');
    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.reasonCounts?.scope_duplicate_status_conflict)
      .toBeGreaterThan(0);
  });

  it('does not let an empty batch-local scope inventory erase a validated scope item from another batch', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({
      comparison: allBatchPass,
      transform: (response, batchNumber) => {
        if (batchNumber !== 2) return;
        const requirements = response.categories.find(category => category.category === 'requirements')!;
        requirements.scopeCoverage = [];
        const scope = requirements.checks.find(check => check.criterion === 'scope')!;
        scope.status = 'unknown';
        scope.evidence = [];
      },
    }));

    const requirements = result.categories.find(category => category.id === 'requirements');
    expect(requirements?.state).toBe('completed');
    expect(requirements?.criteria?.find(item => item.id === 'scope')?.status).toBe('pass');
    expect(requirements?.criteria?.find(item => item.id === 'scope')?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'batch-source-0', excerpt: quotes.requirements.scope }),
      expect.objectContaining({ artifactId: 'batch-source-64', excerpt: quotes.requirements.scope }),
    ]));
  });

  it('returns Missing only when every validated batch reports empty category evidence and scope', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({ missing: true }));

    expect(result.validationDiagnostics?.batchCount).toBe(3);
    expect(result.validationDiagnostics?.categories.every(category => category.rawPresence === 'missing' && category.missingSemanticsValid)).toBe(true);
    expect(result.categories.filter(category => category.id !== 'repository').map(category => category.state)).toEqual(['missing', 'missing', 'missing']);
  });

  it('does not return Missing when one supposedly missing batch supplies scope evidence', async () => {
    const result = await assessProjectReadiness(readinessInput(input(65)), providerFor({ missing: true, invalidMissingBatch: 2 }));

    expect(result.validationDiagnostics?.categories.find(category => category.category === 'requirements')?.missingSemanticsValid).toBe(false);
    expect(result.categories.find(category => category.id === 'requirements')?.state).toBe('incomplete');
    expect(result.categories.find(category => category.id === 'design')?.state).toBe('missing');
  });
});
