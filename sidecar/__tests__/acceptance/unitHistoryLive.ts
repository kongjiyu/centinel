/** Shared unit lifecycle/report acceptance on independent synthetic/RWA workspaces. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT;
assert(project);
const producer = requireSupabaseClient(), reader = requireSupabaseClient();
const a = await producer.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! }), b = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(a.data.session && b.data.session);
const root = path.resolve('output/playwright/unit-shared-case');
fs.mkdirSync(root, { recursive: true });
const target = path.join(root, 'target');
if (!fs.existsSync(target)) {
    fs.cpSync(path.resolve('sidecar/__tests__/fixtures/vitest-workspace'), target, { recursive: true });
    fs.symlinkSync(path.resolve('sidecar/node_modules'), path.join(target, 'node_modules'), 'dir');
}
fs.copyFileSync(path.resolve('sidecar/__tests__/fixtures/vitest-workspace/fixture.case.ts'), path.join(target, 'fixture.case.ts'));
const runtime = process.env.CENTINEL_UNIT_RUNTIME_BIN!;
assert(runtime);
const base = (process.env.CENTINEL_RWA_SIDECAR_URL ?? 'http://localhost:37711') + '/projects/' + project + '/dynamic';
async function req(suffix: string, body?: unknown, token = a.data.session!.access_token) { const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data; }
async function end(profile: string, id: string) { const until = Date.now() + 180000; while (Date.now() < until) {
    const run = await req('/environments/' + profile + '/unit-runs/' + id);
    if (!['queued', 'running'].includes(run.state))
        return run;
    await new Promise(r => setTimeout(r, 250));
} throw Error('Unit Run did not stop within acceptance bound'); }
const env = await req('/environments', { name: 'M6 shared unit ' + Date.now(), targetUrl: 'http://127.0.0.1:3017/normal', allowedOrigins: ['http://127.0.0.1:3017'], viewport: { width: 1280, height: 720 }, accountRole: 'Independent synthetic unit fixtures', requiredVariables: ['CENTINEL_UNIT_CASE'], startupInstructions: 'Dedicated local unit-only fixture; no browser or production mutations.', targetVersion: 'centinel-unit-fixture-v1' });
const prefix = '/environments/' + env.id;
const preflight = await req(prefix + '/unit-runs', { idempotencyKey: crypto.randomUUID(), timeoutMs: 3000 });
assert.equal(preflight.state, 'blocked');
assert.equal(preflight.result.outcome, 'configuration_error');
assert.equal((await req(prefix + '/data')).state, 'unprepared');
const inspection = (await req(prefix + '/workspace', { operation: 'inspect', directory: target })).inspection;
await req(prefix + '/workspace', { operation: 'authorize', directory: target, packageManager: 'pnpm', runtimeBinDirectory: runtime, scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspection.fingerprint });
const audit: any = { project, environmentId: env.id, name: env.name, preflightRunId: preflight.id, runs: [] };
try {
    for (const mode of ['normal', 'failed', 'timeout', 'cancelled']) {
        await req(prefix + '/values', { values: { CENTINEL_UNIT_CASE: mode === 'timeout' || mode === 'cancelled' ? 'case_wait_20261015' : mode === 'failed' ? 'case_broken_20261015' : 'case_pass_20261015' } });
        await req(prefix + '/preparation', { outcome: 'completed', note: 'Independent unit-only fixture initialized; no web or shared RWA data touched.' });
        const key = crypto.randomUUID(), timeout = mode === 'timeout' ? 2000 : 30000;
        const initial = await req(prefix + '/unit-runs', { idempotencyKey: key, timeoutMs: timeout });
        const repeated = await req(prefix + '/unit-runs', { idempotencyKey: key, timeoutMs: timeout });
        assert.equal(repeated.id, initial.id);
        if (mode === 'cancelled') {
            const until = Date.now() + 10000;
            while (Date.now() < until) {
                const rows = await req(prefix + '/unit-runs');
                const run = rows.find((r: any) => r.id === initial.id);
                if (run.state === 'running') {
                    await new Promise(r => setTimeout(r, 700));
                    await req(prefix + '/unit-runs/' + initial.id + '/cancel', {});
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }
        }
        const run = await end(env.id, initial.id);
        assert.equal(run.result.outcome, mode === 'normal' ? 'passed' : mode === 'failed' ? 'failed' : mode);
        assert.equal(run.verdict, ['timeout', 'cancelled'].includes(mode) ? 'not_tested' : mode === 'failed' ? 'failed' : 'passed');
        assert.equal((await req(prefix + '/data')).state, 'cleanup_required');
        const shared = await req(prefix + '/unit-runs', undefined, b.data.session!.access_token);
        assert(shared.some((r: any) => r.id === run.id));
        const id = crypto.randomUUID(), snapshot = await req('/unit-runs/' + run.id + '/reports', { reportId: id });
        assert.equal(snapshot.cleanupEvents.length, 0);
        assert.deepEqual(await req('/unit-reports/' + id, undefined, b.data.session!.access_token), snapshot);
        const response = await fetch(base + '/unit-reports/' + id + '/json', { headers: { Authorization: 'Bearer ' + b.data.session!.access_token } });
        assert(response.ok);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), response.headers.get('X-Centinel-SHA256'));
        await req(prefix + '/cleanup', { outcome: 'completed', note: 'Independent unit fixture completed or terminated; no persistent test mutation, baseline verified.' });
        const after = await req('/unit-runs/' + run.id + '/reports', { reportId: crypto.randomUUID() });
        assert.equal(after.cleanupEvents.length, 1);
        assert.deepEqual(await req('/unit-reports/' + id), snapshot);
        audit.runs.push({ id: run.id, state: run.state, outcome: run.result.outcome, counts: run.result.assessment?.counts ?? null, reportId: id, cleanupReportId: after.metadata.reportId, readerVerified: true, oldSnapshotUnchanged: true });
    }
    fs.writeFileSync(path.join(root, 'audit.json'), JSON.stringify(audit, null, 2));
    console.log(JSON.stringify(audit));
}
finally {
    const rows = await req(prefix + '/unit-runs');
    const active = rows.find((r: any) => ['queued', 'running'].includes(r.state));
    if (active) {
        await req(prefix + '/unit-runs/' + active.id + '/cancel', {});
        await end(env.id, active.id);
    }
    const state = (await req(prefix + '/data')).state;
    if (['ready', 'cleanup_required'].includes(state))
        await req(prefix + '/cleanup', { outcome: 'completed', note: 'Acceptance stopped; independent read-only fixture checked and prepared reservation released.' });
}
