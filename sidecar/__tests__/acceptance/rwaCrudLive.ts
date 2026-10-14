/** Explicit real-provider acceptance, never part of the offline unit suite.
 * Requires the owned isolated target marker and an authenticated QA account. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, request } from 'playwright';
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
const mode = process.argv[2] ?? 'create';
const variant = process.argv[3] ?? 'normal';
assert(['create', 'delete', 'update', 'read'].includes(mode));
assert(['normal', 'defect'].includes(variant));
if (process.env.CENTINEL_RWA_RESTORE_PROFILE === 'true') assert.equal(mode, 'update');
const label = process.env.CENTINEL_RWA_FIXED_LABEL ?? ('Centinel_' + crypto.randomUUID().slice(0, 8));
assert(/^[A-Za-z0-9_]{1,64}$/.test(label));
if (mode === 'update') assert.notEqual(label, user.firstName, 'Update must change the initial value');
const auditDirectory = path.resolve('output/playwright');
fs.mkdirSync(auditDirectory, { recursive: true });
const auditFile = process.env.CENTINEL_RWA_AUDIT_FILE ? path.resolve(process.env.CENTINEL_RWA_AUDIT_FILE) : path.join(auditDirectory, `rwa-${mode}-${variant}-live.json`);
assert(auditFile.startsWith(auditDirectory + path.sep));
const initialDatabaseHash = hash(database);
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
const lastCreated = process.env.CENTINEL_RWA_BANK_ID ? before.bankaccounts.find((row: any) => row.id === process.env.CENTINEL_RWA_BANK_ID) : null;
if (mode === 'delete' || mode === 'read') {
    assert(lastCreated && lastCreated.userId === user.id && !lastCreated.isDeleted, 'Select an active bank created by this acceptance harness.');
    assert(lastCreated.bankName.startsWith('Centinel_'), 'Refuse to act on an unrelated bank account.');
}
const target = mode === 'create' ? origin + '/bankaccounts/new' : mode === 'update' ? origin + '/user/settings' : origin + '/bankaccounts';
const bankSelector = lastCreated ? `[data-test="bankaccount-list-item-${lastCreated.id}"]` : '';
const interactions = mode === 'create' ? [{ selector: '#bankaccount-bankName-input', actions: ['type'] }, { selector: '#bankaccount-routingNumber-input', actions: ['type'] }, { selector: '#bankaccount-accountNumber-input', actions: ['type'] }, { selector: '[data-test="bankaccount-submit"]', actions: ['click'] }] : mode === 'update' ? [{ selector: '#user-settings-firstName-input', actions: ['type'] }, { selector: '[data-test="user-settings-submit"]', actions: ['click'] }] : mode === 'delete' ? [{ selector: bankSelector + ' [data-test="bankaccount-delete"]', actions: ['click'] }] : [];
let env = await req('/environments', { name: process.env.CENTINEL_RWA_CASE_NAME ?? `M4 RWA ${mode} ${variant} ${label}`, targetUrl: target, allowedOrigins: [origin, apiOrigin, 'https://api.dicebear.com'], viewport: { width: 1280, height: 720 }, accountRole: 'Seeded fictional account in an owned disposable RWA instance', requiredVariables: [], startupInstructions: 'Owned evaluation copy, direct servers on 3014/3015; no seed/reset command.', targetVersion: process.env.CENTINEL_RWA_TARGET_VERSION ?? (marker.sourceCommit + (variant === 'defect' ? '+declared-' + mode + '-defect' : '')), dataResourceKey: 'rwa-release-20261014', sessionReference: 'rwaRelease', sessionReadySelector: '[data-test="sidenav-signout"]', budgets: { runtimeMs: 240000, maxSteps: 10, maxModelCalls: 18 }, actionPolicy: { schemaVersion: 1, interactions, allowCoordinates: false } });
await req('/environments/' + env.id + '/session', { operation: 'import', storageState: state, expiresAt: new Date(Date.now() + 3600000).toISOString() });
await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Isolated RWA resource reserved, account state verified, pre-action database snapshot retained. Only explicitly owned synthetic data will be modified.' });
const expectedName = mode === 'create' ? label : mode === 'update' ? label : lastCreated.bankName;
const checks = mode === 'create' ? [{ id: 'listed', criterionId: 'bank', description: 'Created bank is listed', required: true, kind: 'visible_text', expected: label }, { id: 'page', criterionId: 'bank', description: 'Bank list reached', required: true, kind: 'url', expected: origin + '/bankaccounts' }] : mode === 'delete' ? [{ id: 'deleted', criterionId: 'bank', description: 'Owned bank marked deleted', required: true, kind: 'visible_text', expected: lastCreated.bankName + ' (Deleted)' }] : mode === 'read' ? [{ id: 'read', criterionId: 'bank', description: 'Owned bank remains listed', required: true, kind: 'visible_text', expected: lastCreated.bankName }] : [{ id: 'persisted', criterionId: 'profile', description: 'Profile field persisted after independent navigation', required: true, kind: 'field_value', selector: '#user-settings-firstName-input', expected: label }];
const goal = mode === 'create' ? `Fill Bank Name with ${label}, Routing Number with 123456789, Account Number with 123456789. Click Save exactly once. Wait for the bank list and finish even if the name is unexpected; independent checks verify it. Never create another account or replay Save.` : mode === 'delete' ? `Click Delete for the one owned synthetic bank ${lastCreated.bankName} exactly once. Wait for its response, then finish even if it remains active. Never delete any other record or repeat the click.` : mode === 'update' ? `Change only First Name to ${label}, click Save exactly once, wait for its response, navigate to ${origin}/bankaccounts and back to ${origin}/user/settings to obtain persisted data, then finish even if it did not persist. Do not edit other fields or repeat Save.` : `Read the bank list and finish. Do not modify any data.`;
const revision = process.env.CENTINEL_RWA_REUSE_REVISION ? await req('/revisions/' + process.env.CENTINEL_RWA_REUSE_REVISION) : await req('/missions', { name: process.env.CENTINEL_RWA_CASE_NAME ?? `M4 RWA ${mode} ${variant} ${label}`, goal: "Use only elementRef identifiers from the current observation, never CSS selectors as elementRef. " + goal, targetUrl: target, maxSteps: 10, context: null, contextAcknowledged: false, checks });
if (mode === 'update') assert.equal(revision.checks[0].expected, expectedName);
const startedAt = Date.now();
let run = await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
fs.writeFileSync(auditFile, JSON.stringify({ pending: true, runId: run.id, environmentId: env.id, revisionId: revision.id, initialDatabaseHash }, null, 2));
const deadline = Date.now() + 270000;
while (['queued', 'running'].includes(run.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    run = await req('/runs/' + run.id);
}
const after = db();
const added = after.bankaccounts.filter((row: any) => !before.bankaccounts.some((old: any) => old.id === row.id));
const updatedUser = after.users.find((row: any) => row.id === user.id);
const result = { revisionId: revision.id, initialDatabaseHash, elapsedMs: Date.now() - startedAt, mode, variant, runId: run.id, environmentId: env.id, verdict: run.verdict, state: run.state, label, bankId: mode === 'create' ? added[0]?.id : lastCreated?.id, bankName: mode === 'create' ? added[0]?.bankName : lastCreated?.bankName, initialFirstName: user.firstName, actualFirstName: updatedUser.firstName, sourceCommit: marker.sourceCommit, originalHash, primaryUnchanged: hash(primary) === originalHash, cleanupRecorded: false, unrelatedDataPreserved: false };
fs.writeFileSync(auditFile, JSON.stringify({ result, run }, null, 2));
assert.equal(run.verdict, variant === 'defect' ? 'failed' : 'passed');
assert.equal(run.state, 'completed');
if (mode === 'create') {
    assert.equal(added.length, 1);
    assert.equal(added[0].userId, user.id);
}
if (mode === 'delete')
    assert.equal(after.bankaccounts.find((row: any) => row.id === lastCreated.id).isDeleted, variant !== 'defect');
if (mode === 'update')
    assert.equal(updatedUser.firstName, variant === 'defect' ? user.firstName : label);
assert.equal(hash(primary), originalHash);
// Compare every pre-existing table/row, permitting only the declared mutation.
const preserved = structuredClone(after);
if (mode === 'create')
    preserved.bankaccounts = preserved.bankaccounts.filter((row: any) => before.bankaccounts.some((old: any) => old.id === row.id));
if (mode === 'delete')
    preserved.bankaccounts.find((row: any) => row.id === lastCreated.id).isDeleted = lastCreated.isDeleted;
if (mode === 'update')
    preserved.users.find((row: any) => row.id === user.id).firstName = user.firstName;
assert.deepEqual(preserved, before, 'Unrelated target data changed');
result.unrelatedDataPreserved = true;
const local = await getProject(projectId);
assert(local);
const folder = path.join(local.workspacePath, 'sessions', run.legacySessionId);
const trace = JSON.parse(fs.readFileSync(path.join(folder, 'logs/action-trace.json'), 'utf8'));
assert.equal(trace.filter((entry: any) => entry.action === 'click' && entry.dispatch === 'locator').length, mode === 'read' ? 0 : 1);
for (const sub of ['ai', 'logs'])
    for (const file of fs.readdirSync(path.join(folder, sub)).filter(name => name.endsWith('.json') || name.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(folder, sub, file), 'utf8');
        assert(!text.includes(password));
        assert(!state.cookies.some(cookie => cookie.value && text.includes(cookie.value)));
    }
if (process.env.CENTINEL_RWA_RESTORE_PROFILE === 'true') {
    assert.equal(mode, 'update');
    if (variant === 'normal') {
        const context = await request.newContext({ storageState: state });
        try { assert.equal((await context.patch(apiOrigin + '/users/' + user.id, { data: { firstName: user.firstName } })).status(), 204); } finally { await context.dispose(); }
    }
    assert.deepEqual(db(), before, 'Profile baseline restore changed unrelated fields');
    assert.equal(hash(database), initialDatabaseHash, 'Profile baseline bytes not restored');
}
// Target writes remain in the disposable copy as auditable soft-delete/history.
await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: process.env.CENTINEL_RWA_RESTORE_PROFILE === 'true' ? 'Owned profile restored through authenticated target API; complete original database bytes/hash verified, no unrelated writes.' : 'Browser stopped, exact owned mutation and preserved unrelated rows verified. Persistent test changes remain in the disposable copy; no shared/primary target writes. Next case explicitly inspects this new baseline.' });
await req('/environments/' + env.id + '/session', { operation: 'forget' });
result.cleanupRecorded = true;
fs.writeFileSync(auditFile, JSON.stringify({ result, run }, null, 2));
console.log(JSON.stringify(result));
