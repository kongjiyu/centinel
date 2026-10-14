import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {checkPage} from '../../src/dynamic/checker.js';
import {validateMission} from '../../src/dynamic/service.js';
import type {CheckDefinition} from '../../src/dynamic/types.js';
let browser:Browser;beforeAll(async()=>{browser=await chromium.launch({headless:true});});afterAll(async()=>{await browser?.close();});
const check=(kind:CheckDefinition['kind'],selector:string,expected:unknown):CheckDefinition=>({id:selector,criterionId:'form',description:'Form state',required:true,kind,selector,expected} as CheckDefinition);
describe('Independent form state checks',()=>{
 it('checks values, checked state, disabled state, native validity and multiple selected options without retaining values',async()=>{
  const page=await browser.newPage();try{await page.setContent('<input id="name" value="Synthetic"><input id="empty" required><input id="checked" type="checkbox" checked><input id="disabled" disabled><select id="selected" multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>');
   const results=await checkPage(page,[check('field_value','#name','Synthetic'),check('field_value','#empty',''),check('field_checked','#checked',true),check('field_enabled','#disabled',false),check('field_valid','#empty',false),check('selected_values','#selected',['b','a'])],['proof']);
   expect(results.every(result=>result.verdict==='passed')).toBe(true);expect(JSON.stringify(results)).not.toContain('Synthetic');
   const failure=await checkPage(page,[check('field_checked','#checked',false),check('field_value','#name','Wrong')],['proof']);expect(failure.every(result=>result.verdict==='failed')).toBe(true);
  }finally{await page.close();}
 });
 it('marks unavailable, ambiguous, private and unsupported observations uncertain instead of inferring a form failure',async()=>{
  const page=await browser.newPage();try{await page.setContent('<input class="duplicate"><input class="duplicate"><input id="password" type="password" value="private-fixture"><input id="private" value="declared-private"><div id="not-checkbox">false</div><input id="file" type="file">');
   const results=await checkPage(page,[check('field_value','#missing',''),check('field_value','.duplicate',''),check('field_value','#password','private-fixture'),check('field_value','#private','declared-private'),check('field_checked','#not-checkbox',false),check('field_value','#file','')],['proof'],undefined,{sensitiveSelectors:['#private']});
   expect(results.every(result=>result.verdict==='uncertain')).toBe(true);expect(JSON.stringify(results)).not.toContain('private-fixture');expect(JSON.stringify(results)).not.toContain('declared-private');const controller=new AbortController();controller.abort();expect((await checkPage(page,[check('field_enabled','#private',true)],[],controller.signal))[0].verdict).toBe('uncertain');
  }finally{await page.close();}
 });
 it('validates typed expectations and sanitizes extra caller metadata while permitting empty field values',()=>{
  const mission={name:'Form',goal:'Check state',targetUrl:'http://localhost:3000',maxSteps:2,context:null,contextAcknowledged:false,checks:[{...check('field_value','#empty',''),extra:'untrusted'}]};expect(validateMission(mission,'project').checks[0]).not.toHaveProperty('extra');
  for(const definition of [check('field_checked','#x','false'),check('field_value','#x',false),check('selected_values','#x',['a','a']),check('selected_values','#x',Array(31).fill('a')),check('field_valid','',true)])expect(()=>validateMission({...mission,checks:[definition]},'project')).toThrow();
 });
});
