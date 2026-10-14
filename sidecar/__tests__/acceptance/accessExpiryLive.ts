/** Wait for a genuinely issued signed QA JWT to expire; never forge a token or
 * shorten global project auth settings. Credentials stay in memory only. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireSupabaseClient } from '../../src/supabase.js';
const corpus = JSON.parse(fs.readFileSync('output/playwright/release-corpus.json', 'utf8')), project = corpus.projectId, client = requireSupabaseClient(), auth = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(auth.data.session);
const token = auth.data.session.access_token, refreshToken = auth.data.session.refresh_token, expiresAt = auth.data.session.expires_at!;
assert(expiresAt * 1000 > Date.now());
const base = 'http://localhost:37711/projects/' + project + '/dynamic', endpoint = base + '/reports/' + corpus.reportId;
const headers = { Authorization: 'Bearer ' + token };
const before = await fetch(endpoint, { headers });
assert.equal(before.status, 200);
const runId = corpus.samples[0].runId, copies = await fetch(base + '/runs/' + runId + '/evidence', { headers }).then(r => r.json()), copy = copies.find((c: any) => c.availability === 'available');
assert(copy);
const proofUrl = base + '/runs/' + runId + '/evidence/' + copy.id + '/content';
assert.equal((await fetch(proofUrl, { headers })).status, 200);
const pending = { issuedAt: new Date().toISOString(), expiresAt: new Date(expiresAt * 1000).toISOString(), projectId: project, runId, reportId: corpus.reportId, copyId: copy.id };
fs.writeFileSync('output/playwright/access-expiry-pending.json', JSON.stringify(pending, null, 2));
console.log(JSON.stringify({ stage: 'waiting-for-real-jwt-expiry', ...pending }));
while (Date.now() < (expiresAt + 5) * 1000)
    await new Promise(r => setTimeout(r, Math.min(30000, (expiresAt + 5) * 1000 - Date.now())));
const expiredReport = await fetch(endpoint, { headers }), expiredProof = await fetch(proofUrl, { headers });
assert.equal(expiredReport.status, 401);
assert.equal(expiredProof.status, 401);
const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken });
assert(!refreshed.error && refreshed.data.session);
assert.notEqual(refreshed.data.session.access_token, token);
const freshHeaders = { Authorization: 'Bearer ' + refreshed.data.session.access_token };
assert.equal((await fetch(endpoint, { headers: freshHeaders })).status, 200);
const response = await fetch(proofUrl, { headers: freshHeaders });
assert.equal(response.status, 200);
const hash = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
assert.equal(hash, copy.sha256);
const audit = { ...pending, finishedAt: new Date().toISOString(), expiredReportStatus: expiredReport.status, expiredProofStatus: expiredProof.status, refreshSucceeded: true, refreshedReportStatus: 200, refreshedProofSha256Verified: true, noGlobalAuthSettingChanged: true };
fs.writeFileSync('output/playwright/access-expiry-live.json', JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
