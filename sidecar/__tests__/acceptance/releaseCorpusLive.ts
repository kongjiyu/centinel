/** Frozen M7 protocol: six independent real Codex Runs, no replacement samples. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
import { calculateRunCoverage } from '../../src/dynamic/coverage.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT;
assert(project);
assert(fs.readFileSync('docs/DYNAMIC_RELEASE_PROTOCOL.md', 'utf8').includes('N=3 each'));
const client = requireSupabaseClient(), reader = requireSupabaseClient(), a = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! }), b = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(a.data.session && b.data.session);
const base = 'http://localhost:37711/projects/' + project + '/dynamic', fixture = 'http://127.0.0.1:3017';
assert.equal((await fetch(fixture + '/meta').then(r => r.json())).fixture, 'centinel-usability-v1');
const hash = (x: Buffer) => crypto.createHash('sha256').update(x).digest('hex');
const file = 'output/playwright/release-corpus.json';
const audit: any = { protocol: 'DYNAMIC_RELEASE_PROTOCOL.md', engineCommit: '44916ff991439a6f824a1347798e3578c9ce88e6', fixtureSourceSha256: hash(fs.readFileSync('sidecar/src/dynamic/testing/usabilityTarget.ts')), projectId: project, backend: 'codex', model: 'gpt-5.6-sol', samples: [], startedAt: new Date().toISOString() };
fs.mkdirSync('output/playwright', { recursive: true });
const save = () => fs.writeFileSync(file, JSON.stringify(audit, null, 2));
save();
async function req(suffix: string, body?: unknown, token = a.data.session!.access_token) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json(); assert(r.ok, JSON.stringify(d)); return d; }
async function stopWait(id: string) { const until = Date.now() + 210000; while (Date.now() < until) {
    const run = await req('/runs/' + id);
    if (!['queued', 'running'].includes(run.state))
        return run;
    await new Promise(r => setTimeout(r, 300));
} throw Error('Release sample wait bound exceeded'); }
const context = { schemaVersion: 1, provenance: 'mock-static', projectId: project, reviewId: 'mock-release-review-v1', snapshotId: 'mock-release-ready-v1', approvalState: 'approved', sources: [{ id: 'mock-release-source', version: 'release-fixture-v1', currency: 'current', uri: 'mock://centinel-release/ready-v1' }], target: { repository: 'https://github.com/kongjiyu/centinel', commit: audit.engineCommit, deploymentVersion: null }, requirements: [{ id: 'MOCK-RELEASE-READY', revision: 1, description: 'The public fixture exposes the Ready heading.', sourceId: 'mock-release-source', criteria: [{ id: 'MOCK-RELEASE-READY-C1', description: 'Ready is visible on the selected public page.' }] }], risks: [], conflicts: [], limitations: ['Synthetic incoming requirements; no Static analysis or approval occurred.', 'Usability rules are assessed separately from the Ready acceptance criterion.'] };
for (const variant of ['normal', 'defect']) {
    const title = 'M7 corpus ' + variant + ' ' + Date.now(), url = fixture + '/' + variant;
    const env = await req('/environments', { name: title, targetUrl: url, allowedOrigins: [fixture], viewport: { width: 1280, height: 720 }, accountRole: 'Public fixed release fixture', requiredVariables: [], startupInstructions: 'Public read-only fixture; no target data mutation.', targetVersion: 'centinel-usability-v1', dataResourceKey: 'release-public-' + variant, budgets: { runtimeMs: 180000, maxSteps: 8, maxModelCalls: 15 } });
    const revision = await req('/missions', { name: title, goal: 'Observe the Ready heading. Do not click or type. Finish when Ready is visible.', targetUrl: url, maxSteps: 8, context, contextAcknowledged: false, checks: [{ id: 'release-ready', criterionId: 'MOCK-RELEASE-READY-C1', description: 'Ready heading visible', kind: 'visible_text', expected: 'Ready', required: true }], usability: { schemaVersion: 1, includeSuggestions: false, persona: 'first_time', rules: ['labels', 'keyboard', 'focus'], feedbackCheckIds: [], errorRecoveryCheckIds: [] } });
    for (let repetition = 1; repetition <= 3; repetition++) {
        const sample: any = { variant, repetition, revisionId: revision.id, environmentId: env.id, attemptedAt: new Date().toISOString(), status: 'attempting' };
        audit.samples.push(sample);
        save();
        let run: any;
        try {
            await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Fixed public read-only fixture source and page identity checked; no persistence mutation.' });
            run = await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
            sample.runId = run.id;
            save();
            run = await stopWait(run.id);
            sample.state = run.state;
            sample.verdict = run.verdict;
            sample.elapsedMs = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
            sample.ruleFailures = run.usability?.observations.filter((o: any) => o.verdict === 'failed').map((o: any) => o.ruleId) ?? null;
            sample.keyboardActions = run.usability?.keyboardActions ?? null;
            const coverage = calculateRunCoverage(run);
            sample.coverage = coverage;
            const workspace = await getProject(project);
            assert(workspace);
            if (run.legacySessionId) {
                const budgetFile = path.join(workspace.workspacePath, 'sessions', run.legacySessionId, 'logs', 'execution-budget.json');
                if (fs.existsSync(budgetFile))
                    sample.budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
            }
            save();
            assert.equal(run.state, 'completed');
            assert.equal(run.verdict, 'passed');
            assert(coverage.availability === 'available' && coverage.counts.passed === 1 && coverage.totalCriteria === 1);
            assert.equal(run.revision.id, revision.id);
            assert.deepEqual(run.revision.context, context);
            const failures = run.usability.observations.filter((o: any) => o.verdict === 'failed');
            assert.equal(failures.length, variant === 'defect' ? 2 : 0);
            if (variant === 'defect')
                assert.deepEqual(failures.map((o: any) => o.ruleId).sort(), ['keyboard', 'labels']);
            const copies = await req('/runs/' + run.id + '/evidence/sync', {});
            let verified = 0;
            for (const proof of run.evidence) {
                const copy = copies.find((c: any) => c.evidenceId === proof.id);
                assert(copy && copy.availability === 'available');
                const response = await fetch(base + '/runs/' + run.id + '/evidence/' + copy.id + '/content', { headers: { Authorization: 'Bearer ' + b.data.session!.access_token } });
                assert(response.ok);
                assert.equal(hash(Buffer.from(await response.arrayBuffer())), proof.sha256);
                verified++;
            }
            sample.proofs = { recorded: run.evidence.length, readerVerified: verified };
            const candidates = await req('/runs/' + run.id + '/findings', {});
            assert.equal(candidates.length, variant === 'defect' ? 2 : 0);
            sample.findingIds = candidates.map((f: any) => f.id);
            for (const f of candidates) {
                await req('/findings/' + f.id + '/review', { version: f.version, decision: 'confirmed', note: 'QA release-corpus simulation: independently inspected the declared public fixture source and matching rule proof. This is a planted fixture observation, not stakeholder or production approval.', severity: 'low', priority: 'low', confidence: 'high' }, b.data.session!.access_token);
            }
            const usage = await client.from('model_usage_records').select('stage,provider,model,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens').eq('project_id', project).eq('owner_id', a.data.user!.id).contains('metadata', { runId: run.id });
            assert(!usage.error);
            sample.modelUsage = usage.data;
            assert(usage.data?.every(row => row.provider === 'codex' && row.model === 'gpt-5.6-sol'));
            sample.status = 'verified';
        }
        catch (error) {
            sample.status = 'failed';
            sample.error = error instanceof Error ? error.message : 'Release sample error';
            throw error;
        }
        finally {
            if (run) {
                const current = await req('/runs/' + run.id);
                if (['queued', 'running'].includes(current.state)) {
                    await req('/runs/' + run.id + '/cancel', {});
                    await stopWait(run.id);
                }
            }
            const data = await req('/environments/' + env.id + '/data');
            if (['ready', 'cleanup_required'].includes(data.state))
                await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: 'Public read-only sample stopped; no target persistence changes, baseline remains fixed.' });
            save();
        }
        console.log(JSON.stringify({ variant, repetition, runId: sample.runId, status: sample.status, verdict: sample.verdict, ruleFailures: sample.ruleFailures, proofs: sample.proofs, modelCalls: sample.budget?.modelCalls }));
    }
}
const selected = audit.samples.at(-1), report = await req('/runs/' + selected.runId + '/reports', { reportId: crypto.randomUUID() });
assert.equal(report.findings.length, 2);
assert(report.findings.every((f: any) => f.finding.verification === 'confirmed' && f.observations.length === 3));
audit.reportId = report.metadata.reportId;
audit.finishedAt = new Date().toISOString();
audit.complete = true;
save();
console.log(JSON.stringify({ samples: audit.samples.length, reportId: audit.reportId, complete: true }));
