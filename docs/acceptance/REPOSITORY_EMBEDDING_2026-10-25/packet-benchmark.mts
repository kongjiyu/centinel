import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deriveReviewAnalysisMap } from '../../sidecar/src/review/featurePathAnalysis.js';
import { planAssessmentBatches, contextForAssessmentBatch, analysisMapForBatchPrompt } from '../../sidecar/src/review/assessmentBatches.js';
import { StaticReviewOrchestratorService } from '../../sidecar/src/review/orchestrator.js';
import { runStaticAnalysis } from '../../sidecar/src/staticEngine.js';
import { normalizeDeterministicFinding } from '../../sidecar/src/review/findings.js';

process.chdir(path.resolve(import.meta.dirname,'../..'));
const baseline=process.argv.includes('--baseline');
const baselineEvidence=baseline?null:JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'baseline-packets.json'),'utf8'));
const root='evidence/public-repo-outcomes-2026-10-22';
const run=fs.readFileSync(path.join(root,'active-mitigation-run.txt'),'utf8').trim();
const manifest=JSON.parse(fs.readFileSync('docs/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json','utf8'));
const events=fs.readdirSync(run).filter(name=>/^\d{4}-.+\.json$/.test(name)).sort().map(name=>JSON.parse(fs.readFileSync(path.join(run,name),'utf8')));
const orchestrator=new StaticReviewOrchestratorService({repository:{} as any}) as any;
const results:any[]=[];
for(const item of manifest.cases){
  const artifacts=events.filter((event:any)=>event.instanceId===item.instanceId&&event.kind==='imported-artifacts').at(-1)?.data;
  if(!Array.isArray(artifacts))throw Error(`Missing artifacts: ${item.alias}`);
  const sources=artifacts.map((artifact:any)=>{
    const bytes=fs.readFileSync(path.join(item.inputDirectory,artifact.filePath));
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==artifact.contentHash)throw Error('Frozen hash mismatch');
    return {artifact,content:bytes.toString('utf8'),state:'available' as const};
  });
  const byId=new Map(sources.map(source=>[source.artifact.id,source]));
  const map=deriveReviewAnalysisMap(sources);
  const deterministic=(await runStaticAnalysis(item.alias,artifacts,'repository-packet-benchmark',{contentReader:async(artifact:any)=>byId.get(artifact.id)!.content}))
    .map(finding=>normalizeDeterministicFinding(finding,artifacts.find((artifact:any)=>artifact.filePath===finding.filePath)?.id));
  const planningStarted=performance.now();
  const batches=planAssessmentBatches(map,sources);
  const planningMilliseconds=Math.round(performance.now()-planningStarted);
  let prompt=0,system=0,schema=0,sourceCharacters=0;
  const featureIds=batches.flatMap(batch=>batch.features.map(feature=>feature.id));
  if(featureIds.length!==map.features.length||new Set(featureIds).size!==map.features.length||map.features.some(feature=>!featureIds.includes(feature.id)))throw Error('Feature coverage mismatch');
  const proofs=sources.map(source=>{
    const lines=source.content.split('\n');
    const covered=new Set<number>();
    for(const batch of batches)for(const segment of batch.sources.filter(segment=>segment.artifact.id===source.artifact.id)){
      if(segment.content!==lines.slice(segment.lineStart-1,segment.lineEnd).join('\n'))throw Error('Packet bytes mismatch');
      if(!batch.features.length)for(let line=segment.lineStart;line<=segment.lineEnd;line++)covered.add(line);
    }
    if(covered.size!==lines.length)throw Error(`Independent sweep gap: ${source.artifact.filePath}`);
    return {artifactId:source.artifact.id,filePath:source.artifact.filePath,contentHash:source.artifact.contentHash,lines:lines.length,independentSweepComplete:true};
  });
  if(baselineEvidence){
    const previous=baselineEvidence.results.find((result:any)=>result.alias===item.alias);
    if(!previous||previous.features!==map.features.length||JSON.stringify(previous.proofs)!==JSON.stringify(proofs))throw Error('The frozen before/after inputs or feature inventory changed');
  }
  for(const batch of batches){
    const batchMap={...map,features:batch.features};
    const request=await orchestrator.buildModelRequest({id:'offline',projectId:item.alias,reviewType:'code_review',config:{instructions:'Assess supplied frozen sources across four domains using exact evidence.'}},
      contextForAssessmentBatch(null,batch.sources),deterministic,new AbortController().signal,batch.sources,[],[],null,analysisMapForBatchPrompt(batchMap,batch.sources),[]);
    prompt+=request.prompt.length;system+=request.systemPrompt.length;schema+=JSON.stringify(request.outputSchema).length;
    sourceCharacters+=batch.sources.reduce((sum,segment)=>sum+segment.content.length,0);
  }
  results.push({alias:item.alias,selectedFiles:sources.length,features:map.features.length,batches:batches.length,promptCharacters:prompt,systemCharacters:system,schemaCharacters:schema,sourceCharacters,planningMilliseconds,
    proofs,packets:batches.map(batch=>({id:batch.id,features:batch.features.map(feature=>feature.id),sources:batch.sources.map(segment=>({artifactId:segment.artifact.id,hash:segment.artifact.contentHash,lineStart:segment.lineStart,lineEnd:segment.lineEnd}))}))});
}
const output={capturedAt:new Date().toISOString(),kind:baseline?'v11-before-repository-packets':'after-repository-packets',execution:'Static parser and deterministic rules only; no repository code execution or model calls.',results};
const destination=path.join(import.meta.dirname,baseline?'baseline-packets.json':'optimized-packets.json');
if(baseline&&fs.existsSync(destination))throw Error('Baseline already exists; do not overwrite historical baseline.');
fs.writeFileSync(destination,JSON.stringify(output,null,2));
console.log(JSON.stringify(results.map(({alias,selectedFiles,features,batches,promptCharacters,sourceCharacters})=>({alias,selectedFiles,features,batches,promptCharacters,sourceCharacters}))));
