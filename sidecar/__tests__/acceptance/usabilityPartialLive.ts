/** Cancel a real optional Codex advisory request; preserve/share diagnostic only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
const projectId = process.env.CENTINEL_RWA_QA_PROJECT;
assert(projectId);
const project = await getProject(projectId);
assert(project);
const client = requireSupabaseClient();
const auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const reader = requireSupabaseClient();
const other = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(other.data.session);
const base = (process.env.CENTINEL_RWA_SIDECAR_URL ?? 'http://localhost:37711') + '/projects/' + projectId + '/dynamic';
const headers = { Authorization: 'Bearer ' + auth.data.session.access_token, Origin: 'http://127.0.0.1:1420', 'Content-Type': 'application/json' };
async function req(suffix: string, body?: unknown) { const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data; }
const fixture = process.env.CENTINEL_USABILITY_TARGET_URL ?? 'http://127.0.0.1:3017';
assert.equal((await fetch(fixture + '/meta').then(r => r.json())).fixture, 'centinel-usability-v1');
const title = 'M5 stopped usability ' + Date.now();
const env = await req('/environments', { name: title, targetUrl: fixture + '/defect', allowedOrigins: [fixture], viewport: { width: 1280, height: 720 }, accountRole: 'Public synthetic visitor', requiredVariables: [], startupInstructions: 'Owned in-memory fixture.', targetVersion: 'usability-partial-v1', budgets: { runtimeMs: 180000, maxSteps: 8, maxModelCalls: 15 } });
await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Public synthetic read-only fixture; no production or RWA mutations.' });
const revision = await req('/missions', { name: title, goal: 'Observe Ready. Do not type or click. Finish once Ready is visible.', targetUrl: fixture + '/defect', maxSteps: 8, context: null, contextAcknowledged: false, checks: [{ id: 'ready', criterionId: 'manual-ready', description: 'Ready', kind: 'visible_text', expected: 'Ready', required: true }], usability: { schemaVersion: 1, includeSuggestions: true, persona: 'first_time', rules: ['labels', 'keyboard', 'focus'], feedbackCheckIds: [], errorRecoveryCheckIds: [] } });
let run: any;
try {
    run = await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
    let file: string | undefined;
    let pending: any;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
        run = await req('/runs/' + run.id);
        if (run.legacySessionId) {
            file = path.join(project.workspacePath, 'sessions', run.legacySessionId, 'logs', 'usability-progress.json');
            if (fs.existsSync(file)) {
                const progress = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (progress.phase === 'advisory_pending') {
                    pending = progress;
                    break;
                }
            }
        }
        if (!['queued', 'running'].includes(run.state))
            throw Error('Advisory finished before the controlled cancellation; retain this Run and retry explicitly');
        await new Promise(r => setTimeout(r, 100));
    }
    assert(pending && file);
    await req('/runs/' + run.id + '/cancel', {});
    const settle = Date.now() + 30000;
    while (Date.now() < settle && JSON.parse(fs.readFileSync(file!, 'utf8')).phase !== 'stopped')
        await new Promise(r => setTimeout(r, 100));
    const progress = JSON.parse(fs.readFileSync(file!, 'utf8'));
    assert.equal(progress.phase, 'stopped');
    assert(progress.observations.length > 0);
    run = await req('/runs/' + run.id);
    assert.equal(run.state, 'cancelled');
    assert.equal(run.verdict, 'not_tested');
    assert.equal(run.usability, undefined);
    const original = JSON.stringify(run);
    const published = await req('/runs/' + run.id + '/evidence/artifacts', {});
    const copy = published.copies.find((item: any) => item.kind === 'partial_usability');
    assert(copy?.availability === 'available');
    const content = await fetch(base + '/runs/' + run.id + '/evidence/' + copy.id + '/content', { headers: { ...headers, Authorization: 'Bearer ' + other.data.session!.access_token } });
    assert(content.ok);
    const bytes = Buffer.from(await content.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), copy.sha256);
    const diagnostic = JSON.parse(bytes.toString());
    assert.equal(diagnostic.criterionProof, false);
    assert.equal(diagnostic.terminalVerification, false);
    assert.equal(diagnostic.runState, 'cancelled');
    assert.equal(diagnostic.content.phase, 'stopped');
    assert.equal(diagnostic.content.keyboardActions, progress.keyboardActions);
    assert(diagnostic.limitations.some((text: string) => text.includes('never published')));
    assert.deepEqual(await req('/runs/' + run.id + '/evidence/artifacts', {}), published);
    assert.equal(JSON.stringify(await req('/runs/' + run.id)), original);
    const denied = await fetch(base + '/runs/' + run.id + '/findings', { method: 'POST', headers, body: '{}' });
    assert.equal(denied.status, 409);
    fs.mkdirSync('output/playwright', { recursive: true });
    fs.writeFileSync('output/playwright/usability-partial-live.json', JSON.stringify({ runId: run.id, revisionId: revision.id, environmentId: env.id, name: title, state: run.state, verdict: run.verdict, pendingPhaseObserved: true, keyboardActions: progress.keyboardActions, observationCount: progress.observations.length, sharedCopyId: copy.id, sharedSha256: copy.sha256, readerVerified: true, terminalRunUnchanged: true, findingCollectionRejected: true, diagnostic }, null, 2));
    console.log(JSON.stringify({ runId: run.id, state: run.state, verdict: run.verdict, pendingPhaseObserved: true, readerVerified: true, findingCollectionStatus: denied.status, keyboardActions: progress.keyboardActions }));
}
finally {
    if (run && ['queued', 'running'].includes(run.state))
        await req('/runs/' + run.id + '/cancel', {});
    await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: 'Controlled optional advisory cancellation; no target persistence was modified.' });
}
