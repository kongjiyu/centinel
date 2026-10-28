import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Read saved application evidence only; no provider, authentication or upstream execution.
const root = path.resolve('evidence/public-repo-outcomes-2026-10-22');
const run = fs.readFileSync(path.join(root, 'active-mitigation-run.txt'), 'utf8').trim();
const out = path.resolve('docs/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24');
const events = fs.readdirSync(run).filter(file => /^\d{4}-.+\.json$/.test(file)).sort()
  .map(file => ({file, ...JSON.parse(fs.readFileSync(path.join(run, file), 'utf8'))}));
const files = ['0055-review-harness.json', '0092-review-harness.json', '0107-review-harness.json', '0169-review-harness.json'];
const sum = rows => rows.reduce((a, row) => ({
  calls:a.calls+1, input:a.input+(row.detail.inputTokens??0), output:a.output+(row.detail.outputTokens??0),
  total:a.total+(row.detail.inputTokens??0)+(row.detail.outputTokens??0),
  unreported:a.unreported+Number(row.detail.inputTokens==null||row.detail.outputTokens==null),
}), {calls:0,input:0,output:0,total:0,unreported:0});
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(run,file))).digest('hex');
const rows = files.map(file => {
  const saved = events.find(event => event.file === file);
  assert.ok(saved, 'Expected saved harness');
  const h = saved.data;
  const usageEvent = events.filter(event => event.kind==='review-usage-all-scopes' && event.data.reviewId===h.review.id).at(-1);
  assert.ok(usageEvent, 'Fresh all-scope usage evidence required');
  const usage = usageEvent.data.usage;
  const attempts = h.events.filter(event=>event.event==='model_attempt');
  assert.equal(new Set(attempts.map(event=>event.id)).size,attempts.length);
  assert.ok(attempts.every(event=>event.stage.startsWith('model_analysis')));
  const total = sum(attempts);
  assert.equal(total.calls,usage.totals.calls);
  assert.equal(total.input,usage.totals.input);
  assert.equal(total.output,usage.totals.output);
  assert.equal(usage.totals.cacheRead,0);
  assert.equal(usage.totals.cacheCreation,0);
  assert.ok(usage.byGroup.every(group=>group.provider==='codex' && group.model==='gpt-5.6-sol'));
  const starts = new Map(h.events.filter(event=>event.event==='harness_step_started' && event.detail.step==='read_source')
    .map(event=>[event.detail.executionId,event]));
  const completed = h.events.filter(event=>event.event==='harness_step_completed' && event.detail.step==='read_source');
  const artifacts = events.filter(event=>event.instanceId===saved.instanceId && event.kind==='imported-artifacts').at(-1).data;
  const artifactById = new Map(artifacts.map(artifact=>[artifact.id,artifact]));
  const readIds = new Set();
  const fileReads = completed.map(event=>{
    assert.equal(event.detail.output.hashChecked,true);
    const start = starts.get(event.detail.executionId);
    assert.ok(start, 'A completed read must have a matching start');
    const artifact = artifactById.get(start.detail.input.artifactId);
    assert.ok(artifact);
    readIds.add(artifact.id);
    return {artifactId:artifact.id,filePath:artifact.filePath,stage:event.stage,
      characters:event.detail.output.characters,lines:event.detail.output.lines,hashChecked:true};
  });
  assert.equal(starts.size,completed.length);
  assert.equal(readIds.size,artifacts.length);
  assert.equal(completed.length,readIds.size);
  const packets = h.events.filter(event=>event.event==='harness_step_started' && event.detail.step==='build_request');
  const batchStage = packets.map(packet=>{
    const id=packet.detail.input.batchId;
    const related=attempts.filter(attempt=>attempt.stage===`model_analysis:${id}` || attempt.stage===`model_analysis${id}`);
    assert.ok(related.length);
    return {batchId:id,featureCount:packet.detail.input.features,filesInPacket:packet.detail.input.artifactCount,
      ...sum(related),attempts:related.map(event=>({number:event.detail.attempt,outcome:event.detail.outcome,
        input:event.detail.inputTokens??null,output:event.detail.outputTokens??null}))};
  });
  assert.equal(batchStage.reduce((n,batch)=>n+batch.calls,0),attempts.length);
  const label = saved.instanceId.startsWith('axios')?'Axios':saved.instanceId.startsWith('facebook')?'Docusaurus'
    :file==='0107-review-harness.json'?'Immutable.js — earlier paused attempt':'Immutable.js — current paused retry';
  const initial=sum(attempts.filter(event=>event.detail.attempt===1));
  const repair=sum(attempts.filter(event=>event.detail.attempt>1));
  for(const followup of attempts.filter(event=>event.detail.attempt>1)) {
    assert.ok(attempts.some(previous=>previous.stage===followup.stage && previous.detail.attempt===followup.detail.attempt-1
      && previous.detail.outcome==='malformed_response'), 'Follow-up must be a recorded validation repair');
  }
  return {label,reviewId:h.review.id,status:h.review.status,modelStatus:h.review.modelStatus,
    sources:{uniqueFiles:readIds.size,codeFiles:fileReads.filter(file=>/\.[cm]?[jt]sx?$/.test(file.filePath)).length,
      verifiedReadOperations:completed.length,characters:fileReads.reduce((n,file)=>n+file.characters,0),files:fileReads},
    total,initial,repair,
    validationRejectedCalls:sum(attempts.filter(event=>event.detail.outcome==='malformed_response')),
    pipelineStages:{freezing_sources:0,indexing_context:0,deterministic_analysis:0,
      model_analysis:total.total,persisting_evidence:h.review.modelStatus==='succeeded'?0:null},
    batches:batchStage,plannedPacketsBuilt:packets.length,
    fileInclusionsAcrossBuiltPackets:packets.reduce((n,packet)=>n+packet.detail.input.artifactCount,0),
    evidence:[{file,sha256:hash(file)},{file:usageEvent.file,sha256:hash(usageEvent.file)}]};
});
const data={generatedAt:new Date().toISOString(),runDirectory:run,provider:'codex',model:'gpt-5.6-sol',reviews:rows,
  caveats:[
    'Recorded input plus output, not an independent billing invoice. Quota-failed calls without usage are unknown, not proven free.',
    'Readiness, older runs not listed here, coding-chat and adjudication-agent consumption are excluded.',
    'First-pass calls include failed validation responses. Repair is additional attempt>1 usage; failed-response waste is reported separately.',
    'Four domains share requests; no exact security/business/technical/personnel token allocation exists.',
    'Files read are unique hash-checked frozen reads. Reuse across batches increases prompt tokens without another physical read.',
    'All-scope ledger totals and record counts exactly reconcile with the model_analysis attempt events; no separate embedding/indexing usage is recorded.',
    'Final persistence/correlation was not reached on the two paused Immutable.js executions; partial retention is separate.',
  ]};
