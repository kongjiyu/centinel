import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = await fs.readFile(new URL('./diagnose-index.mts', import.meta.url), 'utf8');
const revised = script.replace("const root=await stage(base);if(!root)throw Error('No failed stage');", "const failedRoot=await stage(base);if(!failedRoot)throw Error('No failed stage'); const root=await fs.mkdtemp(path.join(os.tmpdir(),'cidx-'));await fs.cp(failedRoot,root,{recursive:true,filter:source=>!source.includes('.codebase-index')});");
await fs.writeFile(new URL('./diagnose-short-index.mts',import.meta.url), revised);
