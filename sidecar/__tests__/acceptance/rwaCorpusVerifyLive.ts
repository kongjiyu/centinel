/** Readback of every predeclared RWA sample, shared proof and explicit QA review. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { requireSupabaseClient } from '../../src/supabase.js';
import { getProject } from '../../src/projects.js';
const project='6a1f51f5-96da-43f5-b693-462e57e23cd3',base='http://localhost:37711/projects/'+project+'/dynamic';
const protocol=JSON.parse(fs.readFileSync('output/playwright/rwa-corpus-protocol.json','utf8'));
const client=requireSupabaseClient(),reader=requireSupabaseClient();
const a=await client.auth.signInWithPassword({email:process.env.CENTINEL_DEV_ACCOUNT_EMAIL!,password:process.env.CENTINEL_DEV_ACCOUNT_PASSWORD!});
const b=await reader.auth.signInWithPassword({email:process.env.CENTINEL_DEV_READER_EMAIL!,password:process.env.CENTINEL_DEV_READER_PASSWORD!});assert(a.data.session&&b.data.session);
const hash=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
async function req(suffix:string,body?:unknown,token=a.data.session!.access_token){const r=await fetch(base+suffix,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;}
const local=await getProject(project);assert(local);
const audit:any={protocolCommit:'916a027',engine:protocol.engine,projectId:project,samples:[],complete:false};
const save=()=>fs.writeFileSync('output/playwright/rwa-corpus-verified.json',JSON.stringify(audit,null,2));
let revision:string|undefined;const findingIds=new Set<string>();
for(const variant of ['normal','defect'])for(const repetition of [1,2,3]){
 const retained=JSON.parse(fs.readFileSync(`output/playwright/rwa-corpus-${variant}-${repetition}.json`,'utf8'));assert(!retained.pending);
 const result=retained.result,run=await req('/runs/'+result.runId);assert.equal(run.state,'completed');assert.equal(run.verdict,variant==='normal'?'passed':'failed');
 assert.deepEqual(run,retained.run);revision??=run.revision.id;assert.equal(run.revision.id,revision);assert.equal(run.revision.checks[0].expected,protocol.expectedFirstName);
 assert.equal(result.initialDatabaseHash,protocol.databaseSha256);assert(result.primaryUnchanged&&result.unrelatedDataPreserved&&result.cleanupRecorded);
 const copies=await req('/runs/'+run.id+'/evidence/sync',{});let proofs=0;
 for(const proof of run.evidence){const copy=copies.find((c:any)=>c.evidenceId===proof.id);assert(copy?.availability==='available');const response=await fetch(base+'/runs/'+run.id+'/evidence/'+copy.id+'/content',{headers:{Authorization:'Bearer '+b.data.session!.access_token}});assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),proof.sha256);proofs++;}
 const candidates=await req('/runs/'+run.id+'/findings',{});assert.equal(candidates.length,variant==='defect'?1:0);for(const finding of candidates)findingIds.add(finding.id);
 const usage=await client.from('model_usage_records').select('stage,provider,model,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens').eq('project_id',project).eq('owner_id',a.data.user!.id).contains('metadata',{runId:run.id});assert(!usage.error&&usage.data?.length);assert(usage.data.every(row=>row.provider==='codex'&&row.model==='gpt-5.6-sol'));
 const folder=path.join(local.workspacePath,'sessions',run.legacySessionId),trace=JSON.parse(fs.readFileSync(path.join(folder,'logs/action-trace.json'),'utf8'));
 const saveClicks=trace.filter((entry:any)=>entry.action==='click'&&entry.dispatch==='locator').length;assert.equal(saveClicks,1);
 const budget=JSON.parse(fs.readFileSync(path.join(folder,'logs/execution-budget.json'),'utf8'));
 audit.samples.push({variant,repetition,runId:run.id,environmentId:result.environmentId,revisionId:revision,state:run.state,verdict:run.verdict,checks:run.checks.map((c:any)=>({id:c.checkId,verdict:c.verdict})),elapsedMs:Date.parse(run.updatedAt)-Date.parse(run.createdAt),saveClicks,proofs:{recorded:run.evidence.length,readerVerified:proofs},modelUsage:usage.data,budget});save();
}
assert.equal(findingIds.size,1);
const findingId=[...findingIds][0],detail=await req('/findings/'+findingId);assert.equal(detail.observations.length,3);
if(detail.finding.verification==='unreviewed')await req('/findings/'+findingId+'/review',{version:detail.finding.version,decision:'confirmed',severity:'low',priority:'low',confidence:'high',note:'QA representative-corpus simulation: the declared isolated no-op source and independently scripted persistence baseline match three retained failed checks. Planted benchmark observation; not stakeholder/production approval.'},b.data.session.access_token);
const finalFinding=await req('/findings/'+findingId);assert.equal(finalFinding.finding.verification,'confirmed');
const snapshot=await req('/runs/'+audit.samples.at(-1).runId+'/reports',{reportId:crypto.randomUUID()});assert.equal(snapshot.findings.length,1);assert.equal(snapshot.findings[0].observations.length,3);
const exports=[];for(const format of ['json','markdown','pdf']){const response=await fetch(base+'/reports/'+snapshot.metadata.reportId+'/'+format,{headers:{Authorization:'Bearer '+b.data.session.access_token}});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),response.headers.get('X-Centinel-SHA256'));exports.push({format,bytes:bytes.length,sha256:hash(bytes)});}
const root='/Users/kongjy/Documents/School/FYP/centinel-test-targets/rwa-dynamic-release-20261014';
assert.equal(hash(fs.readFileSync(root+'/backend/database.ts')),protocol.databaseSourceSha256);assert.equal(hash(fs.readFileSync(root+'/data/database.json')),protocol.databaseSha256);
assert.equal(hash(fs.readFileSync('/Users/kongjy/Documents/School/FYP/centinel-test-targets/cypress-realworld-app/data/database.json')),protocol.primarySha256);
assert.equal(hash(fs.readFileSync('/Users/kongjy/Documents/School/FYP/centinel-test-targets/rwa-unit-release-20261015/data/database.json')),protocol.unitSha256);
audit.findingId=findingId;audit.reportId=snapshot.metadata.reportId;audit.exports=exports;audit.normalPasses=3;audit.declaredDefectFailures=3;audit.functionalTaskCompletion={passed:3,attempted:6};audit.expectedOutcomeAgreement={correct:6,total:6};audit.finalSourceAndDataRestored=true;audit.finishedAt=new Date().toISOString();audit.complete=true;save();console.log(JSON.stringify({samples:6,findingId,reportId:audit.reportId,complete:true}));
