/** Revoke only the dedicated Reader's QA-project membership, restore its exact
 * captured row in finally. Same bearer stays valid; direct Storage is also tested. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { requireSupabaseClient } from '../../src/supabase.js';
const corpus = JSON.parse(fs.readFileSync('output/playwright/release-corpus.json', 'utf8')), project = corpus.projectId;
assert.equal(project, '6a1f51f5-96da-43f5-b693-462e57e23cd3');
const client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(auth.data.session);
assert.equal(auth.data.user!.id, 'c213df04-49da-41d4-ab0b-dd818fe55260');
const token = auth.data.session.access_token, headers = { Authorization: 'Bearer ' + token }, base = 'http://localhost:37711/projects/' + project + '/dynamic', reportUrl = base + '/reports/' + corpus.reportId;
assert.equal((await fetch(reportUrl, { headers })).status, 200);
const copies = await fetch(base + '/runs/' + corpus.samples[0].runId + '/evidence', { headers }).then(r => r.json()), copy = copies.find((c: any) => c.availability === 'available');
assert(copy);
const proofUrl = base + '/runs/' + copy.runId + '/evidence/' + copy.id + '/content';
const root = path.resolve('output/playwright/access-revocation');
fs.mkdirSync(root, { recursive: true });
const sql = (name: string, text: string) => { const file = path.join(root, name + '.sql'); fs.writeFileSync(file, text, { mode: 0o600 }); const output = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', '/tmp/centinel-supabase-link', '--output', 'json', '--file', file], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).toString(); return JSON.parse(output).rows; };
const rows = sql('read', `select (select to_jsonb(m) from public.project_members m where project_id='${project}' and user_id='${auth.data.user!.id}') as membership,(select object_path from public.dynamic_evidence_copies where id='${copy.id}' and project_id='${project}') as object_path;`);
const membership = rows.find((r: any) => r.membership)?.membership, objectPath = rows.find((r: any) => r.object_path)?.object_path;
assert(membership && objectPath);
const rawClient = requireSupabaseClient(token);
const download = () => rawClient.storage.from('dynamic-evidence').download(objectPath, { cacheNonce: crypto.randomUUID() });
const initial = await download();
assert(!initial.error && initial.data);
assert.equal(crypto.createHash('sha256').update(Buffer.from(await initial.data.arrayBuffer())).digest('hex'), copy.sha256);
const jsonLiteral = JSON.stringify(membership).replaceAll("'", "''");
let removed = false;
const audit: any = { projectId: project, reportId: corpus.reportId, copyId: copy.id, sameBearer: true, startedAt: new Date().toISOString() };
try {
    removed = true;
    const result = sql('remove', `with removed as(delete from public.project_members m where project_id='${project}' and user_id='${auth.data.user!.id}' and to_jsonb(m)='${jsonLiteral}'::jsonb returning user_id)select count(*)::integer as removed from removed;`);
    assert.equal(result[0].removed, 1);
    removed = true;
    const valid = await client.auth.getUser(token);
    assert(valid.data.user && !valid.error);
    const report = await fetch(reportUrl, { headers }), proof = await fetch(proofUrl, { headers });
    assert.equal(report.status, 403);
    assert.equal(proof.status, 403);
    const stored = await download();
    assert(stored.error && !stored.data);
    const metadata = await rawClient.from('dynamic_report_snapshots').select('id').eq('id', corpus.reportId);
    assert(!metadata.error && metadata.data?.length === 0);
    audit.revokedReportStatus = report.status;
    audit.revokedProofStatus = proof.status;
    audit.directStorageDenied = true;
    audit.metadataHidden = true;
    audit.bearerStillAuthenticated = true;
}
finally {
    if (removed)
        sql('restore', `insert into public.project_members select (jsonb_populate_record(null::public.project_members,'${jsonLiteral}'::jsonb)).* on conflict do nothing;`);
    const restored = sql('verify', `select to_jsonb(m) as membership from public.project_members m where project_id='${project}' and user_id='${auth.data.user!.id}';`);
    assert.deepEqual(restored[0]?.membership, membership);
    assert.equal((await fetch(reportUrl, { headers })).status, 200);
    assert.equal((await fetch(proofUrl, { headers })).status, 200);
    const restoredProof = await download();
    assert(!restoredProof.error && restoredProof.data);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await restoredProof.data.arrayBuffer())).digest('hex'), copy.sha256);
    audit.membershipRestoredExactly = true;
    audit.restoredAccessVerified = true;
    audit.finishedAt = new Date().toISOString();
    fs.writeFileSync('output/playwright/access-revocation-live.json', JSON.stringify(audit, null, 2));
}
console.log(JSON.stringify(audit));
