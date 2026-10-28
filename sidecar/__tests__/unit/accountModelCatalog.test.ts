import {describe,it,expect,vi} from 'vitest';
import {readAccountModelCatalog} from '../../src/model/accountModelCatalog.js';

const tokens={accessToken:'test-access-only',chatgptAccountId:'test-account'};
describe('account-specific Codex model choices',()=>{
  it('uses the selected identity and current catalog, not a bundled model allowlist',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({models:[
      {slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list',input_modalities:['text','image']},
      {slug:'hidden-model',visibility:'hidden'},
      {slug:'gpt-6.1-sol',display_name:'Duplicate',visibility:'list'},
    ]})));
    expect(await readAccountModelCatalog(tokens,[],fetcher as typeof fetch)).toEqual([
      {id:'gpt-6.1-sol',label:'GPT-6.1 Sol',supportsImages:true,isDefault:false},
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(['https://api.openai.com/v1/models',expect.objectContaining({
      redirect:'error',headers:{Authorization:'Bearer test-access-only','Cache-Control':'no-cache'},
    })]);
  });
  it('does not invent screenshot support when a newly available model has no modality data',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({models:[{slug:'new-model',visibility:'list'}]})));
    expect(await readAccountModelCatalog(tokens,[],fetcher as typeof fetch)).toEqual([
      {id:'new-model',label:'new-model',supportsImages:false,imageSupportKnown:false,isDefault:false},
    ]);
  });
  it('can retain a matching native model capability without reintroducing catalog-absent models',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({models:[{slug:'available',visibility:'list'}]})));
    expect(await readAccountModelCatalog(tokens,[
      {id:'available',label:'Native',supportsImages:true,isDefault:true},
      {id:'absent',label:'Absent',supportsImages:true,isDefault:false},
    ],fetcher as typeof fetch)).toEqual([{id:'available',label:'available',supportsImages:true,isDefault:true}]);
  });
  it('rejects standard API-key catalogs rather than claiming ChatGPT account access',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:[{id:'gpt-6.1-sol'}]})));
    await expect(readAccountModelCatalog(tokens,[],fetcher as typeof fetch)).rejects.toThrow('catalog unavailable');
  });
  it('does not expose upstream error bodies or retry failed catalog reads',async()=>{
    const fetcher=vi.fn(async()=>new Response('private upstream body',{status:403}));
    await expect(readAccountModelCatalog(tokens,[],fetcher as typeof fetch)).rejects.toThrow('Account model catalog unavailable.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds the response and rejects malformed identifiers',async()=>{
    const large=vi.fn(async()=>new Response(' '.repeat(2*1024*1024+1)));
    await expect(readAccountModelCatalog(tokens,[],large as typeof fetch)).rejects.toThrow('exceeds its limit');
    const malformed=vi.fn(async()=>new Response(JSON.stringify({models:[{slug:'../private',visibility:'list'}]})));
    await expect(readAccountModelCatalog(tokens,[],malformed as typeof fetch)).rejects.toThrow('No displayable account models');
  });
});
