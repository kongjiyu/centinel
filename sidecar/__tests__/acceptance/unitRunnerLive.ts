/** Explicitly isolated RWA unit-only folder; preserve primary/browser data hashes. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WorkspaceRegistry, inspectWorkspace } from '../../src/dynamic/workspace/registry.js';
import { runVitestWorkspace } from '../../src/dynamic/unit/runner.js';
const target = process.env.CENTINEL_UNIT_TARGET;
assert(target && path.isAbsolute(target));
const marker = JSON.parse(fs.readFileSync(path.join(target, 'CENTINEL_BASELINE.json'), 'utf8'));
assert(marker.unitOnly && marker.isolatedData);
assert.equal(marker.commit, '9dfcb9869533ce8a8963c556facc0d80457f9d39');
const parent = path.dirname(target);
const protectedFiles = ['cypress-realworld-app', 'rwa-dynamic-release-20261014'].map(name => path.join(parent, name, 'data/database.json'));
const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = protectedFiles.map(hash);
const database = path.join(target, 'data/database.json');
const initial = fs.existsSync(database) ? fs.readFileSync(database) : null;
const root = path.resolve('output/playwright/unit-runner'), registry = new WorkspaceRegistry(path.join(root, 'registry'));
const owner = 'unit-acceptance', project = 'isolated-rwa-unit', environment = 'unit-only';
const inspection = inspectWorkspace(target);
assert.equal(inspection.scriptDefinitions['test:unit:ci'], 'vitest --run');
registry.authorize(owner, project, environment, { directory: target, packageManager: 'yarn', runtimeBinDirectory: process.env.CENTINEL_UNIT_RUNTIME_BIN, scripts: { unit: 'test:unit:ci' }, allowScripts: true, expectedFingerprint: inspection.fingerprint });
try {
    const result = await runVitestWorkspace({ registry, ownerId: owner, projectId: project, environmentId: environment, receiptRoot: path.join(root, 'receipts'), timeoutMs: 180000 });
    assert.equal(result.framework.version, '3.2.4');
    assert.equal(result.outcome, 'passed', JSON.stringify({ outcome: result.outcome, reason: result.reason, output: result.process?.output, counts: result.assessment?.counts }));
    assert(result.assessment!.counts.total > 1);
    assert.equal(result.assessment!.counts.failed, 0);
    assert.equal(result.assessment!.tests.length, result.assessment!.counts.total);
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ framework: result.framework, command: result.command, outcome: result.outcome, counts: result.assessment!.counts, durationMs: result.process!.durationMs }));
}
finally {
    if (initial)
        fs.writeFileSync(database, initial);
    else if (fs.existsSync(database))
        fs.unlinkSync(database);
    const after = protectedFiles.map(hash);
    assert.deepEqual(after, before);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'baseline.json'), JSON.stringify({ pinnedCommit: marker.commit, protectedDataHashes: after, primaryAndBrowserUnchanged: true, unitOnlyDataRestored: true }, null, 2));
    console.log(JSON.stringify({ primaryAndBrowserUnchanged: true, unitOnlyDataRestored: true }));
}