const fmt=n=>n.toLocaleString('en-US');
let md='# Recorded Review tokens and file reads — 25 October 2026\n\n';
md+='Fresh authenticated all-scope usage reads reconcile exactly with saved harness attempt counts and input/output totals. No new assessments or provider calls were made to prepare this report.\n\n';
md+='| Review execution | Status | Unique files read (JS/TS) | Calls | Input | Output | Total |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n';
for(const row of rows)md+=`| ${row.label} | ${row.status} | ${row.sources.uniqueFiles} (${row.sources.codeFiles}) | ${row.total.calls} | ${fmt(row.total.input)} | ${fmt(row.total.output)} | ${fmt(row.total.total)} |\n`;
md+='\nAll read counts require a matched read-start/read-completion event, a known artifact ID, and `hashChecked:true`. Each file was read once per execution and reused from the frozen read pool.\n\n';
md+='## Recorded pipeline stage totals\n\n';
md+='| Review execution | Read/freeze | Index/retrieve | Static rules | First-pass AI | Additional repair AI | Final persistence/correlation |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |\n';
for(const row of rows)md+=`| ${row.label} | 0 | 0 | 0 | ${fmt(row.initial.total)} | ${fmt(row.repair.total)} | ${row.pipelineStages.persisting_evidence===null?'Not reached':'0'} |\n`;
md+='\nFirst-pass and repair calls are subdivisions of the persisted `model_analysis` stage. They are calculated from attempt numbers, not separate domain estimates. Initial totals include responses that later failed validation. Separately, validation-rejected response tokens were '+rows.map(row=>`${row.label}: ${fmt(row.validationRejectedCalls.total)}`).join('; ')+'. Do not add those rejected-response totals again: they are already included above.\n\n';
md+='## Limits\n\n'+data.caveats.map(value=>'- '+value).join('\n')+'\n\n';
for(const row of rows){
 md+=`## ${row.label}: batch details\n\nReview ID: \`${row.reviewId}\`. Built ${row.plannedPacketsBuilt} source packets with ${row.fileInclusionsAcrossBuiltPackets} total file inclusions across those packets. Repeated inclusions are not additional unique reads. Counts omit repeated packet exposure from repair calls.\n\n`;
 md+='| Batch ID | Features | Files in packet | Calls | Input | Output | Total |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n';
 for(const batch of row.batches)md+=`| \`${batch.batchId}\` | ${batch.featureCount} | ${batch.filesInPacket} | ${batch.calls} | ${fmt(batch.input)} | ${fmt(batch.output)} | ${fmt(batch.total)} |\n`;
 md+='\nEvidence: '+row.evidence.map(e=>`\`${e.file}\` (SHA-256 \`${e.sha256}\`)`).join('; ')+'.\n\n';
}
fs.writeFileSync(path.join(out,'TOKEN_USAGE_BY_STAGE_2026-10-25.json'),JSON.stringify(data,null,2));
fs.writeFileSync(path.join(out,'TOKEN_USAGE_BY_STAGE_2026-10-25.md'),md);
console.log(JSON.stringify(rows.map(({label,sources,total,initial,repair})=>({label,filesRead:sources.uniqueFiles,codeFiles:sources.codeFiles,total,firstPass:initial.total,repair:repair.total})),null,2));
