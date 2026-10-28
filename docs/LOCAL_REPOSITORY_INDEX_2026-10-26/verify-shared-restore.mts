import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { restoreRepositorySnapshot } from '../../sidecar/src/review/repositoryIndexSnapshot.js';
import { openCodebaseIndex, INDEX_RELATIVE_DIRECTORY, portableIndexFiles } from '../../sidecar/src/review/openCodebaseIndex.js';
const workspace=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.resolve(workspace,process.argv[2]??'');
if(!process.argv[2]||!directory.startsWith(path.join(workspace,'evidence')+path.sep))throw Error('Pass a saved evidence directory.');
const receipt=JSON.parse(await fs.readFile(path.join(directory,'completed-index-receipt.json'),'utf8'));
const names=(await fs.readdir(directory)).filter(name=>/^\d+-shared-backup-download\.json$/.test(name)).sort();
const saved=JSON.parse(await fs.readFile(path.join(directory,names.at(-1)!), 'utf8')).data;
const bytes=Buffer.from(saved.base64,'base64');
if(bytes.length!==saved.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==saved.sha256)throw Error('Download checksum mismatch.');
const cacheKey=crypto.createHash('sha256').update('3844dc25-02c9-4d05-99c0-db0cf2c89943:'+receipt.identity.projectId+':'+receipt.identity.fingerprint).digest('hex');
const cache=path.join(workspace,'data/repository-index',cacheKey);
const stage=JSON.parse(await fs.readFile(path.join(cache,'location.json'),'utf8'));
if(!/^stage-[a-f\d-]{36}$/.test(stage))throw Error('Unsafe source staging pointer.');
const sourceRoot=path.join(cache,stage);
const restoredRoot=await fs.mkdtemp(path.join(os.tmpdir(),'centinel-shared-index-'));
for(const source of receipt.identity.sources){
  const content=await fs.readFile(path.join(sourceRoot,source.filePath));
  if(crypto.createHash('sha256').update(content).digest('hex')!==source.contentHash)throw Error('Frozen source mismatch.');
  const filename=path.join(restoredRoot,source.filePath);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,content,{flag:'wx'});
}
await restoreRepositorySnapshot(bytes,path.join(restoredRoot,INDEX_RELATIVE_DIRECTORY),receipt.identity);
const engine=await openCodebaseIndex({projectRoot:restoredRoot,mode:'hybrid',embedding:{model:receipt.identity.embedding.model,dimensions:receipt.identity.embedding.dimensions,baseUrl:'http://127.0.0.1:9/v1',token:'no-provider-request-allowed'}});
let status;
try{status=await engine.status();if(!status.ready)throw Error(status.detail);await engine.graph('httpAdapter','callees','lib/adapters/http.js');}finally{await engine.close();}
const files=await portableIndexFiles(path.join(restoredRoot,INDEX_RELATIVE_DIRECTORY));
const result={schemaVersion:'centinel-real-shared-index-restore-v1',status:'passed',archiveBytes:bytes.length,archiveSha256:saved.sha256,
  sourceFiles:receipt.identity.sources.length,engine:receipt.identity.engine,model:receipt.identity.embedding.model,dimensions:receipt.identity.embedding.dimensions,
  restoredInventory:files,compatibility:status.detail,embeddingRequests:0,assessmentRequests:0,
  limitation:'Same authenticated member downloaded the real server archive; a distinct second-member session remains unverified.'};
await fs.writeFile(path.join(directory,'shared-index-restore-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
