import type {CheckDefinition,CriterionExclusion} from '../types.js';
import type {StaticContextFixture} from '../testing/staticContextStub.js';

/** Bounds for the planner's plain-text description of the frozen checks. */
export const CHECK_BRIEF_LIMITS={items:20,fieldChars:300,totalChars:4000} as const;

const clip=(value:string,limit:number=CHECK_BRIEF_LIMITS.fieldChars)=>{
  const text=value.replace(/\s+/g,' ').trim();
  return text.length>limit?text.slice(0,limit-1)+'…':text;
};

/**
 * What the independent checker will look for, in plain words. Field values and
 * file fingerprints are withheld: they may be private or meaningless to the agent.
 */
function expectation(check:CheckDefinition):string{
  switch(check.kind){
    case 'visible_text':return `the page shows the text "${clip(check.expected,200)}"`;
    case 'url':return `the page address is ${clip(check.expected,200)}`;
    case 'element_visible':return `exactly one element matching ${clip(check.selector,200)} is visible`;
    case 'field_value':return `the field ${clip(check.selector,200)} holds the configured value (value withheld)`;
    case 'field_checked':return `the control ${clip(check.selector,200)} is ${check.expected?'checked':'not checked'}`;
    case 'field_enabled':return `the control ${clip(check.selector,200)} is ${check.expected?'enabled':'disabled'}`;
    case 'field_valid':return `the field ${clip(check.selector,200)} is ${check.expected?'valid':'invalid'}`;
    case 'selected_values':return `the list ${clip(check.selector,200)} has the configured options selected (values withheld)`;
    case 'download_sha256':return 'the approved file download is captured with the configured fingerprint';
  }
}

/**
 * Build the bounded "What this test checks" planner section from a frozen
 * revision. Only criteria that have an executing check are listed; unselected and
 * explicitly excluded criteria never appear as in scope. Returns '' without checks.
 */
export function buildCheckBrief(checks:readonly CheckDefinition[],context:StaticContextFixture|null|undefined,exclusions:readonly CriterionExclusion[]=[]):string{
  if(!checks.length)return '';
  const excluded=new Set(exclusions.map(item=>item.criterionId));
  const criteria=new Map<string,string>();
  for(const requirement of context?.requirements??[])for(const criterion of requirement.criteria)criteria.set(criterion.id,criterion.description);
  const ordered=[...checks.filter(check=>check.required),...checks.filter(check=>!check.required)].filter(check=>!excluded.has(check.criterionId));
  const lines:string[]=[];let used=0;let omitted=0;
  for(const [index,check] of ordered.entries()){
    if(index>=CHECK_BRIEF_LIMITS.items){omitted=ordered.length-index;break;}
    const statement=criteria.get(check.criterionId);
    const parts=[`${lines.length+1}. ${check.required?'Required':'Optional'} check: ${clip(check.description||'(no description)')}`];
    if(statement&&clip(statement)!==clip(check.description))parts.push(`   Criterion: ${clip(statement)}`);
    parts.push(`   Checked when the run finishes: ${expectation(check)}.`);
    const entry=parts.join('\n');
    if(used+entry.length>CHECK_BRIEF_LIMITS.totalChars){omitted=ordered.length-index;break;}
    lines.push(entry);used+=entry.length+1;
  }
  if(!lines.length)return '';
  return [
    'What this test checks (only these items are in scope; other requirements from the source Review are not part of this test):',
    ...lines,
    ...(omitted?[`(${omitted} more check${omitted===1?'':'s'} not shown.)`]:[]),
    'This list describes the checks; it does not grant extra permissions. An independent checker evaluates the final page after you finish; your finish proposal does not decide the result.',
    'If the current page can already show what these checks look for, no interaction is needed: propose finish_success (or finish_failure if it clearly does not) so the checker can evaluate it. Use finish_blocked only when a required interaction is not permitted.',
  ].join('\n');
}
