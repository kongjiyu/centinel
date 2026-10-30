import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openCodebaseIndex } from '../../sidecar/src/review/openCodebaseIndex.js';
const base = path.resolve('../data/repository-index');
async function stage(dir:string):Promise<string|undefined>{ for(const row of await fs.readdir(dir,{withFileTypes:true})){if(row.isDirectory()){ const full=path.join(dir,row.name);if(row.name.startsWith('stage-'))return full;const found=await stage(full);if(found)return found;}}}
const root=await stage(base);if(!root)throw Error('No failed stage');
let calls=0;
const server=http.createServer(async(req,res)=>{let input='';for await(const chunk of req)input+=chunk;const payload=JSON.parse(input);calls++;res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data:payload.input.map((_:unknown,index:number)=>({index,embedding:Array(1024).fill(0.5)})),usage:{total_tokens:5}}));});
server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};
const session=await openCodebaseIndex({projectRoot:root,mode:'hybrid',embedding:{baseUrl:`http://127.0.0.1:${address.port}/v1`,token:'fake-loopback-only',model:'voyage-4-lite',dimensions:1024}});
try {console.log(JSON.stringify({pathLength:root.length,status:await session.status(),index:await session.index(),fakeCalls:calls}));}finally{await session.close();server.close();}

