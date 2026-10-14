import type {CheckDefinition} from './types';
export type DraftCheck={id:string;criterionId:string;description:string;kind:CheckDefinition['kind'];value:string;formExpected:string;includeEmptyOption:boolean;required:boolean};
export const isBooleanFormCheck=(kind:CheckDefinition['kind'])=>['field_checked','field_enabled','field_valid'].includes(kind);
export function checkToDraft(check:CheckDefinition):DraftCheck{
 const expected='expected' in check?check.expected:'';
 return {id:check.id,criterionId:check.criterionId,description:check.description,kind:check.kind,value:'selector' in check?check.selector:String(expected),formExpected:Array.isArray(expected)?expected.filter(value=>value!=='').join('\n'):String(expected),includeEmptyOption:Array.isArray(expected)&&expected.includes(''),required:check.required};
}
export function draftToCheck(check:DraftCheck,criterionId:string):CheckDefinition{
 const base={id:check.id,criterionId,description:check.description.trim()||({url:'Expected page address',visible_text:'Expected visible text',element_visible:'Expected visible element'} as Partial<Record<CheckDefinition['kind'],string>>)[check.kind]||'Configured '+check.kind.replaceAll('_',' ')+' check',required:check.required};
 switch(check.kind){
  case 'url':case 'visible_text':return {...base,kind:check.kind,expected:check.value.trim()};
  case 'element_visible':return {...base,kind:check.kind,selector:check.value.trim()};
  case 'field_value':return {...base,kind:check.kind,selector:check.value.trim(),expected:check.formExpected};
  case 'selected_values':return {...base,kind:check.kind,selector:check.value.trim(),expected:[...new Set([...(check.includeEmptyOption?['']:[]),...check.formExpected.split('\n').filter(value=>value!=='')])]};
  default:if(!['true','false'].includes(check.formExpected))throw Error('Choose the expected form state.');return {...base,kind:check.kind,selector:check.value.trim(),expected:check.formExpected==='true'};
 }
}
