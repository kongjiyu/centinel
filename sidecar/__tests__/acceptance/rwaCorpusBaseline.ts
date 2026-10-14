/** Independent scripted RWA baseline: no Centinel planner/checker imports. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const variant = process.argv[2]; assert(['normal','defect'].includes(variant));
const output = 'output/playwright/rwa-corpus-scripted-'+variant+'.json'; assert(!fs.existsSync(output));
const root = '/Users/kongjy/Documents/School/FYP/centinel-test-targets/rwa-dynamic-release-20261014';
const protocol = JSON.parse(fs.readFileSync('output/playwright/rwa-corpus-protocol.json','utf8'));
const databaseFile = root+'/data/database.json', before=fs.readFileSync(databaseFile), data=JSON.parse(before.toString()), user=data.users[0];
const hash=(x:Uint8Array)=>crypto.createHash('sha256').update(x).digest('hex');
assert.equal(hash(before),protocol.databaseSha256);
assert(createRequire(root+'/package.json')('bcryptjs').compareSync('s3cret',user.password));
const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
let elapsedMs:number|undefined, observed:string|undefined;
try {
  await page.goto('http://localhost:3014/signin');await page.locator('#username').fill(user.username);await page.locator('#password').fill('s3cret');await page.locator('[data-test="signin-submit"]').click();await page.waitForURL('http://localhost:3014/');
  await page.goto('http://localhost:3014/user/settings');await page.locator('#user-settings-firstName-input').waitFor();
  const start=Date.now();await page.locator('#user-settings-firstName-input').fill(protocol.expectedFirstName);
  const patched=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/users/'+user.id);
  await page.locator('[data-test="user-settings-submit"]').click();assert.equal((await patched).status(),204);
  await page.goto('http://localhost:3014/bankaccounts');await page.goto('http://localhost:3014/user/settings');await page.locator('#user-settings-firstName-input').waitFor();
  await page.waitForFunction(()=>!!(document.querySelector('#user-settings-firstName-input') as HTMLInputElement|null)?.value);
  observed=await page.locator('#user-settings-firstName-input').inputValue();elapsedMs=Date.now()-start;
  assert.equal(observed,variant==='normal'?protocol.expectedFirstName:user.firstName);
  await page.screenshot({path:'output/playwright/rwa-corpus-scripted-'+variant+'.png'});
} finally {
  const current=JSON.parse(fs.readFileSync(databaseFile,'utf8'));
  if(current.users.find((r:any)=>r.id===user.id).firstName!==user.firstName){
    assert.equal(variant,'normal','Unexpected mutation under declared no-op source');
    assert.equal((await context.request.patch('http://localhost:3015/users/'+user.id,{data:{firstName:user.firstName}})).status(),204);
  }
  await browser.close();
}
assert.equal(hash(fs.readFileSync(databaseFile)),hash(before));
fs.writeFileSync(output,JSON.stringify({variant,elapsedMs,modelCalls:0,businessSaveClicks:1,persistenceMatched:variant==='normal',databaseRestored:true,independentOfCentinel:true},null,2));
console.log(JSON.stringify({variant,elapsedMs,modelCalls:0,databaseRestored:true}));
