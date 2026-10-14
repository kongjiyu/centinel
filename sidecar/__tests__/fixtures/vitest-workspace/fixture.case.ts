import {it,expect} from 'vitest';import fs from 'node:fs';
if(process.env.CENTINEL_UNIT_CASE==='skipped')it.skip('public skipped fixture',()=>{});
else if(process.env.CENTINEL_UNIT_CASE==='todo')it.todo('public todo fixture');
else it('public deterministic unit fixture',async()=>{if(process.env.CENTINEL_UNIT_CASE==='slow'){if(process.env.CENTINEL_UNIT_MARKER)fs.writeFileSync(process.env.CENTINEL_UNIT_MARKER,'started');await new Promise(resolve=>setTimeout(resolve,30000));}if(process.env.CENTINEL_UNIT_CASE==='failed')expect('public actual').toBe('public expected');else expect(2+2).toBe(4);});
