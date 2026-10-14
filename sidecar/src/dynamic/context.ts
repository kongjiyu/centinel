import {DynamicContractError,type CheckDefinition,type CriterionExclusion} from './types.js';
import type {StaticContextFixture} from './testing/staticContextStub.js';
const fail=(message:string):never=>{throw new DynamicContractError(400,message);};
const object=(value:unknown):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('Invalid incoming context structure.');return value as Record<string,any>;};
const text=(value:unknown,maximum=200):string=>{if(typeof value!=='string'||!value.trim()||value.length>maximum)return fail('Incoming context text must be nonempty and bounded.');return value;};
const list=(value:unknown,maximum:number):any[]=>{if(!Array.isArray(value)||value.length>maximum)return fail('Incoming context arrays must be bounded.');return value;};
const unique=(values:string[],label:string)=>{if(new Set(values).size!==values.length)fail('Duplicate incoming '+label+' IDs.');};
/** Construct the versioned consumer DTO, excluding arbitrary caller metadata. */
export function validateIncomingContext(value:unknown,projectId:string):StaticContextFixture|null {
 if(value==null)return null;
 const input=object(value);
 if(input.schemaVersion!==1||input.provenance!=='mock-static'||input.projectId!==projectId)fail('Invalid or cross-project incoming context.');
 if(!['approved','pending'].includes(input.approvalState))fail('Invalid incoming context approval metadata.');
 const sources=list(input.sources,50).map(raw=>{const source=object(raw);if(!['current','stale','unknown'].includes(source.currency))fail('Invalid source currency.');return {id:text(source.id),version:text(source.version),currency:source.currency,uri:text(source.uri,4000)};});
 unique(sources.map(source=>source.id),'source');const sourceIds=new Set(sources.map(source=>source.id));
 const requirements=list(input.requirements,100).map(raw=>{const item=object(raw);if(!Number.isSafeInteger(item.revision)||item.revision<1)fail('Invalid requirement revision.');if(!sourceIds.has(item.sourceId))fail('Incoming context contains dangling source references.');return {id:text(item.id),revision:item.revision,description:text(item.description,4000),sourceId:text(item.sourceId),criteria:list(item.criteria,100).map(raw=>{const criterion=object(raw);return {id:text(criterion.id),description:text(criterion.description,4000)};})};});
 unique(requirements.map(item=>item.id),'requirement');const requirementIds=new Set(requirements.map(item=>item.id));const criteria=requirements.flatMap(item=>item.criteria);
 if(criteria.length>500)fail('Incoming context has too many supplied criteria.');unique(criteria.map(item=>item.id),'criterion');
 const risks=list(input.risks,100).map(raw=>{const risk=object(raw);if(!requirementIds.has(risk.requirementId)||!['high','medium'].includes(risk.priority))fail('Invalid or dangling synthetic risk reference.');return {id:text(risk.id),requirementId:text(risk.requirementId),priority:risk.priority,rationale:text(risk.rationale,4000)};});unique(risks.map(risk=>risk.id),'risk');
 const conflicts=list(input.conflicts,100).map(raw=>{const conflict=object(raw);if(!requirementIds.has(conflict.requirementId))fail('Incoming context contains dangling conflict references.');return {requirementId:text(conflict.requirementId),description:text(conflict.description,4000)};});
 const target=object(input.target);const repository=text(target.repository,4000);let parsed:URL;try{parsed=new URL(repository);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();}catch{return fail('Invalid incoming repository reference.');}
 if(typeof target.commit!=='string'||!/^[a-f0-9]{40}$/i.test(target.commit)||target.deploymentVersion!==null)fail('Invalid target version metadata; the mock deployment remains unknown.');
 return structuredClone({schemaVersion:1,provenance:'mock-static',projectId,reviewId:text(input.reviewId),snapshotId:text(input.snapshotId),approvalState:input.approvalState,sources,requirements,risks,conflicts,target:{repository,commit:target.commit,deploymentVersion:null},limitations:list(input.limitations,100).map(value=>text(value,4000))});
}
export function contextNeedsAcknowledgment(context:StaticContextFixture|null):boolean {
 return Boolean(context&&(context.approvalState!=='approved'||context.sources.some(source=>source.currency!=='current')||context.conflicts.length||context.requirements.some(requirement=>!requirement.criteria.length)));
}
export function validateCriterionExclusions(value:unknown,context:StaticContextFixture|null,checks:CheckDefinition[]):CriterionExclusion[] {
 if(value===undefined)return [];
 const items=list(value,500).map(raw=>{const item=object(raw);return {criterionId:text(item.criterionId),reason:text(item.reason,2000).trim()};});
 unique(items.map(item=>item.criterionId),'excluded criterion');
 const criteria=new Set(context?.requirements.flatMap(item=>item.criteria.map(criterion=>criterion.id))??[]);
 if(items.some(item=>!criteria.has(item.criterionId)))fail('Exclusion references a criterion absent from the incoming snapshot.');
 if(items.some(item=>checks.some(check=>check.criterionId===item.criterionId)))fail('An executing check cannot also exclude its criterion.');
 return items;
}
