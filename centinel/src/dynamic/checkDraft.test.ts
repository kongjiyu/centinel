import {describe,expect,it} from 'vitest';import {checkToDraft,draftToCheck} from './checkDraft';import type {CheckDefinition} from './types';
describe('Form expectation editor contract',()=>{
 it('round-trips a download URL and independent file fingerprint',()=>{const check:CheckDefinition={id:'file',criterionId:'file',description:'Expected file',required:true,kind:'download_sha256',url:'http://localhost:3000/file',expected:'a'.repeat(64)};expect(draftToCheck(checkToDraft(check),'file')).toEqual(check);});
 it('round-trips empty field values, false state and empty/ordered option values',()=>{
  const base={id:'one',criterionId:'form',description:'Synthetic state',required:true,selector:'#field'};
  const checks:CheckDefinition[]=[{...base,kind:'field_value',expected:''},{...base,kind:'field_value',expected:' padded '},{...base,kind:'field_checked',expected:false},{...base,kind:'selected_values',expected:['',' b ','a']}];for(const check of checks)expect(draftToCheck(checkToDraft(check),check.criterionId)).toEqual(check);
 });
 it('retains historical address and visibility contracts and rejects a missing boolean choice',()=>{
  const old:CheckDefinition={id:'one',criterionId:'url',description:'Address',required:true,kind:'url',expected:'http://localhost:3000/'};expect(draftToCheck(checkToDraft(old),'url')).toEqual(old);expect(()=>draftToCheck({...checkToDraft(old),kind:'field_enabled',formExpected:''},'form')).toThrow();
 });
});
