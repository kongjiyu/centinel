import {it,expect} from 'vitest';import fs from 'node:fs';
if(process.env.CENTINEL_UNIT_CASE==='skipped')it.skip('public skipped fixture',()=>{});
else if(process.env.CENTINEL_UNIT_CASE==='todo')it.todo('public todo fixture');
else it('public deterministic unit fixture',async()=>{if(['slow','case_wait_20261015'].includes(process.env.CENTINEL_UNIT_CASE??'')){if(process.env.CENTINEL_UNIT_MARKER)fs.writeFileSync(process.env.CENTINEL_UNIT_MARKER,'started');await new Promise(resolve=>setTimeout(resolve,30000));}if(['failed','case_broken_20261015'].includes(process.env.CENTINEL_UNIT_CASE??''))expect('public actual').toBe('public expected');else expect(2+2).toBe(4);});
