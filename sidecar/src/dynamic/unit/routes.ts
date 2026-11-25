import { DynamicContractError } from '../types.js';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import { workspaceAuthorizationId } from '../workspace/registry.js';
import { resolveVitestWorkspace, UnitPrerequisiteError } from './runner.js';
import type { UnitRepository } from './repository.js';
import type { DynamicUnitRun } from './types.js';
export async function handleUnitRoute(request: {
    method: string;
    pathname: string;
    readBody(): Promise<Record<string, unknown>>;
}, deps: {
    ownerId: string;
    repository: UnitRepository;
    registry: WorkspaceRegistry;
    requireMember(project: string): Promise<void>;
    prepare?(project: string, profile: string): Promise<void>;
    execute(run: DynamicUnitRun): Promise<void>;
    cancel(id: string): void;
}) {
    const match = request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/environments\/([^/]+)\/unit-runs(?:\/([^/]+))?(?:\/(cancel))?$/);
    if (!match)
        return null;
    const [, project, profile, id, action] = match;
    await deps.requireMember(project);
    let attempt: {
        key: string;
        timeoutMs: number;
    } | null = null;
    try {
        if (!id && request.method === 'GET')
            return { status: 200, body: await deps.repository.list(project, profile) };
        if (!id && request.method === 'POST') {
            const body = await request.readBody();
            if (Object.keys(body).some(k => !['idempotencyKey', 'timeoutMs'].includes(k)) || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.trim().length < 1 || body.idempotencyKey.length > 128 || !Number.isInteger(body.timeoutMs) || Number(body.timeoutMs) < 100 || Number(body.timeoutMs) > 300000)
                throw new DynamicContractError(400, 'Select a 100–300000 ms unit timeout and bounded request key.');
            const key = body.idempotencyKey.trim(), old = await deps.repository.byKey(project, key);
            if (old) {
                if (old.createdBy !== deps.ownerId || old.environmentId !== profile || old.timeoutMs !== body.timeoutMs)
                    throw new DynamicContractError(409, 'Unit request identity conflicts with its recorded Run.');
                return { status: 200, body: old };
            }
            attempt = { key, timeoutMs: Number(body.timeoutMs) };
            try {
                await deps.prepare?.(project, profile);
            }
            catch (e) {
                if (e instanceof DynamicContractError && e.status === 409)
                    throw new UnitPrerequisiteError('configuration_error', e.message);
                throw e;
            }
            const resolved = resolveVitestWorkspace({ registry: deps.registry, ownerId: deps.ownerId, projectId: project, environmentId: profile });
            const { authorization, inspection, script, version, cliSha256, nodeVersion } = resolved;
            const started = await deps.repository.start(project, profile, key, { program: 'node', script, fingerprint: inspection.fingerprint, authorizationId: workspaceAuthorizationId(authorization), gitCommit: inspection.gitCommit, frameworkVersion: version, cliSha256, nodeVersion }, Number(body.timeoutMs));
            if (!started.reused)
                void deps.execute(started.run).catch(() => { });
            return { status: started.reused ? 200 : 201, body: started.run };
        }
        if (id) {
            await deps.repository.recover(project);
            const run = await deps.repository.get(project, id);
            if (run.environmentId !== profile)
                throw new DynamicContractError(404, 'Unit Run not found in this environment.');
            if (action === 'cancel' && request.method === 'POST') {
                const stopped = await deps.repository.cancel(project, id);
                deps.cancel(id);
                return { status: 200, body: stopped };
            }
            if (!action && request.method === 'GET')
                return { status: 200, body: run };
        }
        return { status: 405, body: { error: 'Unsupported unit operation.' } };
    }
    catch (error) {
        if (error instanceof UnitPrerequisiteError && attempt)
            return { status: 201, body: await deps.repository.preflight(project, profile, attempt.key, attempt.timeoutMs, error.outcome, error.message) };
        if (error instanceof DynamicContractError)
            return { status: error.status, body: { error: error.message } };
        throw error;
    }
}
