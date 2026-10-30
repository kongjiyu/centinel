import { describe, expect, it, vi } from 'vitest';
import { buildReviewDynamicContext, type ReviewContextInput } from '../../src/review/dynamicContextExport.js';
import { contextNeedsAcknowledgment, validateIncomingContext } from '../../src/dynamic/context.js';
import { DynamicService } from '../../src/dynamic/service.js';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
import { handleDynamicRoute } from '../../src/dynamic/routes.js';
import { calculateRunCoverage } from '../../src/dynamic/coverage.js';

const input = (overrides: Partial<ReviewContextInput> = {}): ReviewContextInput => ({
  projectId: 'project-a',
  reviewId: 'review-1',
  reviewName: 'Todo review',
  approved: true,
  snapshotCapturedAt: '2026-10-30T10:00:00.000Z',
  traceabilityAvailable: true,
  traceability: [
    { requirementId: 'req-login', title: 'REQ-2 Login', description: 'Users sign in with their own credentials.', state: 'complete' },
    { requirementId: 'req-persist', title: 'REQ-4 Persistence', description: 'Todos survive a reload.', state: 'missing' },
  ],
  manifestAvailable: true,
  manifest: [{ id: 'artifact-app', name: 'todo-app.html', path: 'todo-app.html', versionId: 'version-1', contentHash: 'hash-1' }],
  currentHashes: new Map([['artifact-app', 'hash-1']]),
  ...overrides,
});

describe('Review snapshot to Dynamic context', () => {
  it('exports frozen requirements as criteria that the Dynamic contract accepts', () => {
    const context = buildReviewDynamicContext(input());
    const validated = validateIncomingContext(context, 'project-a')!;
    expect(validated.provenance).toBe('review-snapshot');
    expect(validated.approvalState).toBe('approved');
    expect(validated.requirements.map(item => item.criteria[0].id)).toEqual(['req-login:statement', 'req-persist:statement']);
    expect(validated.risks).toEqual([expect.objectContaining({ requirementId: 'req-persist', priority: 'high' })]);
    expect(validated.target).toEqual({ repository: null, commit: null, deploymentVersion: null });
    expect(contextNeedsAcknowledgment(validated)).toBe(false);
  });

  it('marks changed sources stale and unapproved Reviews pending so they need acknowledgment', () => {
    const context = buildReviewDynamicContext(input({ approved: false, currentHashes: new Map([['artifact-app', 'hash-2']]) }));
    expect(context.sources.find(source => source.id === 'artifact-app')?.currency).toBe('stale');
    expect(context.approvalState).toBe('pending');
    expect(contextNeedsAcknowledgment(validateIncomingContext(context, 'project-a'))).toBe(true);
  });

  it('discloses a Review without requirements instead of inventing criteria', () => {
    const context = buildReviewDynamicContext(input({ traceability: [] }));
    expect(context.requirements).toEqual([]);
    expect(context.limitations.join(' ')).toMatch(/captured no requirements/i);
  });

  it('still rejects mock-style null targets and cross-project Review context', () => {
    const context = buildReviewDynamicContext(input());
    expect(() => validateIncomingContext({ ...context, provenance: 'mock-static' }, 'project-a')).toThrow();
    expect(() => validateIncomingContext(context, 'project-b')).toThrow();
  });

  it('rebuilds the saved context from the server Review instead of trusting the client copy', async () => {
    const service = new DynamicService(new InMemoryDynamicRepository());
    const trusted = buildReviewDynamicContext(input());
    const reviewContext = vi.fn().mockResolvedValue(trusted);
    const forged = { ...trusted, approvalState: 'approved', requirements: [{ ...trusted.requirements[0], description: 'Forged' }] };
    const response = await handleDynamicRoute({
      method: 'POST', pathname: '/projects/project-a/dynamic/missions',
      readBody: async () => ({ name: 'Login works', goal: 'Sign in', targetUrl: 'http://localhost:3000', maxSteps: 3, context: forged, contextAcknowledged: false,
        checks: [{ id: 'login', criterionId: 'req-login:statement', description: 'Dashboard visible', kind: 'visible_text', expected: 'Dashboard', required: true }] }),
    }, { actorId: 'actor', service, reviewContext, requireProjectMember: async () => {}, prepareExecution: vi.fn(), cancelExecution: vi.fn() });
    expect(response?.status).toBe(201);
    expect(reviewContext).toHaveBeenCalledWith('project-a', 'review-1');
    const revision = response!.body as { id: string; context: { requirements: Array<{ description: string }> } };
    expect(revision.context.requirements[0].description).toBe(trusted.requirements[0].description);
    const { run } = await service.start('project-a', 'actor', revision.id, 'key');
    const coverage = calculateRunCoverage(run);
    expect(coverage).toMatchObject({ availability: 'available', provenance: 'review-snapshot', totalCriteria: 2 });
  });
});
