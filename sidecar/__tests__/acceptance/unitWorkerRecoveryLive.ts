/** Deliberate SIGKILL of the explicitly owned sidecar only; no unrelated process. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { requireSupabaseClient } from '../../src/supabase.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT, runtime = process.env.CENTINEL_UNIT_RUNTIME_BIN;
assert(project && runtime);
const pid = Number(process.env.CENTINEL_ACCEPTANCE_SIDECAR_PID);
assert(Number.isInteger(pid) && pid > 1);
const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command=']).toString();
assert(command.includes('sidecar/src/index.ts'));
const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).toString();
assert(cwd.includes('n' + process.cwd() + '\n'));
const listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP:37711', '-sTCP:LISTEN', '-Fp']).toString();
assert(listeners.includes('p' + pid + '\n'));
const client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const base = 'http://localhost:37711/projects/' + project + '/dynamic';
async function req(suffix: string, body?: unknown) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); assert(r.ok, JSON.stringify(data)); return data; }
const target = path.resolve('output/playwright/unit-shared-case/target'), marker = path.resolve('output/playwright/unit-worker-entered.marker');
assert(fs.existsSync(path.join(target, 'fixture.case.ts')));
const env = await req('/environments', { name: 'M7 unit worker recovery ' + Date.now(), targetUrl: 'http://127.0.0.1:3017/normal', allowedOrigins: ['http://127.0.0.1:3017'], viewport: { width: 1280, height: 720 }, accountRole: 'Independent synthetic interrupted unit', requiredVariables: ['CENTINEL_UNIT_CASE', 'CENTINEL_UNIT_MARKER'], startupInstructions: 'Owned synthetic unit fixture; no application database mutation.', targetVersion: 'unit-recovery-fixture-v1' }), prefix = '/environments/' + env.id;
await req(prefix + '/values', { values: { CENTINEL_UNIT_CASE: 'case_wait_20261015', CENTINEL_UNIT_MARKER: marker } });
const inspection = (await req(prefix + '/workspace', { operation: 'inspect', directory: target })).inspection;
await req(prefix + '/workspace', { operation: 'authorize', directory: target, packageManager: 'pnpm', runtimeBinDirectory: runtime, scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspection.fingerprint });
await req(prefix + '/preparation', { outcome: 'completed', note: 'Independent unit fixture initialized; marker location owned by acceptance.' });
let run = await req(prefix + '/unit-runs', { idempotencyKey: crypto.randomUUID(), timeoutMs: 120000 });
const deadline = Date.now() + 15000;
while (!fs.existsSync(marker) && Date.now() < deadline)
    await new Promise(r => setTimeout(r, 50));
assert(fs.existsSync(marker), 'Test body never entered; do not kill an unrelated or idle service');
run = await req(prefix + '/unit-runs/' + run.id);
assert.equal(run.state, 'running');
const leaseFile = path.join('/tmp', 'centinel-workspace-processes-v1-' + process.getuid!(), crypto.createHash('sha256').update(fs.realpathSync(target)).digest('hex') + '.json');
assert(fs.existsSync(leaseFile));
const audit: any = { runId: run.id, environmentId: env.id, workerPid: pid, leaseExpiresAt: run.lease.expiresAt, frameworkBodyEntered: true, workspaceLeaseBeforeKill: true, startedAt: new Date().toISOString() };
fs.writeFileSync('output/playwright/unit-worker-recovery-pending.json', JSON.stringify(audit, null, 2));
process.kill(pid, 'SIGKILL');
console.log(JSON.stringify({ stage: 'owned-worker-killed', runId: run.id, workerPid: pid, leaseExpiresAt: run.lease.expiresAt }));
const guardianUntil = Date.now() + 10000;
while (fs.existsSync(leaseFile) && Date.now() < guardianUntil)
    await new Promise(r => setTimeout(r, 50));
assert(!fs.existsSync(leaseFile), 'Orphan guardian did not release stopped process group lease');
audit.workspaceLeaseReleasedAfterKill = true;
const until = Date.parse(run.lease.expiresAt) + 20000;
let seenPending = false;
while (Date.now() < until) {
    try {
        run = await req(prefix + '/unit-runs/' + run.id);
        if (run.state === 'interrupted')
            break;
        if (run.state === 'running')
            seenPending = true;
        assert.notEqual(run.verdict, 'passed');
    }
    catch (error) {
        if (!(error instanceof TypeError))
            throw error;
    }
    await new Promise(r => setTimeout(r, 2000));
}
assert.equal(run.state, 'interrupted');
assert.equal(run.verdict, 'not_tested');
assert.equal(run.result, null);
const data = await req(prefix + '/data');
assert.equal(data.state, 'cleanup_required');
assert(data.resource.reserved);
audit.pendingWithinLease = seenPending;
audit.recoveredState = run.state;
audit.verdict = run.verdict;
audit.dirtyReservationRetained = true;
if (fs.existsSync(marker))
    fs.unlinkSync(marker);
await req(prefix + '/cleanup', { outcome: 'completed', note: 'Killed worker and framework group stopped; owned marker removed and independent unit fixture baseline verified.' });
const report = await req('/unit-runs/' + run.id + '/reports', { reportId: crypto.randomUUID() });
assert.equal(report.run.state, 'interrupted');
assert.equal(report.cleanupEvents.length, 1);
audit.reportId = report.metadata.reportId;
audit.finishedAt = new Date().toISOString();
fs.writeFileSync('output/playwright/unit-worker-recovery.json', JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
