/** Explicit real-provider acceptance, never part of the offline unit suite.
 * Requires the owned isolated target marker and an authenticated QA account. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
const required = (name: string) => { const value = process.env[name]; assert(value, `Set ${name} before real acceptance.`); return value; };
const root = required('CENTINEL_RWA_EVALUATION_ROOT');
const primary = required('CENTINEL_RWA_PRIMARY_DATABASE');
const projectId = required('CENTINEL_RWA_QA_PROJECT');
const username = required('CENTINEL_RWA_USERNAME');
const password = required('CENTINEL_RWA_PASSWORD');
const marker = JSON.parse(fs.readFileSync(path.join(root, 'CENTINEL_BASELINE.json'), 'utf8'));
assert.equal(marker.isolatedData, true);
assert.equal(marker.sourceCommit, '9dfcb9869533ce8a8963c556facc0d80457f9d39');
const origin = 'http://localhost:3014', apiOrigin = 'http://localhost:3015';
const database = path.join(root, 'data/database.json');
assert.notEqual(fs.realpathSync(database), fs.realpathSync(primary));
const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHash = hash(primary);
const db = () => JSON.parse(fs.readFileSync(database, 'utf8'));
const user = db().users.find((row: any) => row.username === username);
assert(user);
const failureMode = process.argv[2] ?? 'cancel';
assert(['cancel', 'browser_crash', 'worker_restart'].includes(failureMode));
const label = 'Centinel_' + crypto.randomUUID().slice(0, 8);
const auditDirectory = path.resolve('output/playwright');
fs.mkdirSync(auditDirectory, { recursive: true });
const client = requireSupabaseClient();
const auth = await client.auth.signInWithPassword({ email: required('CENTINEL_DEV_ACCOUNT_EMAIL'), password: required('CENTINEL_DEV_ACCOUNT_PASSWORD') });
assert(auth.data.session);
const base = (process.env.CENTINEL_RWA_SIDECAR_URL ?? 'http://localhost:37711') + '/projects/' + projectId + '/dynamic';
async function req(suffix: string, body?: unknown) { const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, Origin: 'http://127.0.0.1:1420', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result; }
const ready = await fetch(apiOrigin + '/users');
assert([200, 401].includes(ready.status), 'Start the isolated API before acceptance');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let state;
try {
    await page.goto(origin + '/signin');
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('[data-test="signin-submit"]').click();
    await page.waitForURL(origin + '/');
    state = await page.context().storageState();
}
finally {
    await browser.close();
}
const before = db();
const local = await getProject(projectId);
assert(local);
const target = origin + '/bankaccounts';
const env = await req('/environments', { name: 'M4 ' + failureMode + ' ' + label, targetUrl: target, allowedOrigins: [origin, apiOrigin, 'https://api.dicebear.com'], viewport: { width: 1280, height: 720 }, accountRole: 'Fictional isolated RWA account', requiredVariables: [], startupInstructions: 'Direct owned servers; no reset', targetVersion: marker.sourceCommit, dataResourceKey: 'rwa-release-20261014', sessionReference: 'rwaRelease', sessionReadySelector: '[data-test="sidenav-signout"]', budgets: { runtimeMs: 180000, maxSteps: 10, maxModelCalls: 18 }, actionPolicy: { schemaVersion: 1, interactions: [], allowCoordinates: false } });
await req('/environments/' + env.id + '/session', { operation: 'import', storageState: state, expiresAt: new Date(Date.now() + 3600000).toISOString() });
await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Isolated read-only cancellation evaluation; database snapshot retained.' });
const revision = await req('/missions', { name: 'M4 ' + failureMode + ' ' + label, goal: `Navigate to ${origin}/user/settings and back to ${target} four times, using navigate actions. Observe each destination. Do not click, type, submit or modify any data. Finish only after all eight navigations.`, targetUrl: target, maxSteps: 10, context: null, contextAcknowledged: false, checks: [{ id: 'page', criterionId: 'read', description: 'Final bank list URL', required: true, kind: 'url', expected: target }] });
let run = await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
let folder = '';
let traces: any[] = [];
const deadline = Date.now() + 100000;
while (Date.now() < deadline) {
    run = await req('/runs/' + run.id);
    assert(['queued', 'running'].includes(run.state), 'Run ended before controlled cancellation');
    if (run.legacySessionId) {
        folder = path.join(local.workspacePath, 'sessions', run.legacySessionId);
        const f = path.join(folder, 'logs/action-trace.json');
        if (fs.existsSync(f)) {
            traces = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (traces.some(t => t.result === 'success' && t.action === 'navigate'))
                break;
        }
    }
    await new Promise(r => setTimeout(r, 300));
}
assert(traces.some(t => t.result === 'success' && t.action === 'navigate'), 'No completed read-only navigation before deadline');
const completedBefore = traces.filter(t => t.result === 'success').length;
const stoppedAt = new Date().toISOString();
let killedBrowserPid: number | undefined;
if (failureMode === 'cancel')
    run = await req('/runs/' + run.id + '/cancel', {});
else {
    const parent = Number(required('CENTINEL_RWA_SIDECAR_PID'));
    assert(Number.isSafeInteger(parent) && parent > 1);
    const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,command=']);
    const rows = stdout.split('\n').map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
    assert(rows.some(row => Number(row![1]) === parent && row![3].includes('sidecar/src/index.ts')), 'Provided PID is not the owned sidecar');
    const children = rows.filter(row => Number(row![2]) === parent && row![3].includes('/ms-playwright/') && row![3].includes('--remote-debugging-pipe') && !row![3].includes('--type='));
    assert.equal(children.length, 1, 'Require exactly one owned Chromium child; never kill other browsers');
    killedBrowserPid = Number(children[0]![1]);
    if (failureMode === 'worker_restart') {
        process.kill(parent, 'SIGKILL');
        process.kill(killedBrowserPid, 'SIGKILL');
        console.log(JSON.stringify({ event: 'owned_sidecar_stopped', runId: run.id, parent, killedBrowserPid }));
    }
    else
        process.kill(killedBrowserPid, 'SIGKILL');
    const crashDeadline = Date.now() + (failureMode === 'worker_restart' ? 120000 : 10000);
    while (['queued', 'running'].includes(run.state) && Date.now() < crashDeadline) {
        await new Promise(r => setTimeout(r, 500));
        try {
            run = await req('/runs/' + run.id);
        }
        catch (error) {
            if (failureMode !== 'worker_restart')
                throw error;
        }
    }
}
const expectedState = failureMode === 'cancel' ? 'cancelled' : failureMode === 'worker_restart' ? 'interrupted' : 'blocked';
assert.equal(run.state, expectedState);
assert.equal(run.verdict, 'not_tested');
if (failureMode === 'browser_crash')
    assert.match(run.reason, /Browser disconnected/);
const retained = path.join(folder, 'logs/execution-budget.json');
const settled = Date.now() + 20000;
while (failureMode !== 'worker_restart' && !fs.existsSync(retained) && Date.now() < settled)
    await new Promise(r => setTimeout(r, 200));
if (failureMode !== 'worker_restart')
    assert(fs.existsSync(retained), 'Partial evidence not finalized after cancellation');
await new Promise(r => setTimeout(r, 1500));
const finalTrace: any[] = JSON.parse(fs.readFileSync(path.join(folder, 'logs/action-trace.json'), 'utf8'));
assert.equal(finalTrace.filter(t => t.result === 'success').length, completedBefore, 'Additional action completed after cancellation');
for (const name of failureMode === 'worker_restart' ? ['action-trace.json', 'step-000-before.json'] : ['network.json', 'console.json', 'execution-budget.json', 'action-trace.json'])
    assert(fs.existsSync(path.join(folder, 'logs', name)));
assert.deepEqual(db(), before);
assert.equal(hash(primary), originalHash);
run = await req('/runs/' + run.id);
assert.equal(run.state, expectedState);
assert.equal(run.verdict, 'not_tested');
const result = { failureMode, killedBrowserPid, runId: run.id, environmentId: env.id, state: run.state, verdict: run.verdict, stoppedAt, completedBefore, completedAfter: finalTrace.filter(t => t.result === 'success').length, partialEvidenceRetained: true, finalBudgetAvailable: fs.existsSync(retained), isolatedDataUnchanged: true, primaryUnchanged: true, cleanupRecorded: false };
fs.writeFileSync(path.join(auditDirectory, 'rwa-' + failureMode + '-live.json'), JSON.stringify({ result, run }, null, 2));
await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: failureMode==='worker_restart'?'Expired worker lease recovered after controlled restart. Before-observation and partial trace retained; final console/network/budget may be unavailable after abrupt loss. No replay or subsequent completed action; both databases unchanged.':'Controlled stop settled, partial trace/network/console/budget files retained, no subsequent completed action, isolated and primary databases unchanged.' });
await req('/environments/' + env.id + '/session', { operation: 'forget' });
result.cleanupRecorded = true;
fs.writeFileSync(path.join(auditDirectory, 'rwa-' + failureMode + '-live.json'), JSON.stringify({ result, run }, null, 2));
console.log(JSON.stringify(result));
