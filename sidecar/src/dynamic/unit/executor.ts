import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import type { EnvironmentVault } from '../environment/vault.js';
import { dynamicWorkerId, DYNAMIC_HEARTBEAT_MS } from '../recovery.js';
import { runVitestWorkspace } from './runner.js';
import type { DynamicUnitRun } from './types.js';
import type { UnitRepository } from './repository.js';
const controllers = new Map<string, AbortController>();
export const cancelUnit = (id: string) => controllers.get(id)?.abort();
export function unitReceiptPath(root: string, project: string, id: string) { return path.join(root, crypto.createHash('sha256').update(JSON.stringify([project, id])).digest('hex') + '.json'); }
export async function executeUnit(input: {
    ownerId: string;
    run: DynamicUnitRun;
    repository: UnitRepository;
    registry: WorkspaceRegistry;
    vault: EnvironmentVault;
    receiptRoot: string;
}) {
    const { run, repository } = input, token = crypto.randomUUID(), controller = new AbortController();
    controllers.set(run.id, controller);
    let timer: ReturnType<typeof setInterval> | undefined, pending = false;
    try {
        const variables = input.vault.read(input.ownerId, run.projectId, run.environmentId);
        if (!await repository.claim(run.projectId, run.id, dynamicWorkerId, token))
            return;
        timer = setInterval(() => { if (pending)
            return; pending = true; void repository.heartbeat(run.projectId, run.id, dynamicWorkerId, token).then(alive => { if (!alive)
            controller.abort(); }).catch(() => controller.abort()).finally(() => { pending = false; }); }, DYNAMIC_HEARTBEAT_MS);
        timer.unref();
        fs.mkdirSync(input.receiptRoot, { recursive: true, mode: 0o700 });
        const file = unitReceiptPath(input.receiptRoot, run.projectId, run.id);
        const write = (value: unknown) => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); };
        const result = await runVitestWorkspace({ registry: input.registry, ownerId: input.ownerId, projectId: run.projectId, environmentId: run.environmentId, receiptRoot: path.join(input.receiptRoot, 'temporary'), timeoutMs: run.timeoutMs, variables, signal: controller.signal, expectedAuthorizationId: run.command.authorizationId ?? undefined, expectedFrameworkVersion: run.command.frameworkVersion ?? undefined, expectedCliSha256: run.command.cliSha256 ?? undefined, expectedNodeVersion: run.command.nodeVersion ?? undefined, onOutput: output => write({ schemaVersion: 1, unitRunId: run.id, projectId: run.projectId, partial: true, output }) });
        write({ schemaVersion: 1, unitRunId: run.id, projectId: run.projectId, partial: false, result, sha256: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex') });
        await repository.finish(run.projectId, run.id, token, result);
    }
    finally {
        if (timer)
            clearInterval(timer);
        controllers.delete(run.id);
    }
}
