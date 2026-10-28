import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreMitigation} from '../PUBLIC_REPO_MITIGATION_2026-10-23/score.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const gold=JSON.parse(fs.readFileSync(path.join(directory,'../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json'),'utf8'));

export function readinessAgreement(assertions, cases=gold.cases) {
  const expected=new Set(cases.flatMap(item=>item.readiness.scoredAssertions.map(id=>`${item.instanceId}:${id}`)));
  const seen=new Set();
  let correct=0, unknown=0;
  for(const assertion of assertions ?? []) {
    const key=`${assertion.instanceId}:${assertion.id}`;
    if(!expected.has(key) || seen.has(key)) throw Error('Unknown or duplicate frozen Readiness assertion');
    if(!['true','false','unknown'].includes(assertion.verdict) || typeof assertion.reason!=='string' || !assertion.reason.trim()) throw Error('Readiness assertion needs a verdict and evidence rationale');
    seen.add(key);
    if(assertion.verdict==='true') correct++;
    if(assertion.verdict==='unknown') unknown++;
  }
  return {numerator:correct,denominator:expected.size,value:expected.size?correct/expected.size:null,
    missing:expected.size-seen.size,unknown,complete:seen.size===expected.size && unknown===0};
}

export function validateGoldMatches(matches, claims, cases=gold.cases) {
  for(const match of matches ?? []) {
    if(!match.matched || match.origin!=='model') continue;
    const item=cases.find(item=>item.review.goldIssueId===match.issueId);
    if(!item) throw Error('Gold match references an unregistered issue');
    const count=item.review.goldOccurrenceCount;
    const canonical=count===1?['occurrence-1']
      : count===item.review.affectedFiles.length?[...item.review.affectedFiles]:null;
    if(!canonical) throw Error('Frozen occurrence grouping requires explicit evaluation mapping');
    if(!Array.isArray(match.occurrenceIds) || !match.occurrenceIds.length
      || new Set(match.occurrenceIds).size!==match.occurrenceIds.length
      || match.occurrenceIds.some(id=>!canonical.includes(id))) throw Error('Gold match needs canonical frozen occurrence IDs');
    if(typeof match.claimKey!=='string' || !(claims ?? []).some(claim=>claim.claimKey===match.claimKey
      && claim.findingId===match.findingId && claim.origin==='model' && claim.verdict==='true')) {
      throw Error('Gold match needs its exact independently supported model claim');
    }
  }
}

export function scoreUniformRun(runDirectory, adjudication) {
  return scorePolicyRun(runDirectory, adjudication, 'review-2026-10-23-selected-module-coverage-v7');
}

export function scorePolicyRun(runDirectory, adjudication, policyVersion) {
  if (!['review-2026-10-23-selected-module-coverage-v7', 'review-2026-10-23-numbered-source-coverage-v8', 'review-2026-10-24-batch-domain-coverage-v9'].includes(policyVersion)) throw Error('Unregistered evaluation policy');
  const readinessPolicyVersion=policyVersion==='review-2026-10-23-selected-module-coverage-v7'
    ? 'readiness-2026-10-23.2' : 'readiness-2026-10-23.3';
  validateGoldMatches(adjudication.goldMatches,adjudication.claims);
  const agreement=readinessAgreement(adjudication.readinessAssertions);
  const result=scoreMitigation(runDirectory,{...adjudication,
    readinessAssertionAgreement:agreement.complete && agreement.value===1 ? 1 : 0});
  const policyCoverage=result.cases.map(item=>({instanceId:item.instanceId,
    reviewPolicy:item.modelExecution.capturedPolicy,
    valid:item.modelExecution.capturedPolicy===policyVersion}));
  const events=fs.readdirSync(runDirectory).filter(file=>/^\d{4}-.+\.json$/.test(file)).sort()
    .map(file=>JSON.parse(fs.readFileSync(path.join(runDirectory,file),'utf8')));
  for(const item of policyCoverage) {
    const ready=events.filter(event=>event.instanceId===item.instanceId && event.kind==='readiness-result').at(-1)?.data;
    item.readinessPolicy=ready?.snapshot?.policyVersion ?? null;
    item.valid &&= item.readinessPolicy===readinessPolicyVersion;
  }
  // Gold hits also require an independently supported prediction, never only a match label.
  const unsupportedMatches=(adjudication.goldMatches ?? []).filter(match=>match.matched && match.origin==='model'
    && !(adjudication.claims ?? []).some(claim=>claim.findingId===match.findingId && claim.origin==='model' && claim.verdict==='true'));
  return {...result,readinessPartialAgreement:agreement,policyCoverage,
    unsupportedGoldMatchCount:unsupportedMatches.length,
    acceptance:result.acceptance==='ACCEPTED' && policyCoverage.every(item=>item.valid)
      && unsupportedMatches.length===0 ? 'ACCEPTED' : 'NOT_ACCEPTED'};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2] || !process.argv[3]) throw Error('Provide actual run directory and independent adjudication file');
  console.log(JSON.stringify(scoreUniformRun(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8'))),null,2));
}
