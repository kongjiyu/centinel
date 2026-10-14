import {validateIncomingContext,validateCriterionExclusions} from './context.js';
import type {DynamicRun,CheckVerdict} from './types.js';
export type CoverageState=CheckVerdict|'blocked'|'excluded';
export type CriterionCoverage={requirementId:string;requirementRevision:number;criterionId:string;description:string;sourceId:string;sourceVersion:string;state:CoverageState;reason:string;checkIds:string[];evidenceIds:string[]};
export type RunCoverage={schemaVersion:1;availability:'available';provenance:'mock-static';snapshotId:string;reviewId:string;totalCriteria:number;inputApprovalState:'approved'|'pending';inputAcknowledged:boolean;acknowledgedBy:string|null;sourceStates:Array<{id:string;version:string;currency:'current'|'stale'|'unknown'}>;inputWarnings:string[];requirementsWithoutCriteria:string[];counts:Record<CoverageState,number>;criteria:CriterionCoverage[]}|{schemaVersion:1;availability:'absent'|'unavailable';reason:string};
/** The selected Run's frozen revision is the only denominator; no current source
 * or latest Mission can contribute an observation to historical coverage. */
export function calculateRunCoverage(run:DynamicRun):RunCoverage {
 if(!run.revision.context)return {schemaVersion:1,availability:'absent',reason:'Manual test: no incoming requirement coverage denominator was supplied.'};
 try{
  const context=validateIncomingContext(run.revision.context,run.projectId)!;
  const suppliedCriteria=new Set(context.requirements.flatMap(item=>item.criteria.map(criterion=>criterion.id)));
  if(new Set(run.revision.checks.map(check=>check.id)).size!==run.revision.checks.length||run.revision.checks.some(check=>typeof check.id!=='string'||!check.id||typeof check.required!=='boolean'||!suppliedCriteria.has(check.criterionId)))throw new Error('Invalid recorded check references');
  const inputWarnings=[...(context.approvalState==='pending'?['This snapshot has pending synthetic approval.']:[]),...context.sources.filter(source=>source.currency!=='current').map(source=>`Source ${source.id} is ${source.currency}.`),...(context.conflicts.length?['The incoming snapshot contains unresolved conflicts.']:[]),...(context.requirements.some(item=>!item.criteria.length)?['Some requirements have no supplied criteria.']:[])];
  const exclusions=validateCriterionExclusions(run.revision.criterionExclusions,context,run.revision.checks);
  const knownEvidence=new Set(run.evidence.filter(item=>item.availability==='local'&&['screenshot','checks'].includes(item.kind)&&/^[a-f0-9]{64}$/.test(item.sha256)&&run.evidence.filter(peer=>peer.id===item.id).length===1).map(item=>item.id));
  const criteria=context.requirements.flatMap(requirement=>requirement.criteria.map(criterion=>{
   const definitions=run.revision.checks.filter(check=>check.criterionId===criterion.id);
   const excluded=exclusions.find(item=>item.criterionId===criterion.id);
   const row:CriterionCoverage={requirementId:requirement.id,requirementRevision:requirement.revision,criterionId:criterion.id,description:criterion.description,sourceId:requirement.sourceId,sourceVersion:context.sources.find(source=>source.id===requirement.sourceId)!.version,state:'not_tested',reason:'No browser check selected for this criterion.',checkIds:definitions.map(check=>check.id),evidenceIds:[]};
   if(excluded){row.state='excluded';row.reason=excluded.reason;return row;}
   if(!definitions.length)return row;
   const required=definitions.filter(check=>check.required);
   if(!required.length){row.reason='Only advisory checks were selected; no required validation was configured.';return row;}
   if(['blocked','interrupted','cancelled'].includes(run.state)){row.state='blocked';row.reason=run.reason??'Execution stopped before independent verification.';return row;}
   if(run.state!=='completed'){row.reason='Independent verification has not completed.';return row;}
   const results=required.map(check=>{const matches=run.checks.filter(result=>result.checkId===check.id&&result.criterionId===criterion.id);return matches.length===1?matches[0]:null;});
   const verdicts=results.map(result=>result&&['passed','failed'].includes(result.verdict)&&result.evidenceIds.length&&result.evidenceIds.every(id=>knownEvidence.has(id))?result.verdict:'uncertain');
   row.evidenceIds=[...new Set(results.filter(result=>result&&['passed','failed'].includes(result.verdict)&&result.evidenceIds.length&&result.evidenceIds.every(id=>knownEvidence.has(id))).flatMap(result=>result!.evidenceIds))];
   row.state=verdicts.includes('failed')?'failed':verdicts.every(verdict=>verdict==='passed')?'passed':'uncertain';
   row.reason=row.state==='passed'?'All configured required checks have retained passing observations.':row.state==='failed'?'A required check has a retained failing observation.':'Required observations or supporting evidence are missing, ambiguous or inconclusive.';
   return row;
  }));
  const counts:Record<CoverageState,number>={passed:0,failed:0,blocked:0,uncertain:0,not_tested:0,excluded:0};for(const row of criteria)counts[row.state]++;
  return {schemaVersion:1,availability:'available',provenance:context.provenance,snapshotId:context.snapshotId,reviewId:context.reviewId,totalCriteria:criteria.length,inputApprovalState:context.approvalState,inputAcknowledged:run.revision.contextAcknowledged===true,acknowledgedBy:run.revision.contextAcknowledged===true?run.revision.createdBy:null,sourceStates:context.sources.map(({id,version,currency})=>({id,version,currency})),inputWarnings,requirementsWithoutCriteria:context.requirements.filter(item=>!item.criteria.length).map(item=>item.id),counts,criteria};
 }catch{return {schemaVersion:1,availability:'unavailable',reason:'Saved context or criterion references are incomplete or invalid. Historical requirement coverage is unavailable.'};}
}
