/** Real Codex + bearer Supabase acceptance; intentionally outside offline suites. */
import { getProject } from '../../src/projects.js';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
const client = requireSupabaseClient();
const auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const reader = requireSupabaseClient();
const other = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(other.data.session);
const project = process.env.CENTINEL_RWA_QA_PROJECT;
assert(project, 'Set CENTINEL_RWA_QA_PROJECT');
const base = (process.env.CENTINEL_RWA_SIDECAR_URL ?? 'http://localhost:37711') + '/projects/' + project + '/dynamic';
const headers = { Authorization: 'Bearer ' + auth.data.session.access_token, Origin: 'http://127.0.0.1:1420', 'Content-Type': 'application/json' };
async function req(suffix: string, body?: unknown) { const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data; }
const fixture = process.env.CENTINEL_USABILITY_TARGET_URL ?? 'http://127.0.0.1:3017';
const meta = await fetch(fixture + '/meta').then(res => res.json());
assert.equal(meta.fixture, 'centinel-usability-v1');
assert(meta.publicSyntheticData);
const primary = process.env.CENTINEL_RWA_PRIMARY_DATABASE;
assert(primary, 'Set CENTINEL_RWA_PRIMARY_DATABASE');
const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isolatedRoot=process.env.CENTINEL_RWA_EVALUATION_ROOT;assert(isolatedRoot,'Set CENTINEL_RWA_EVALUATION_ROOT');const marker=JSON.parse(fs.readFileSync(path.join(isolatedRoot,'CENTINEL_BASELINE.json'),'utf8'));assert.equal(marker.isolatedData,true);assert.equal(marker.sourceCommit,'9dfcb9869533ce8a8963c556facc0d80457f9d39');
const initial = hash(primary);
const includeSuggestions=process.env.CENTINEL_USABILITY_SUGGESTIONS==='true';
const maxModelCalls=Number(process.env.CENTINEL_USABILITY_MAX_MODEL_CALLS??15);
const auditPath=includeSuggestions?(maxModelCalls===1?'output/playwright/usability-suggestions-budget-live.json':'output/playwright/usability-suggestions-live.json'):'output/playwright/usability-live.json';
const variants = (process.env.CENTINEL_USABILITY_VARIANTS ?? 'normal,defect,recovery,rwa').split(',');
assert(variants.every(variant => ['normal', 'defect', 'recovery', 'rwa'].includes(variant)));
const audits: any[] = [];
for (const variant of variants) {
    const rwa = variant === 'rwa', recovery = variant === 'recovery';
    const target = rwa ? 'http://localhost:3014/signin' : fixture + '/' + variant;
    const title = 'M5 usability '+(includeSuggestions?'suggestions ':'') + variant + ' ' + Date.now();
    const env = await req('/environments', { name: title, targetUrl: target, allowedOrigins: rwa ? ['http://localhost:3014', 'http://localhost:3015'] : [fixture], viewport: { width: 1280, height: 720 }, accountRole: 'Public synthetic visitor', requiredVariables: [], startupInstructions: 'Owned isolated/public fixture; no production data writes.', targetVersion: rwa ? '9dfcb9869533ce8a8963c556facc0d80457f9d39' : 'centinel-usability-v1', budgets: { runtimeMs: 180000, maxSteps: 8, maxModelCalls }, actionPolicy: { schemaVersion: 1, allowCoordinates: false, interactions: recovery ? [{ selector: '#trigger', actions: ['click'] }, { selector: '#retry', actions: ['click'] }] : [] } });
    await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Public fixture identity verified; primary database checksum retained. Read-only controls or two explicitly approved synthetic recovery navigations only.' });
    const expected = rwa ? 'Sign in' : recovery ? 'Recovered' : 'Ready';
    const revision = await req('/missions', { name: title, goal: recovery ? 'Click Trigger error, observe Something failed, then click Retry. Finish only when Recovered is visible. Do not perform any other task.' : 'Observe the ' + expected + ' heading. Leave forms and controls unchanged; do not type or click. Finish when this heading is visible.', targetUrl: target, maxSteps: 8, context: null, contextAcknowledged: false, checks: [{ id: 'ready', criterionId: 'manual-ready', description: recovery ? 'Explicit recovered feedback' : 'Ready heading', kind: 'visible_text', expected, required: true }], usability: { schemaVersion: 1,...(includeSuggestions?{includeSuggestions:true}:{}), persona: recovery ? 'returning' : 'first_time', rules: recovery ? ['labels', 'feedback', 'error_recovery'] : ['labels', 'keyboard', 'focus'], feedbackCheckIds: recovery ? ['ready'] : [], errorRecoveryCheckIds: recovery ? ['ready'] : [] } });
    let run: any;
    try {
        run = await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
        const deadline = Date.now() + 210000;
        while (['queued', 'running'].includes(run.state) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            run = await req('/runs/' + run.id);
        }
        assert.equal(run.state, 'completed');
        assert.equal(run.verdict, 'passed');
        assert(run.usability);
        assert.deepEqual(run.usability.config, revision.usability);
        assert.equal(run.executionVersions.usability, includeSuggestions?2:1);if(includeSuggestions){assert(run.usability.suggestions);assert.equal(run.usability.suggestions.kind,'subjective');if(maxModelCalls===1){assert.equal(run.usability.suggestions.status,'unavailable');assert.equal(run.usability.suggestions.reason,'budget_limit');}else{assert.equal(run.usability.suggestions.status,'completed');}};
        if (variant === 'normal')
            assert(run.usability.observations.every((row: any) => row.verdict === 'passed'));
        if (variant === 'defect') {
            assert(run.usability.observations.some((row: any) => row.ruleId === 'labels' && row.verdict === 'failed'));
            assert(run.usability.observations.some((row: any) => row.ruleId === 'keyboard' && row.verdict === 'failed'));
        }
        if (recovery) {
            assert(run.usability.observations.filter((row: any) => ['feedback', 'error_recovery'].includes(row.ruleId)).every((row: any) => row.verdict === 'passed' && row.checkId === 'ready'));
        }
        const original = JSON.stringify(run);
        const copies = await req('/runs/' + run.id + '/evidence/sync', {});
        const proof = copies.find((copy: any) => copy.kind === 'usability');
        assert(proof && proof.availability === 'available');
        const content = await fetch(base + '/runs/' + run.id + '/evidence/' + proof.id + '/content', { headers: { ...headers, Authorization: 'Bearer ' + other.data.session!.access_token } });
        assert(content.ok);
        const bytes = Buffer.from(await content.arrayBuffer());
        assert.equal(hashBytes(bytes), proof.sha256);
        assert.deepEqual(JSON.parse(bytes.toString()), run.usability);
        assert.equal(JSON.stringify(await req('/runs/' + run.id)), original);
        assert.equal(hash(primary), initial);
        const workspace = await getProject(project);
        assert(workspace);
        const budget = JSON.parse(fs.readFileSync(path.join(workspace.workspacePath, 'sessions', run.legacySessionId, 'logs', 'execution-budget.json'), 'utf8'));
        assert(budget.steps <= run.executionBudget.maxSteps);
        const audit = {suggestions:run.usability.suggestions??null,steps: budget.steps, modelCalls: budget.modelCalls, variant, runId: run.id, revisionId: revision.id, environmentId: env.id, verdict: run.verdict, ruleFailures: run.usability.observations.filter((row: any) => row.verdict === 'failed').length, keyboardActions: run.usability.keyboardActions, proofId: proof.id, proofSha256: proof.sha256, readerVerified: true, originalRunPreserved: true, primaryUnchanged: true };
        audits.push(audit);
        console.log(JSON.stringify({variant,runId:run.id,verdict:run.verdict,steps:budget.steps,modelCalls:budget.modelCalls,suggestionStatus:run.usability.suggestions?.status,suggestionReason:run.usability.suggestions?.reason,suggestionCount:run.usability.suggestions?.items.length,readerVerified:true,primaryUnchanged:true}));
    }
    finally {
        if (run && ['queued', 'running'].includes(run.state))
            await req('/runs/' + run.id + '/cancel', {});
        await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: 'Public synthetic/read-only acceptance finished; browser stopped, no target persistence changes or primary data writes.' });
        fs.mkdirSync('output/playwright', { recursive: true });
        fs.writeFileSync(auditPath, JSON.stringify({ audits, primarySha256: initial }, null, 2));
    }
}
function hashBytes(bytes: Buffer) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
