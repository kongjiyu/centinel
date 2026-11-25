import { describe, it, expect, vi } from 'vitest';
import { handleFindingRoute, validateReview, validateRemediation } from '../../src/dynamic/findings/routes.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DynamicService } from '../../src/dynamic/service.js';
import type { CheckDefinition, CheckResult, EvidenceReference } from '../../src/dynamic/types.js';
import { LocalWorkspace } from '../../src/store/localWorkspace.js';
const review = { version: 1, decision: 'confirmed', note: 'Reproduced the observed failure', severity: 'high', priority: 'medium', confidence: 'high' };
describe('Dynamic finding verification boundary', () => {
    it('requires human triage and a reason rather than accepting an automatic confirmation', () => { expect(validateReview(review)).toEqual(review); for (const raw of [{ ...review, severity: null }, { ...review, priority: undefined }, { ...review, note: 'x' }, { ...review, version: 0 }, { ...review, actorId: 'spoofed' }, { ...review, confidence: ['high'] }, { ...review, decision: ['confirmed'] }])
        expect(() => validateReview(raw)).toThrow(); expect(validateReview({ version: 1, decision: 'rejected', note: 'Incorrect expectation' })).toMatchObject({ decision: 'rejected' }); });
    it('requires a pinned Run reference for manual resolution', () => { expect(() => validateRemediation({ version: 1, status: 'resolved', note: 'Model claims success' })).toThrow(); expect(validateRemediation({ version: 2, status: 'resolved', note: 'Inspected regression', regressionRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).toMatchObject({ status: 'resolved' }); expect(() => validateRemediation({ version: 2, status: ['open'], note: 'Invalid type' })).toThrow(); });
    it('checks membership before metadata, candidate collection or decision reads', async () => { const repository = { list: vi.fn(), get: vi.fn(), collect: vi.fn(), review: vi.fn(), remediate: vi.fn() }; const deps = { repository, requireMember: vi.fn().mockRejectedValue(Error('denied')), validatePrivate: vi.fn() }; for (const pathname of ['/projects/p/dynamic/findings', '/projects/p/dynamic/findings/f', '/projects/p/dynamic/runs/r/findings', '/projects/p/dynamic/findings/f/review'])
        await expect(handleFindingRoute({ method: 'GET', pathname, readBody: vi.fn() }, deps)).rejects.toThrow('denied'); for (const method of Object.values(repository))
        expect(method).not.toHaveBeenCalled(); });
    it('rejects local secret values before sending a shared decision and uses no caller actor ID', async () => { const repository = { list: vi.fn(), get: vi.fn(), collect: vi.fn(), review: vi.fn(), remediate: vi.fn() }; const deps = { repository, requireMember: vi.fn().mockResolvedValue(undefined), validatePrivate: vi.fn().mockRejectedValue(Error('private value')) }; const request = { method: 'POST', pathname: '/projects/p/dynamic/findings/f/review', readBody: vi.fn().mockResolvedValue(review) }; await expect(handleFindingRoute(request, deps)).rejects.toThrow('private value'); expect(repository.review).not.toHaveBeenCalled(); deps.validatePrivate.mockResolvedValue(undefined); repository.review.mockResolvedValue({ id: 'f', verification: 'confirmed' }); expect((await handleFindingRoute(request, deps))?.status).toBe(200); expect(repository.review).toHaveBeenCalledWith('p', 'f', review); });
    it('routes candidate collection only for its authenticated project and Run', async () => { const repository = { list: vi.fn(), get: vi.fn(), collect: vi.fn().mockResolvedValue([]), review: vi.fn(), remediate: vi.fn() }; const deps = { repository, requireMember: vi.fn().mockResolvedValue(undefined), validatePrivate: vi.fn() }; expect(await handleFindingRoute({ method: 'POST', pathname: '/projects/p/dynamic/runs/r/findings', readBody: vi.fn() }, deps)).toEqual({ status: 200, body: [] }); expect(repository.collect).toHaveBeenCalledWith('p', 'r'); });
});

it('records local functional findings, requires an evidenced regression and reopens a recurrence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'centinel-finding-fixture-'));
    const owner = randomUUID();
    const workspace = new LocalWorkspace(directory);
    const { id: project } = workspace.createProject(owner, { name: 'Fixture', description: '', workspacePath: '' });
    const service = new DynamicService(workspace.dynamicRuns(owner));
    const repository = workspace.dynamicFindings(owner);
    const check: CheckDefinition = { id: 'welcome', criterionId: 'heading', description: 'Show heading', kind: 'visible_text',
        required: true, expected: 'Welcome' };
    const revision = await service.saveMission(project, owner, { name: 'Check heading', goal: 'Read heading',
        targetUrl: 'http://localhost:3000', maxSteps: 3, checks: [check] });
    const run = async (verdict: 'passed' | 'failed', baseline?: string) => {
        const { run: saved } = await service.start(project, owner, revision.id, randomUUID(), undefined, baseline);
        await service.claim(project, saved.id);
        const ref: EvidenceReference = { id: randomUUID(), kind: 'checks', sha256: '',
            availability: 'local', capturedAt: new Date().toISOString() };
        const result: CheckResult = { checkId: check.id, criterionId: check.criterionId, verdict,
            observed: verdict === 'passed' ? 'Welcome' : '', reason: 'Fixture observation', evidenceIds: [ref.id], checkedAt: ref.capturedAt };
        const bytes = Buffer.from(JSON.stringify([result]));
        ref.sha256 = createHash('sha256').update(bytes).digest('hex');
        return service.finish(project, saved.id, [result], [ref], undefined, () => bytes);
    };
    try {
        const baseline = await run('failed');
        const [first] = await repository.collect(project, baseline.id);
        expect(first).toMatchObject({ verification: 'unreviewed', remediation: 'open', observationCount: 1, version: 1 });
        expect(await repository.collect(project, baseline.id)).toEqual([first]);
        expect(await workspace.dynamicFindings('other').list(project)).toEqual([]);
        const confirmed = await repository.review(project, first.id, validateReview(review));
        expect(confirmed).toMatchObject({ verification: 'confirmed', version: 2, severity: 'high' });
        await expect(repository.review(project, first.id, validateReview(review))).rejects.toThrow(/Finding changed/);
        const unrelated = await run('passed');
        await expect(repository.remediate(project, first.id, { version: 2, status: 'resolved',
            note: 'Reviewed the unrelated test', regressionRunId: unrelated.id })).rejects.toThrow(/pinned/);
        const regression = await run('passed', baseline.id);
        expect(await repository.remediate(project, first.id, { version: 2, status: 'resolved',
            note: 'Reviewed exact regression', regressionRunId: regression.id })).toMatchObject({ remediation: 'resolved', version: 3 });
        const later = await run('failed');
        expect(await repository.collect(project, later.id)).toMatchObject([{ id: first.id, remediation: 'open',
            verification: 'needs_investigation', version: 4, observationCount: 2 }]);
        workspace.close();
        const reopened = new LocalWorkspace(directory);
        try {
            const detail = await reopened.dynamicFindings(owner).get(project, first.id);
            expect(detail.events).toMatchObject([{ kind: 'verification', actorId: owner }, { kind: 'remediation', regressionRunId: regression.id },
                { kind: 'recurrence', automatic: true }]);
            expect(detail.observations.map(item => item.runId)).toEqual(expect.arrayContaining([baseline.id, later.id]));
        } finally { reopened.close(); }
    } finally {
        workspace.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
