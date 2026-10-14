/** One predeclared representative RWA sample. Credentials travel via env only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const root = '/Users/kongjy/Documents/School/FYP/centinel-test-targets/rwa-dynamic-release-20261014';
const primary = '/Users/kongjy/Documents/School/FYP/centinel-test-targets/cypress-realworld-app/data/database.json';
const unit = '/Users/kongjy/Documents/School/FYP/centinel-test-targets/rwa-unit-release-20261015/data/database.json';
const protocol = JSON.parse(fs.readFileSync('output/playwright/rwa-corpus-protocol.json','utf8'));
const [variant, number] = process.argv.slice(2);
assert(['normal','defect'].includes(variant)); assert(['1','2','3'].includes(number));
const file = `output/playwright/rwa-corpus-${variant}-${number}.json`;
assert(!fs.existsSync(file), 'Declared sample already recorded; do not replace it');
const hash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const database = fs.readFileSync(root + '/data/database.json');
assert.equal(hash(database), protocol.databaseSha256);
assert.equal(hash(fs.readFileSync(primary)), protocol.primarySha256);
assert.equal(hash(fs.readFileSync(unit)), protocol.unitSha256);
const source = fs.readFileSync(root + '/backend/database.ts','utf8');
const sourceBackup = 'output/playwright/rwa-corpus-original-database.ts';
if (variant === 'normal') {
  assert.equal(hash(Buffer.from(source)), protocol.databaseSourceSha256);
  if (!fs.existsSync(sourceBackup)) fs.writeFileSync(sourceBackup,source);
} else {
  const original = fs.readFileSync(sourceBackup,'utf8');
  assert.equal(hash(Buffer.from(original)), protocol.databaseSourceSha256);
  const old = 'db.get(USER_TABLE).find(user).assign(edits).write();';
  assert(original.includes(old));
  assert.equal(source, original.replace(old,'db.get(USER_TABLE).find(user).assign({ ...edits, firstName: user.firstName }).write();'));
}
const data = JSON.parse(database.toString());
const require = createRequire(root + '/package.json');
// Upstream public synthetic seed credential; verify it against this exact frozen account.
const seedPassword = 's3cret';
assert(require('bcryptjs').compareSync(seedPassword,data.users[0].password));
const first = 'output/playwright/rwa-corpus-normal-1.json';
const revisionId = variant === 'normal' && number === '1' ? '' : JSON.parse(fs.readFileSync(first,'utf8')).result.revisionId;
if (revisionId) assert.equal(typeof revisionId,'string');
const child = spawn(process.execPath,['--env-file=.env','sidecar/node_modules/tsx/dist/cli.mjs','sidecar/__tests__/acceptance/rwaCrudLive.ts','update',variant],{stdio:'inherit',env:{...process.env,
  CENTINEL_RWA_EVALUATION_ROOT:root,CENTINEL_RWA_PRIMARY_DATABASE:primary,CENTINEL_RWA_QA_PROJECT:'6a1f51f5-96da-43f5-b693-462e57e23cd3',
  CENTINEL_RWA_USERNAME:data.users[0].username,CENTINEL_RWA_PASSWORD:seedPassword,CENTINEL_RWA_FIXED_LABEL:protocol.expectedFirstName,
  CENTINEL_RWA_RESTORE_PROFILE:'true',CENTINEL_RWA_REUSE_REVISION:revisionId,CENTINEL_RWA_AUDIT_FILE:path.resolve(file),
  CENTINEL_RWA_TARGET_VERSION:protocol.targetCommit+'+source-'+hash(Buffer.from(source)).slice(0,16),CENTINEL_RWA_CASE_NAME:'RWA frozen profile repeat'}});
const code = await new Promise<number>(done=>{child.on('error',()=>done(1));child.on('exit',status=>done(status??1));});
assert.equal(code,0,'Sample failed; retain audit and inspect before any next step');
assert.equal(hash(fs.readFileSync(root+'/data/database.json')),protocol.databaseSha256);
assert.equal(hash(fs.readFileSync(primary)),protocol.primarySha256);
assert.equal(hash(fs.readFileSync(unit)),protocol.unitSha256);
console.log(JSON.stringify({sample:variant+'-'+number,baselineRestored:true,protectedDataUnchanged:true}));
