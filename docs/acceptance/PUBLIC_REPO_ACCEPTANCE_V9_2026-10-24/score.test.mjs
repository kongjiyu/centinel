import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scoreBatchDomainRun} from './score.mjs';
import {scoreUniformRun,scorePolicyRun} from '../PUBLIC_REPO_ACCEPTANCE_V7_2026-10-23/score.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json',import.meta.url),'utf8')).cases;
const adjudication={claims:[],goldMatches:[],readinessAssertions:[]};

test('v9 requires its own policy and preserves failed-execution and complete-gold gates',()=>{
 const run=fs.mkdtempSync(path.join(os.tmpdir(),'centinel-policy-evaluation-'));
 try {
  let sequence=0;
  const save=(instanceId,kind,data)=>fs.writeFileSync(path.join(run,`${String(++sequence).padStart(4,'0')}-${kind}.json`),JSON.stringify({instanceId,kind,data}));
  for(const item of cases){
   save(item.instanceId,'review-session',{status:'failed',modelStatus:'partial',configJson:JSON.stringify({modelPolicyVersion:'review-2026-10-24-batch-domain-coverage-v9'})});
   save(item.instanceId,'readiness-result',{status:'completed',stale:false,snapshot:{policyVersion:'readiness-2026-10-23.3'}});
  }
  const next=scoreBatchDomainRun(run,adjudication);
  assert.equal(next.policyCoverage.every(item=>item.valid),true);
  assert.equal(next.acceptance,'NOT_ACCEPTED');
  assert.equal(next.readinessPartialAgreement.missing,35);
  assert.equal(scoreUniformRun(run,adjudication).policyCoverage.every(item=>!item.valid),true);
 } finally {
  const absolute=path.resolve(run);
  assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));
  assert.ok(path.basename(absolute).startsWith('centinel-policy-evaluation-'));
  fs.rmSync(absolute,{recursive:true});
 }
});

test('unregistered policy cannot be used to certify a live run',()=>{
 assert.throws(()=>scorePolicyRun('unused',adjudication,'accept-any-policy'),/Unregistered/);
});
