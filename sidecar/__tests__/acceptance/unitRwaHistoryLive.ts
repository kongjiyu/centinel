import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT, target = process.env.CENTINEL_UNIT_TARGET, runtime = process.env.CENTINEL_UNIT_RUNTIME_BIN;
assert(project && target && runtime);
const marker = JSON.parse(fs.readFileSync(path.join(target, 'CENTINEL_BASELINE.json'), 'utf8'));
assert(marker.unitOnly && marker.isolatedData);
const files = ['cypress-realworld-app', 'rwa-dynamic-release-20261014'].map(n => path.join(path.dirname(target), n, 'data/database.json')), hash = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), before = files.map(hash), database = path.join(target, 'data/database.json'), initial = fs.existsSync(database) ? fs.readFileSync(database) : null;
const client = requireSupabaseClient(), reader = requireSupabaseClient(), a = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! }), b = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(a.data.session && b.data.session);
const base = 'http://localhost:37711/projects/' + project + '/dynamic';
async function req(suffix: string, body?: unknown, token = a.data.session!.access_token) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json(); assert(r.ok, JSON.stringify(d)); return d; }
const env = await req('/environments', { name: 'M6 RWA unit ' + Date.now(), targetUrl: 'http://127.0.0.1:3014/signin', allowedOrigins: ['http://127.0.0.1:3014'], dataResourceKey: 'rwa-unit-release-20261015', viewport: { width: 1280, height: 720 }, accountRole: 'Unit-only synthetic data', requiredVariables: [], startupInstructions: 'Pinned independent RWA unit archive; no browser execution.', targetVersion: marker.commit });
const prefix = '/environments/' + env.id, inspection = (await req(prefix + '/workspace', { operation: 'inspect', directory: target })).inspection;
await req(prefix + '/workspace', { operation: 'authorize', directory: target, packageManager: 'yarn', runtimeBinDirectory: runtime, scripts: { unit: 'test:unit:ci' }, allowScripts: true, expectedFingerprint: inspection.fingerprint });
await req(prefix + '/preparation', { outcome: 'completed', note: 'Unit-only RWA archive baseline captured; primary and browser data are independent.' });
let run: any;
try {
    run = await req(prefix + '/unit-runs', { idempotencyKey: crypto.randomUUID(), timeoutMs: 180000 });
    const until = Date.now() + 180000;
    while (Date.now() < until && ['queued', 'running'].includes(run.state)) {
        await new Promise(r => setTimeout(r, 300));
        run = await req(prefix + '/unit-runs/' + run.id);
    }
    assert.equal(run.result.outcome, 'passed');
    assert.deepEqual(run.result.assessment.counts, { total: 54, passed: 44, failed: 0, pending: 10, todo: 0, totalSuites: 20, failedSuites: 0 });
    const shared = await req(prefix + '/unit-runs', undefined, b.data.session!.access_token);
    assert.deepEqual(shared.find((r: any) => r.id === run.id).result.assessment.counts, run.result.assessment.counts);
    if (initial)
        fs.writeFileSync(database, initial);
    else if (fs.existsSync(database))
        fs.unlinkSync(database);
    await req(prefix + '/cleanup', { outcome: 'completed', note: 'Unit archive data restored from its captured baseline; protected RWA copies unchanged.' });
    const snapshot = await req('/unit-runs/' + run.id + '/reports', { reportId: crypto.randomUUID() });
    assert.equal(snapshot.cleanupEvents.length, 1);
    fs.mkdirSync('output/pdf', { recursive: true });
    const exports: any = {};
    for (const format of ['json', 'markdown', 'pdf']) {
        const response = await fetch(base + '/unit-reports/' + snapshot.metadata.reportId + '/' + format, { headers: { Authorization: 'Bearer ' + b.data.session!.access_token } });
        assert(response.ok);
        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(response.headers.get('X-Centinel-SHA256'), digest);
        fs.writeFileSync('output/pdf/unit-rwa.' + (format === 'markdown' ? 'md' : format), bytes);
        exports[format] = { bytes: bytes.length, sha256: digest };
    }
    const audit = { environmentId: env.id, name: env.name, runId: run.id, reportId: snapshot.metadata.reportId, framework: run.result.framework, counts: run.result.assessment.counts, primaryAndBrowserUnchanged: JSON.stringify(files.map(hash)) === JSON.stringify(before), unitDataRestored: true, readerVerified: true, exports };
    assert(audit.primaryAndBrowserUnchanged);
    fs.writeFileSync('output/playwright/unit-rwa-shared.json', JSON.stringify(audit, null, 2));
    console.log(JSON.stringify(audit));
}
finally {
    if (run && ['queued', 'running'].includes(run.state)) {
        await req(prefix + '/unit-runs/' + run.id + '/cancel', {});
        for (let i = 0; i < 240; i++) {
            run = await req(prefix + '/unit-runs/' + run.id);
            if (!['queued', 'running'].includes(run.state))
                break;
            await new Promise(r => setTimeout(r, 250));
        }
    }
    if (initial)
        fs.writeFileSync(database, initial);
    else if (fs.existsSync(database))
        fs.unlinkSync(database);
    assert.deepEqual(files.map(hash), before);
    if ((await req(prefix + '/data')).state === 'cleanup_required')
        await req(prefix + '/cleanup', { outcome: 'completed', note: 'Acceptance ended; independent unit data restored and protected baselines checked.' });
}
