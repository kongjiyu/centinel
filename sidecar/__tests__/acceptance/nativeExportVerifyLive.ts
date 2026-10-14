/** Verify files produced through the observed packaged-client native save UI.
 * This script verifies bytes/access; it does not manufacture UI acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { requireSupabaseClient } from '../../src/supabase.js';
const reportId = 'f9880041-ba15-4b19-8e0c-2cf108c19438';
const directory = process.env.CENTINEL_NATIVE_EXPORT_DIRECTORY;
assert(directory && path.isAbsolute(directory));
const local = JSON.parse(fs.readFileSync(path.join(directory, `centinel-dynamic-${reportId}.json`), 'utf8'));
assert.equal(local.metadata.reportId, reportId);
const client = requireSupabaseClient();
const login = await client.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_ACCOUNT_EMAIL!, password: process.env.CENTINEL_DEV_ACCOUNT_PASSWORD! });
assert(login.data.session);
const base = 'http://localhost:37711/projects/' + local.metadata.projectId + '/dynamic';
const headers = { Authorization: 'Bearer ' + login.data.session.access_token };
const digest = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const exports: unknown[] = [];
for (const [format, extension] of [['json','json'], ['markdown','md'], ['pdf','pdf']]) {
  const response = await fetch(base + '/reports/' + reportId + '/' + format, { headers });
  assert.equal(response.status, 200);
  const downloaded = Buffer.from(await response.arrayBuffer());
  const saved = fs.readFileSync(path.join(directory, `centinel-dynamic-${reportId}.${extension}`));
  assert(saved.equals(downloaded), 'Native saved bytes differ from authenticated executor export');
  assert.equal(digest(saved), response.headers.get('X-Centinel-SHA256'));
  if (format === 'pdf') assert.equal(saved.subarray(0,5).toString(), '%PDF-');
  exports.push({format, bytes: saved.length, sha256: digest(saved), nativeBytesMatchAuthenticatedExport: true});
}
const response = await fetch(base + '/runs/' + local.metadata.runId, { headers });
assert.equal(response.status, 200);
const run = await response.json();
assert.equal(run.state, 'completed'); assert.equal(run.verdict, 'passed');
for (const [key, value] of Object.entries(local.run)) assert.deepEqual(run[key], value);
const copies = await fetch(base + '/runs/' + run.id + '/evidence', { headers }).then(r => r.json());
assert.equal(copies.length, 2);
for (const copy of copies) {
  assert.equal(copy.availability, 'available');
  const proof = await fetch(base + '/runs/' + run.id + '/evidence/' + copy.id + '/content', { headers });
  assert.equal(proof.status, 200);
  assert.equal(digest(Buffer.from(await proof.arrayBuffer())), copy.sha256);
}
const nonmember = requireSupabaseClient();
const otherLogin = await nonmember.auth.signInWithPassword({ email: process.env.CENTINEL_DEV_READER_EMAIL!, password: process.env.CENTINEL_DEV_READER_PASSWORD! });
assert(otherLogin.data.session);
const otherHeaders = { Authorization: 'Bearer ' + otherLogin.data.session.access_token };
assert.equal((await fetch(base + '/reports/' + reportId + '/json', { headers: otherHeaders })).status, 403);
assert.equal((await fetch(base + '/runs/' + run.id + '/evidence/' + copies[0].id + '/content', { headers: otherHeaders })).status, 403);
const audit = { nonmemberDenied: true, verifiedAt: new Date().toISOString(), projectId: local.metadata.projectId, runId: run.id, reportId, exports, executorProofsVerified: copies.length, retainedSnapshotFieldsMatchRun: true, recordedModelCalls: local.modelUsage.calls.map((call: {provider:string;model:string;outcome:string}) => ({provider:call.provider, model:call.model, outcome:call.outcome})) };
fs.writeFileSync('output/playwright/native-export-verified.json', JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
