import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { requireSupabaseClient } from '../../src/supabase.js';
const project = process.env.CENTINEL_RWA_QA_PROJECT;
assert(project);
const client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const audits: any[] = [];
for (const variant of ['provider_outage', 'unreachable_target']) {
    const origin = variant === 'provider_outage' ? 'http://localhost:37712' : 'http://localhost:37711', base = origin + '/projects/' + project + '/dynamic';
    async function req(suffix: string, body?: unknown) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); assert(r.ok, JSON.stringify(data)); return data; }
    const target = variant === 'provider_outage' ? 'http://127.0.0.1:3017/normal' : 'http://127.0.0.1:39999/';
    if (variant === 'unreachable_target') {
        let unreachable = false;
        try {
            await fetch(target, { signal: AbortSignal.timeout(1000) });
        }
        catch {
            unreachable = true;
        }
        assert(unreachable, 'Unreachable fixture port unexpectedly serves an app');
    }
    const old = process.env.CENTINEL_RELEASE_BLOCKED_RESUME === 'true' && variant === 'provider_outage' ? (await req('/runs')).find((r: any) => r.revision.name.startsWith('M7 blocked provider_outage')) : null;
    const env = old ? old.environment : await req('/environments', { name: 'M7 blocked ' + variant + ' ' + Date.now(), targetUrl: target, allowedOrigins: [new URL(target).origin], viewport: { width: 1280, height: 720 }, accountRole: 'Synthetic blocked scenario', requiredVariables: [], startupInstructions: 'Read-only preflight acceptance; no application data mutation.', targetVersion: 'release-blocked-v1' });
    if (!old)
        await req('/environments/' + env.id + '/preparation', { outcome: 'completed', note: 'Public read-only target or deliberately unavailable local target. No data mutation.' });
    let run: any;
    try {
        const revision = old ? old.revision : await req('/missions', { name: env.name, goal: 'Observe Ready without typing or clicking.', targetUrl: target, maxSteps: 2, context: null, checks: [{ id: 'ready', criterionId: 'manual-ready', description: 'Ready visible', kind: 'visible_text', expected: 'Ready', required: true }] });
        run = old ?? await req('/runs', { revisionId: revision.id, environmentId: env.id, idempotencyKey: crypto.randomUUID() });
        const until = Date.now() + 20000;
        while (['queued', 'running'].includes(run.state) && Date.now() < until) {
            await new Promise(r => setTimeout(r, 200));
            run = await req('/runs/' + run.id);
        }
        assert.equal(run.state, 'blocked');
        assert.equal(run.verdict, 'not_tested');
        assert(run.checks.every((c: any) => c.verdict === 'not_tested'));
        assert.equal(run.evidence.length, 0);
        const unavailable = run.environment.preflight.filter((p: any) => !p.ready);
        assert(unavailable.length);
        if (variant === 'provider_outage')
            assert(unavailable.some((p: any) => p.name === 'Model provider'));
        else
            assert(unavailable.some((p: any) => p.name === 'Website reachable'));
        const findings = await fetch(base + '/runs/' + run.id + '/findings', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(findings.status, 409);
        audits.push({ variant, runId: run.id, environmentId: env.id, state: run.state, verdict: run.verdict, preflight: unavailable, candidateCollectionDenied: 409 });
    }
    finally {
        if (run && ['queued', 'running'].includes(run.state))
            await req('/runs/' + run.id + '/cancel', {});
        const data = await req('/environments/' + env.id + '/data');
        if (['ready', 'cleanup_required'].includes(data.state))
            await req('/environments/' + env.id + '/cleanup', { outcome: 'completed', note: 'Blocked preflight ended without browser execution or target mutation; prepared reservation released.' });
        fs.writeFileSync('output/playwright/release-blocked.json', JSON.stringify(audits, null, 2));
    }
}
console.log(JSON.stringify(audits));
