import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
const client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const origin = 'http://localhost:37711';
async function req(endpoint: string, body?: unknown) { const r = await fetch(origin + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); assert(r.ok, JSON.stringify(data)); return data; }
let project: any, run: any, beforeLocal: boolean;
const pendingPath = 'output/playwright/new-project-release-pending.json';
if (process.env.CENTINEL_NEW_PROJECT_ACCEPTANCE_RESUME === 'true') {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    project = (await req('/projects')).find((p: any) => p.id === pending.projectId);
    assert(project);
    run = await req('/projects/' + project.id + '/dynamic/runs/' + pending.runId);
    beforeLocal = pending.localRecordBeforeRun;
}
else {
    const directory = path.resolve('output/playwright/release-new-project-target');
    fs.mkdirSync(directory, { recursive: true });
    project = await req('/projects', { name: 'Dynamic new-identity release ' + Date.now(), description: 'Explicit QA scenario 3. New shared identity, public read-only fixture; no Static Review.', workspacePath: directory, source: { type: 'local-repository' } });
    beforeLocal = Boolean(await getProject(project.id));
    const prefix = '/projects/' + project.id + '/dynamic';
    const revision = await req(prefix + '/missions', { name: 'New shared identity Ready', goal: 'Observe Ready. Do not click or type. Finish when Ready is visible.', targetUrl: 'http://127.0.0.1:3017/normal', maxSteps: 3, context: null, checks: [{ id: 'ready', criterionId: 'manual-ready', description: 'Ready on public fixture', kind: 'visible_text', expected: 'Ready', required: true }] });
    run = await req(prefix + '/runs', { revisionId: revision.id, idempotencyKey: crypto.randomUUID() });
    fs.writeFileSync(pendingPath, JSON.stringify({ projectId: project.id, runId: run.id, localRecordBeforeRun: beforeLocal }, null, 2));
}
const prefix = '/projects/' + project.id + '/dynamic';
let final = run;
const until = Date.now() + 180000;
while (['queued', 'running'].includes(final.state) && Date.now() < until) {
    await new Promise(r => setTimeout(r, 400));
    final = await req(prefix + '/runs/' + run.id);
}
assert.equal(final.projectId, project.id);
assert.equal(final.state, 'completed');
assert.equal(final.verdict, 'passed');
assert(final.checks.length === 1 && final.evidence.length >= 2);
const after = await getProject(project.id);
const reader = requireSupabaseClient(), other = await reader.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(other.data.session);
const denied = await fetch(origin + prefix + '/runs/' + run.id, { headers: { Authorization: 'Bearer ' + other.data.session.access_token } });
assert([403, 404].includes(denied.status));
const audit = { projectId: project.id, runId: run.id, revisionId: final.revision.id, localRecordBeforeRun: beforeLocal, localRecordAfterRun: Boolean(after), state: final.state, verdict: final.verdict, checks: final.checks.length, evidence: final.evidence.length, staticReviewPerformed: false, existingOtherProjectMemberDenied: denied.status };
assert.equal(beforeLocal, false);
fs.writeFileSync('output/playwright/new-project-release.json', JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
