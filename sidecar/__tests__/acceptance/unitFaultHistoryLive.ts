import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
const audit = JSON.parse(fs.readFileSync('output/playwright/unit-shared-case/audit.json', 'utf8')), client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(auth.data.session);
const base = 'http://localhost:37711/projects/' + audit.project + '/dynamic', prefix = '/environments/' + audit.environmentId;
async function req(suffix: string, body?: unknown) { const r = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + auth.data.session!.access_token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json(); assert(r.ok, JSON.stringify(d)); return d; }
async function wait(id: string) { for (let n = 0; n < 240; n++) {
    const r = await req(prefix + '/unit-runs/' + id);
    if (!['queued', 'running'].includes(r.state))
        return r;
    await new Promise(r => setTimeout(r, 250));
} throw Error('Unit wait bound'); }
const target = path.resolve('output/playwright/unit-shared-case/target'), config = path.join(target, 'vitest.config.ts'), test = path.join(target, 'fixture.case.ts'), original = fs.readFileSync(config), symlink = path.join(target, 'node_modules'), link = fs.readlinkSync(symlink);
let active: string | null = null;
try {
    for (const mode of ['missing_dependencies', 'no_tests', 'parser_error']) {
        const val = 'case_' + mode + '_20261015';
        await req(prefix + '/values', { values: { CENTINEL_UNIT_CASE: val } });
        await req(prefix + '/preparation', { outcome: 'completed', note: 'Independent fault fixture initialized; no shared application data.' });
        if (mode === 'missing_dependencies')
            fs.unlinkSync(symlink);
        if (mode === 'no_tests')
            fs.renameSync(test, test + '.disabled');
        if (mode === 'parser_error')
            fs.writeFileSync(config, original.toString() + `\nimport fs from 'node:fs';process.on('exit',()=>{const arg=process.argv.find(x=>x.startsWith('--outputFile='));if(arg&&process.env.CENTINEL_UNIT_CASE==='${val}')fs.writeFileSync(arg.slice('--outputFile='.length),'{invalid');});\n`);
        let run = await req(prefix + '/unit-runs', { idempotencyKey: crypto.randomUUID(), timeoutMs: 10000 });
        active = run.id;
        if (['queued', 'running'].includes(run.state))
            run = await wait(run.id);
        assert.equal(run.result.outcome, mode, JSON.stringify(run.result));
        assert.equal(run.verdict, 'not_tested');
        const report = await req('/unit-runs/' + run.id + '/reports', { reportId: crypto.randomUUID() });
        assert.equal(report.run.result.outcome, mode);
        if (mode === 'missing_dependencies') {
            assert.equal((await req(prefix + '/data')).state, 'ready');
            fs.symlinkSync(link, symlink, 'dir');
        }
        if (mode === 'no_tests')
            fs.renameSync(test + '.disabled', test);
        if (mode === 'parser_error')
            fs.writeFileSync(config, original);
        await req(prefix + '/cleanup', { outcome: 'completed', note: 'Fault injection reverted, local fixture verified and prepared reservation released.' });
        audit.runs.push({ id: run.id, state: run.state, outcome: mode, reportId: report.metadata.reportId, counts: run.result.assessment?.counts ?? null });
        active = null;
    }
    fs.writeFileSync('output/playwright/unit-shared-case/audit.json', JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({ additional: audit.runs.slice(-3) }));
}
finally {
    if (!fs.existsSync(symlink))
        fs.symlinkSync(link, symlink, 'dir');
    if (fs.existsSync(test + '.disabled'))
        fs.renameSync(test + '.disabled', test);
    fs.writeFileSync(config, original);
    if (active) {
        const r = await req(prefix + '/unit-runs/' + active);
        if (['queued', 'running'].includes(r.state)) {
            await req(prefix + '/unit-runs/' + active + '/cancel', {});
            await wait(active);
        }
        const data = await req(prefix + '/data');
        if (data.state === 'cleanup_required' || data.state === 'ready')
            await req(prefix + '/cleanup', { outcome: 'completed', note: 'Acceptance interrupted; owned synthetic fault files restored and baseline checked.' });
    }
}
