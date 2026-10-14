import crypto from 'node:crypto';
import type {BrowserObservation} from './observation.js';
import type {CheckDefinition,CheckResult,CheckVerdict} from '../types.js';
import {aggregateChecks} from '../checker.js';
import {redactObservationRecord} from './privacy.js';
export type ExplorationSnapshot={schemaVersion:1;mode:'exploratory';objectives:Array<{criterionId:string;checkIds:string[];verdict:CheckVerdict}>;states:Array<{id:string;url:string;title:string;visits:number;omittedControls:boolean;controls:Array<{ref:string;role:string;name:string;selector?:string}>}>;actions:Array<{step:number;action:string;beforeStateId:string;afterStateId?:string;targetRef?:string;status:'dispatched'|'skipped'|'blocked'|'unavailable'|'uncertain'}>;unvisitedControls:Array<{stateId:string;ref:string}>;unresolvedControls:Array<{stateId:string;ref:string}>;unresolvedTargetActions:number;limits:{maxStates:51;maxActions:25};truncated:boolean;exhaustive:false;limitations:string[]};
/** Samples only the bounded main-document DOM observations actually obtained.
 * A state/control visit is not a passed requirement or exhaustive site coverage. */
export class ExplorationJournal {
 private verifiedResults:readonly CheckResult[]=[];
 private states:ExplorationSnapshot['states']=[];private actions:ExplorationSnapshot['actions']=[];private truncated=false;
 constructor(private readonly checks:readonly CheckDefinition[],private readonly secrets:readonly string[]){}
 observe(observation:BrowserObservation):string{
  const clean=redactObservationRecord(observation,this.secrets);const id=crypto.createHash('sha256').update(JSON.stringify({url:clean.url,title:clean.title,visibleText:clean.visibleText,controls:clean.controls})).digest('hex');const old=this.states.find(state=>state.id===id);if(old){old.visits++;return id;}if(this.states.length>=51){this.truncated=true;return id;}
  const state={id,url:clean.url.slice(0,2000),title:clean.title.slice(0,500),visits:1,omittedControls:clean.omittedControls,controls:clean.controls.map(({ref,role,name,selector})=>({ref,role,name,...(selector?{selector}:{})}))};if(Buffer.byteLength(JSON.stringify([...this.states,state]))>262144){this.truncated=true;return id;}this.states.push(state);return id;
 }
 action(entry:ExplorationSnapshot['actions'][number]){if(this.actions.length>=25){this.truncated=true;return;}const before=this.states.find(state=>state.id===entry.beforeStateId);if(!before){this.truncated=true;return;}const targetRef=entry.targetRef&&before.controls.some(control=>control.ref===entry.targetRef)?entry.targetRef:undefined;const afterStateId=entry.afterStateId&&this.states.some(state=>state.id===entry.afterStateId)?entry.afterStateId:undefined;this.actions.push({...entry,action:entry.action==='click_visual'?'click':entry.action,targetRef,afterStateId});}
 setIndependentResults(results:readonly CheckResult[]){this.verifiedResults=structuredClone(results);}
 snapshot(results:readonly CheckResult[]=this.verifiedResults):ExplorationSnapshot{
  const objectives=[...new Set(this.checks.map(check=>check.criterionId))].map(criterionId=>{const definitions=this.checks.filter(check=>check.criterionId===criterionId);return {criterionId,checkIds:definitions.map(check=>check.id),verdict:results.length?aggregateChecks([...definitions],results.map(result=>['passed','failed'].includes(result.verdict)&&!result.evidenceIds.length?{...result,verdict:'uncertain' as const}:result)):'not_tested' as const};});
  const visited=new Set(this.actions.filter(action=>action.status==='dispatched'||action.status==='skipped').filter(action=>action.targetRef).map(action=>action.beforeStateId+':'+action.targetRef));
  const unresolved=new Set(this.actions.filter(action=>action.status==='uncertain'&&action.targetRef).map(action=>action.beforeStateId+':'+action.targetRef));
  return redactObservationRecord({schemaVersion:1,mode:'exploratory',objectives,states:this.states,actions:this.actions,unvisitedControls:this.states.flatMap(state=>state.controls.filter(control=>!visited.has(state.id+':'+control.ref)&&!unresolved.has(state.id+':'+control.ref)).map(control=>({stateId:state.id,ref:control.ref}))),unresolvedControls:this.states.flatMap(state=>state.controls.filter(control=>unresolved.has(state.id+':'+control.ref)).map(control=>({stateId:state.id,ref:control.ref}))),unresolvedTargetActions:this.actions.filter(action=>!action.targetRef&&['click','type','select_option','set_checked','upload_file'].includes(action.action)).length,limits:{maxStates:51,maxActions:25},truncated:this.truncated,exhaustive:false,limitations:['Only sampled main-document DOM states and controls are recorded. Iframes, shadow roots, offscreen or omitted controls and undiscovered routes may remain unobserved.','Unvisited controls are not a complete inventory of untested application behavior.','Independent check results determine selected objective outcomes; visits and model conclusions do not establish a pass.']},this.secrets) as ExplorationSnapshot;
 }
 planningContext(){const snapshot=this.snapshot();return JSON.stringify({selectedObjectives:snapshot.objectives.map(objective=>({...objective,descriptions:this.checks.filter(check=>check.criterionId===objective.criterionId).map(check=>check.description.slice(0,200))})),visitedStates:snapshot.states.slice(-8).map(state=>({id:state.id,url:state.url.slice(0,300),visits:state.visits})),recentActions:snapshot.actions.slice(-5),unvisitedObservedControls:snapshot.unvisitedControls.slice(0,40),exhaustive:false});}
}

/** Resolve only frozen selected objectives against independently retained checks. */
export function resolveExplorationObjectives(snapshot:ExplorationSnapshot,checks:readonly CheckDefinition[],results:readonly CheckResult[]):ExplorationSnapshot {
 const verified=results.map(result=>['passed','failed'].includes(result.verdict)&&!result.evidenceIds.length?{...result,verdict:'uncertain' as const}:result);
 return {...structuredClone(snapshot),objectives:[...new Set(checks.map(check=>check.criterionId))].map(criterionId=>{const selected=checks.filter(check=>check.criterionId===criterionId);return {criterionId,checkIds:selected.map(check=>check.id),verdict:verified.length?aggregateChecks([...selected],verified):'not_tested'};})};
}
