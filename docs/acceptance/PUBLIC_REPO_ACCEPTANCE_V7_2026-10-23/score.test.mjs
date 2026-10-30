import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readinessAgreement,validateGoldMatches} from './score.mjs';
const cases=[{instanceId:'a',readiness:{scoredAssertions:['presence','evidence']}}];
const row=(id,verdict='true')=>({instanceId:'a',id,verdict,reason:'Independently inspected original source evidence.'});
test('requires every frozen assertion rather than a supplied agreement scalar',()=>{
  assert.deepEqual(readinessAgreement([row('presence')],cases),{numerator:1,denominator:2,value:.5,missing:1,unknown:0,complete:false});
  assert.equal(readinessAgreement([row('presence'),row('evidence')],cases).value,1);
});
test('unknown or false assertions cannot establish complete agreement',()=>{
  assert.equal(readinessAgreement([row('presence'),row('evidence','unknown')],cases).complete,false);
  assert.equal(readinessAgreement([row('presence'),row('evidence','false')],cases).value,.5);
});
test('rejects duplicate and non-frozen assertion IDs',()=>{
  assert.throws(()=>readinessAgreement([row('presence'),row('presence')],cases));
  assert.throws(()=>readinessAgreement([row('other')],cases));
});
test('requires explicit evidence rationale',()=>{
  assert.throws(()=>readinessAgreement([{...row('presence'),reason:''}],cases));
});
const goldCases=[{review:{goldIssueId:'one',goldOccurrenceCount:1,affectedFiles:['a.ts','helper.ts']}},
  {review:{goldIssueId:'many',goldOccurrenceCount:2,affectedFiles:['left.ts','right.ts']}}];
const claim=(findingId,claimKey=findingId,verdict='true')=>({findingId,claimKey,verdict,origin:'model'});
const hit=(findingId,issueId,occurrenceIds,claimKey=findingId)=>({findingId,issueId,occurrenceIds,claimKey,matched:true,origin:'model'});
test('duplicate findings use one canonical occurrence rather than per-finding occurrence IDs',()=>{
  const matches=[hit('first','one',['occurrence-1']),hit('second','one',['occurrence-1'])];
  validateGoldMatches(matches,[claim('first'),claim('second')],goldCases);
  assert.equal(new Set(matches.flatMap(match=>match.occurrenceIds)).size,1);
  assert.throws(()=>validateGoldMatches([hit('second','one',['second'])],[claim('second')],goldCases));
});
test('multiple occurrences must match exact registered source locations',()=>{
  validateGoldMatches([hit('first','many',['left.ts','right.ts'])],[claim('first')],goldCases);
  assert.throws(()=>validateGoldMatches([hit('first','many',['left.ts','invented.ts'])],[claim('first')],goldCases));
});
test('gold credit binds the exact supported split claim, not an unrelated true sibling',()=>{
  const claims=[claim('first','gold-mechanism','false'),claim('first','unrelated')];
  assert.throws(()=>validateGoldMatches([hit('first','one',['occurrence-1'],'gold-mechanism')],claims,goldCases));
  assert.throws(()=>validateGoldMatches([{...hit('first','one',['occurrence-1']),claimKey:undefined}],claims,goldCases));
});
