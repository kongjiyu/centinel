import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {authorizeBrowserAction,normalizeActionPolicy} from '../../src/dynamic/browser/actionPolicy.js';
let browser:Browser;beforeAll(async()=>{browser=await chromium.launch({headless:true});});afterAll(async()=>{await browser?.close();});
describe('Frozen browser action permissions',()=>{
 it('defaults to no interaction grants and rejects unbounded or invented permissions',()=>{
  expect(normalizeActionPolicy()).toEqual({schemaVersion:1,interactions:[],allowCoordinates:false});
  for(const value of [null,{schemaVersion:1,interactions:[],allowCoordinates:'yes'},{schemaVersion:1,interactions:[{selector:'#x',actions:['delete']}],allowCoordinates:false},{schemaVersion:1,interactions:[{selector:'#x',actions:['click']},{selector:'#x',actions:['type']}],allowCoordinates:false},{schemaVersion:1,interactions:[],allowCoordinates:false,fromPage:true}])expect(()=>normalizeActionPolicy(value)).toThrow();
 });
 it('authorizes actual targets through private refs and ignores misleading model descriptions',async()=>{
  const page=await browser.newPage();try{await page.setContent('<input id="name"><button id="save">Save</button><button id="delete">Safe read-only navigation</button>');
   const policy=normalizeActionPolicy({schemaVersion:1,interactions:[{selector:'#name',actions:['type']},{selector:'#save',actions:['click']}],allowCoordinates:false});const options={policy,origins:['https://fixture.test'],bindings:new Map([['e0','#name'],['e1','#delete']])};
   await authorizeBrowserAction(page,{action:'type',elementRef:'e0',targetDescription:'name',text:'Fixture',reasoning:''},options);
   await expect(authorizeBrowserAction(page,{action:'click',elementRef:'e1',targetDescription:'Safe read-only',reasoning:''},options)).rejects.toThrow('not approved');
   await expect(authorizeBrowserAction(page,{action:'click',selector:'#name',targetDescription:'name',reasoning:''},options)).rejects.toThrow('not approved');
   expect(await page.locator('#name').inputValue()).toBe('');
  }finally{await page.close();}
 });
 it('blocks file controls, their nested labels and download links even with a click grant',async()=>{
  const page=await browser.newPage();try{await page.setContent('<input id="file" type="file"><label for="file"><span id="label">Upload</span></label><a id="download" download href="/file">Download</a>');const policy=normalizeActionPolicy({schemaVersion:1,interactions:['#file','#label','#download'].map(selector=>({selector,actions:['click']})),allowCoordinates:false});
   for(const selector of ['#file','#label','#download'])await expect(authorizeBrowserAction(page,{action:'click',selector,targetDescription:'Approved',reasoning:''},{policy,origins:[]})).rejects.toThrow('File controls');
  }finally{await page.close();}
 });
 it('requires both coordinate consent and a unique approved control at the actual point',async()=>{
  const page=await browser.newPage();try{await page.setContent('<button id="save" style="position:absolute;left:20px;top:20px;width:100px;height:60px">Save</button>');const action={action:'click' as const,x:30,y:30,targetDescription:'Save',reasoning:''};const policy=normalizeActionPolicy({schemaVersion:1,interactions:[{selector:'#save',actions:['click']}],allowCoordinates:true});
   await authorizeBrowserAction(page,action,{policy,origins:[]});await expect(authorizeBrowserAction(page,{...action,x:300,y:300},{policy,origins:[]})).rejects.toThrow('explicitly approved');await expect(authorizeBrowserAction(page,action,{policy:{...policy,allowCoordinates:false},origins:[]})).rejects.toThrow('not enabled');
  }finally{await page.close();}
 });
 it('rejects implicit keyboard submission, foreign navigation and cancelled authorization',async()=>{
  const page=await browser.newPage();try{const options={policy:normalizeActionPolicy(),origins:['https://fixture.test']};await expect(authorizeBrowserAction(page,{action:'press_key',key:'Enter',reasoning:''},options)).rejects.toThrow('submit');await expect(authorizeBrowserAction(page,{action:'navigate',url:'https://foreign.test',reasoning:''},options)).rejects.toThrow('origins');await authorizeBrowserAction(page,{action:'navigate',url:'https://fixture.test/path',reasoning:''},options);const controller=new AbortController();controller.abort();await expect(authorizeBrowserAction(page,{action:'wait',milliseconds:1,reasoning:''},{...options,signal:controller.signal})).rejects.toHaveProperty('name','AbortError');}finally{await page.close();}
 });
});
