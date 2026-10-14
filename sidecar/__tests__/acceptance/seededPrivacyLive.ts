/** Synthetic private reference through real Codex/browser, never a real credential. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT;
assert(project);
const client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const fixture = 'http://127.0.0.1:3018';
assert.equal((await fetch(fixture + '/meta').then(r => r.json())).fixture, 'centinel-private-v1');
const base = 'http://localhost:37711/projects/' + project + '/dynamic', headers = { Authorization: 'Bearer ' + auth.data.session.access_token, 'Content-Type': 'application/json' };
async function req(suffix: string, body?: unknown) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json(); assert(r.ok, JSON.stringify(d)); return d; }
const secret = 'centinel-private-sentinel-' + crypto.randomUUID(), name = 'RELEASE_PRIVATE_VALUE';
const env = await req('/environments', { name: 'M7 seeded privacy ' + Date.now(), targetUrl: fixture + '/', allowedOrigins: [fixture], viewport: { width: 1280, height: 720 }, accountRole: 'Public synthetic private-reference fixture', requiredVariables: [name], startupInstructions: 'Browser-local reference only; no submission, account or production data.', targetVersion: 'centinel-private-v1', actionPolicy: { schemaVersion: 1, allowCoordinates: false, interactions: [], privateInputs: [{ selector: '#name', variable: name, origin: fixture }] }, budgets: { runtimeMs: 180000, maxSteps: 8, maxModelCalls: 8 } });
await req('/environments/' + env.id + '/values', { values: { [name]: secret } });
await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Public empty required field checked; synthetic local reference configured without persistence on target.' });
let run: any;
const audit: any = { environmentId: env.id, fixture: 'centinel-private-v1', secretValuePublished: false };
try {
    const rev = await req('/missions', { name: env.name, goal: 'Use type_secret with the approved RELEASE_PRIVATE_VALUE reference to fill the Private reference field. Never use ordinary text typing or submit anything. Finish only after the required field is valid and Ready is visible.', targetUrl: fixture + '/', maxSteps: 8, context: null, checks: [{ id: 'valid', criterionId: 'manual-valid', description: 'Required private field valid', kind: 'field_valid', selector: '#name', expected: true, required: true }, { id: 'ready', criterionId: 'manual-ready', description: 'Ready heading remains visible', kind: 'visible_text', expected: 'Ready', required: true }] });
    run = await req('/runs', { revisionId: rev.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
    audit.runId = run.id;
    fs.writeFileSync('output/playwright/seeded-privacy-pending.json', JSON.stringify(audit, null, 2));
    const until = Date.now() + 210000;
    while (['queued', 'running'].includes(run.state) && Date.now() < until) {
        await new Promise(r => setTimeout(r, 500));
        run = await req('/runs/' + run.id);
    }
    assert.equal(run.state, 'completed');
    assert.equal(run.verdict, 'uncertain');
    assert.equal(run.checks.find((c: any) => c.checkId === 'valid')?.verdict, 'uncertain');
    assert.equal(run.checks.find((c: any) => c.checkId === 'ready')?.verdict, 'passed');
    const workspace = await getProject(project);
    assert(workspace);
    const session = path.join(workspace.workspacePath, 'sessions', run.legacySessionId);
    let textFiles = 0, privateDispatch = false;
    for (const folder of ['ai', 'logs']) {
        const dir = path.join(session, folder);
        for (const file of fs.readdirSync(dir)) {
            if (!/\.(json|md|txt)$/.test(file))
                continue;
            const value = fs.readFileSync(path.join(dir, file), 'utf8');
            assert(!value.includes(secret), 'Synthetic sentinel leaked in retained text');
            if (value.includes('private_input') && value.includes(name))
                privateDispatch = true;
            textFiles++;
        }
    }
    assert(privateDispatch, 'No retained private-input dispatch proof');
    assert(!JSON.stringify(run).includes(secret));
    const copies = await req('/runs/' + run.id + '/evidence/sync', {});
    for (const copy of copies) {
        if (copy.mimeType !== 'application/json')
            continue;
        const response = await fetch(base + '/runs/' + run.id + '/evidence/' + copy.id + '/content', { headers });
        assert(response.ok);
        assert(!(await response.text()).includes(secret));
    }
    const report = await req('/runs/' + run.id + '/reports', { reportId: crypto.randomUUID() });
    assert(!JSON.stringify(report).includes(secret));
    for (const format of ['json', 'markdown']) {
        const response = await fetch(base + '/reports/' + report.metadata.reportId + '/' + format, { headers });
        assert(response.ok);
        assert(!(await response.text()).includes(secret));
    }
    audit.state = run.state;
    audit.verdict = run.verdict;
    audit.textFilesInspected = textFiles;
    audit.privateInputDispatchRetained = true;
    audit.sharedJsonAndReportsClean = true;
    audit.reportId = report.metadata.reportId;
    audit.screenshotCopyId = copies.find((c: any) => c.kind === 'screenshot')?.id;
}
finally {
    if (run && ['queued', 'running'].includes(run.state)) {
        await req('/runs/' + run.id + '/cancel', {});
        for (let i = 0; i < 100; i++) {
            run = await req('/runs/' + run.id);
            if (!['queued', 'running'].includes(run.state))
                break;
            await new Promise(r => setTimeout(r, 100));
        }
    }
    await req('/environments/' + env.id + '/values', { values: { [name]: '' } });
    const data = await req('/environments/' + env.id + '/data');
    if (['ready', 'cleanup_required'].includes(data.state))
        await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: 'Owned browser stopped; browser-local synthetic input discarded and local variable removed.' });
    audit.syntheticValueRemoved = true;
    fs.writeFileSync('output/playwright/seeded-privacy-live.json', JSON.stringify(audit, null, 2));
}
console.log(JSON.stringify(audit));
