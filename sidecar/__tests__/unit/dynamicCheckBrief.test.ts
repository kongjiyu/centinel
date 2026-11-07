import {describe,it,expect} from 'vitest';
import {buildCheckBrief,CHECK_BRIEF_LIMITS} from '../../src/dynamic/browser/checkBrief.js';
import {buildPrompt} from '../../src/dynamic/browser/planner.js';
import type {CheckDefinition} from '../../src/dynamic/types.js';
import type {StaticContextFixture} from '../../src/dynamic/testing/staticContextStub.js';

const context:StaticContextFixture={schemaVersion:1,provenance:'review-snapshot',projectId:'p1',reviewId:'r1',snapshotId:'s1',approvalState:'approved',
  sources:[{id:'src',version:'v1',currency:'current',uri:'https://example.test/req.md'}],
  requirements:[
    {id:'REQ-1',revision:1,sourceId:'src',description:'Catalogue',criteria:[{id:'REQ-1:statement',description:'Catalogue accessible without sign-in: Without signing in, a user can view the product list including names and prices.'}]},
    {id:'REQ-2',revision:1,sourceId:'src',description:'Checkout',criteria:[{id:'REQ-2:statement',description:'Checkout charges the saved card exactly once.'}]},
    {id:'REQ-3',revision:1,sourceId:'src',description:'Admin',criteria:[{id:'REQ-3:statement',description:'Administrators can delete any order.'}]},
  ],risks:[],conflicts:[],target:{repository:null,commit:null,deploymentVersion:null},limitations:[]};
const observe={url:'http://shop.test/',title:'Shop',visibleText:'',elements:[]};
const mug:CheckDefinition={id:'c1',criterionId:'REQ-1:statement',description:'Catalogue shows products',required:true,kind:'visible_text',expected:'Ceramic Mug'};

describe('planner check brief',()=>{
  it('lists the linked criterion statement and check expectation in the planner prompt',()=>{
    const brief=buildCheckBrief([mug],context);
    const prompt=buildPrompt('Check the selected criteria below.',observe,[],0,undefined,brief);
    expect(prompt).toContain('What this test checks');
    expect(prompt).toContain('Without signing in, a user can view the product list');
    expect(prompt).toContain('Required check: Catalogue shows products');
    expect(prompt).toContain('"Ceramic Mug"');
    expect(prompt).toContain('independent checker');
    expect(prompt).toContain('no interaction is needed');
  });
  it('never presents unselected or excluded criteria as in scope',()=>{
    const brief=buildCheckBrief([mug],context,[{criterionId:'REQ-3:statement',reason:'Not deployed'}]);
    expect(brief).not.toContain('Checkout charges');
    expect(brief).not.toContain('Administrators can delete');
    // A check that somehow maps to an excluded criterion is not listed either.
    expect(buildCheckBrief([{...mug,criterionId:'REQ-3:statement'}],context,[{criterionId:'REQ-3:statement',reason:'x'}])).toBe('');
  });
  it('withholds field values and file fingerprints',()=>{
    const brief=buildCheckBrief([
      {id:'c2',criterionId:'manual-1',description:'Email kept',required:true,kind:'field_value',selector:'#email',expected:'private-user@example.test'},
      {id:'c3',criterionId:'manual-2',description:'Choices kept',required:false,kind:'selected_values',selector:'#tags',expected:['secret-tag']},
      {id:'c4',criterionId:'manual-3',description:'Report file',required:true,kind:'download_sha256',url:'http://shop.test/r.csv',expected:'a'.repeat(64)},
    ],null);
    expect(brief).toContain('Email kept');
    expect(brief).not.toContain('private-user@example.test');
    expect(brief).not.toContain('secret-tag');
    expect(brief).not.toContain('a'.repeat(64));
    expect(brief.indexOf('Report file')).toBeLessThan(brief.indexOf('Choices kept'));
  });
  it('is bounded by item count and total size',()=>{
    const many=Array.from({length:60},(_,index):CheckDefinition=>({id:'c'+index,criterionId:'manual-'+index,description:'D'+index+' '+'x'.repeat(1000),required:true,kind:'visible_text',expected:'y'.repeat(1000)}));
    const brief=buildCheckBrief(many,null);
    expect(brief.length).toBeLessThan(CHECK_BRIEF_LIMITS.totalChars+1500);
    expect(brief).toMatch(/\(\d+ more checks not shown\.\)/);
    expect(brief).not.toContain('x'.repeat(400));
  });
  it('adds nothing without checks and keeps legacy prompts unchanged',()=>{
    expect(buildCheckBrief([],context)).toBe('');
    expect(buildPrompt('Goal',observe,[],0)).not.toContain('What this test checks');
  });
});
