import { api, ApiError } from './src/api/client';
import { restoreSupabaseSession, subscribeToSupabaseAuth } from './src/auth/supabaseAuth';
if (!await restoreSupabaseSession()) throw Error('Sign in to Centinel before opening the evaluation page.');
subscribeToSupabaseAuth(() => undefined);
const recorder = 'http://localhost:37811';
const status = document.querySelector('#status')!;
let plan: any;
let stopRequested = false;
const checkStopped = () => { if (stopRequested) throw Error('Evaluation stopped; saved jobs and evidence retained.'); };
const log = (text: string) => { status.textContent += `\n${new Date().toISOString()} ${text}`; };
async function record(instanceId: string, kind: string, data: unknown) {
  const response = await fetch(`${recorder}/event`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({instanceId, kind, data}) });
  if (!response.ok) throw Error('Outcome recording failed; execution stopped.');
  plan.events.push({instanceId, kind, data});
}
const previous = (id: string, kind: string) => plan.events.filter((event: any) => event.instanceId === id && event.kind === kind).at(-1)?.data;
const capacity = (value: any) => /rate_limited|quota_exhausted|credits_exhausted|billing_required|provider_paused|assessment_paused|rate limit|quota|insufficient credits/i.test(JSON.stringify([value?.errorCode, value?.error, value?.failureReason, value?.progressJson]));
const delay = () => new Promise(resolve => setTimeout(resolve, 4000));
async function collect(item: any, projectId: string, reviewId?: string) {
  await record(item.instanceId, 'readiness-collected', await api.getProjectReadiness(projectId));
  if (!reviewId) return;
  let collectionFailed = false;
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['review-session', () => api.getStaticSession(projectId, reviewId)],
    ['review-findings', () => api.listStaticFindings(projectId, reviewId)],
    ['review-manifest', () => api.getReviewSourceManifest(projectId, reviewId)],
    ['review-traceability', () => api.getReviewTraceability(projectId, reviewId)],
    ['review-evidence', () => api.getReviewEvidenceSufficiency(projectId, reviewId)],
    ['review-harness', () => api.getReviewHarness(projectId, reviewId)],
  ];
  for (const [kind, call] of calls) {
    try { await record(item.instanceId, kind, await call()); }
    catch (error) {
      collectionFailed = true;
      await record(item.instanceId, `${kind}-error`, { message: error instanceof Error ? error.message : 'Collection failed' });
    }
  }
  if (collectionFailed) throw Error('Required Review evidence collection failed; saved results retained. Collect evidence before continuing later Reviews.');
}
async function createAll() {
  if (!plan.freeze) throw Error('Independent gold is not frozen.');
  for (const item of plan.projects) {
    let project = previous(item.instanceId, 'project-created');
    if (!project) {
      const created = await api.createProject(item.name, item.description, item.workspacePath, {type:'local-repository'});
      project = {id:created.id, name:created.name, workspacePath:created.workspacePath};
      await record(item.instanceId, 'project-created', project);
    }
    const artifacts = await api.listArtifacts(project.id);
    await record(item.instanceId, 'imported-artifacts', artifacts);
    log(`${item.repo}: project ${project.id}; imported ${artifacts.length}/${item.stagedFiles} staged files.`);
  }
}
async function runAll(manualCapacityResume = false) {
  stopRequested = false;
  if (!plan.freeze) throw Error('Independent gold is not frozen.');
  const currentProjects = await api.projects();
  for (const item of plan.projects) {
    checkStopped();
    const project = previous(item.instanceId, 'project-created');
    if (!project) throw Error('Create all projects first.');
    if (previous(item.instanceId, 'case-completed')) { log(`${item.repo}: saved case already completed; skipped.`); continue; }
    const currentProject = currentProjects.find(value => value.id === project.id);
    if (!currentProject || currentProject.description !== item.description || currentProject.name !== item.name) throw Error('Frozen project metadata changed; stop before assessment.');
    const artifactIdentity = (values: any[]) => JSON.stringify(values.map(value => [value.id,value.versionId ?? null,value.contentHash,value.filePath,value.type]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
    const currentArtifacts = await api.listArtifacts(project.id);
    if (artifactIdentity(currentArtifacts) !== artifactIdentity(previous(item.instanceId,'imported-artifacts') ?? [])) throw Error('Frozen imported artifact metadata changed; stop before assessment.');
    let ready = previous(item.instanceId, 'readiness-result');
    if (ready?.status === 'completed') {
      const observed = await api.getProjectReadiness(project.id);
      if (observed.status !== 'completed' || observed.stale || observed.snapshot?.id !== ready.snapshot?.id) throw Error('Readiness snapshot changed; verify and adjudicate it before reuse.');
      ready = observed;
      await record(item.instanceId,'frozen-inputs-verified',{artifactCount:currentArtifacts.length,metadataMatches:true,readinessSnapshotId:observed.snapshot?.id});
    }
    if (!ready) {
      log(`${item.repo}: ${previous(item.instanceId, 'readiness-started') ? 'observing saved' : 'starting'} Readiness.`);
      ready = previous(item.instanceId, 'readiness-started') ? await api.getProjectReadiness(project.id) : await api.startProjectReadiness(project.id);
      if (!previous(item.instanceId, 'readiness-started')) await record(item.instanceId, 'readiness-started', ready);
    }
    const readinessDeadline = Date.now() + 1200000;
    let lastReadinessProgress = 0;
    while (['queued','running'].includes(ready.status) && Date.now() < readinessDeadline) {
      if (Date.now()-lastReadinessProgress>60000) {
        lastReadinessProgress=Date.now();
        await record(item.instanceId,'readiness-progress',{requestId:ready.requestId,status:ready.status,startedAt:ready.startedAt,errorCode:ready.errorCode});
        log(`${item.repo}: Readiness ${ready.status}; request ${ready.requestId}.`);
      }
      await delay(); ready = await api.getProjectReadiness(project.id);
    }
    await record(item.instanceId, 'readiness-result', ready);
    checkStopped();
    log(`${item.repo}: Readiness ${ready.status}${ready.errorCode ? ` (${ready.errorCode})` : ''}.`);
    if (capacity(ready)) throw Error('Assessment stopped at provider/configuration pause. No automatic retry or fallback.');
    if (['queued','running'].includes(ready.status)) throw Error('Readiness observation deadline reached; saved job retained.');
    if (ready.status !== 'completed' || ready.stale) {
      await record(item.instanceId, 'readiness-usage-diagnostics', await api.getAiUsage({projectId:project.id,scope:'text',callKind:'review'}));
      throw Error('Readiness did not complete on current frozen sources; assessment stopped.');
    }
  }
  log('Readiness phase finished for all five projects. Starting Review phase.');
  for (const item of plan.projects) {
    checkStopped();
    const project = previous(item.instanceId, 'project-created');
    if (!project) throw Error('Create all projects first.');
    if (previous(item.instanceId, 'case-completed')) { log(`${item.repo}: saved case already completed; skipped.`); continue; }
    const ready = previous(item.instanceId, 'readiness-result');
    if (ready?.status !== 'completed' || ready.stale) throw Error('Complete current Readiness before starting Review.');
    let review = previous(item.instanceId, 'review-created');
    if (!review && previous(item.instanceId, 'retry-parent')) {
      const parent = previous(item.instanceId, 'retry-parent');
      const child = await api.retryStaticSession(project.id, parent.id, {refreshSourceManifest:false,idempotencyKey:`batch-domain-v9-${item.instanceId}-${parent.id}`});
      review = {id:child.id}; await record(item.instanceId,'review-created',review);
    }
    if (!review) {
      const artifacts = await api.listArtifacts(project.id);
      const session = await api.createStaticSession(project.id, {
        name: 'Pinned public source outcome assessment', reviewMode:'regular',
        instructions:'Assess all supplied frozen source artifacts across security, technical correctness, business behavior, and personnel/maintainability. Identify concrete supported defects and document gaps using exact source locations and public causal explanations. Use only supplied evidence; keep unsupported conclusions unverified. This is a bounded source sample, not whole-system assurance.',
        artifactIds: artifacts.map(artifact => artifact.id), selectedArtifactIds: artifacts.map(artifact => artifact.id),
        requirementIds:[], standardIds:[], idempotencyKey:`public-outcomes-2026-10-24-v9-${item.instanceId}`,
      });
      review = {id:session.id}; await record(item.instanceId, 'review-created', review);
    }
    log(`${item.repo}: Review ${review.id} started.`);
    let session = await api.getStaticSession(project.id, review.id);
    if (manualCapacityResume && session.status === 'blocked' && capacity(session)) {
      await record(item.instanceId, 'manual-capacity-resume', {parentReviewId:review.id, authorization:'User explicitly resumed after capacity restoration on 25 October 2026.'});
      const child = await api.retryStaticSession(project.id, review.id, {refreshSourceManifest:false,idempotencyKey:`manual-capacity-2026-10-25-${item.instanceId}-${review.id}`});
      review = {id:child.id};
      await record(item.instanceId, 'review-created', review);
      session = await api.getStaticSession(project.id, review.id);
      log(`${item.repo}: linked manual retry ${review.id} started; historical paused Review retained.`);
    }
    const reviewDeadline = Date.now() + 10800000;
    let lastProgress = 0;
    while (['pending','queued','running','in_progress'].includes(session.status) && Date.now() < reviewDeadline) {
      await delay(); session = await api.getStaticSession(project.id, review.id);
      if (Date.now()-lastProgress>60000) {
        lastProgress=Date.now(); const usage=await api.getReviewModelUsage(project.id,review.id);
        await record(item.instanceId,'review-progress',{id:review.id,status:session.status,progressJson:session.progressJson,usage});
        log(item.repo+': '+session.status+'; '+usage.totals.calls+' paid request records.');
      }
    }
    await record(item.instanceId, 'review-result', session);
    await collect(item, project.id, review.id);
    checkStopped();
    log(`${item.repo}: Review ${session.status}.`);
    if (capacity(session)) throw Error('Assessment stopped at provider pause. No automatic retry or fallback.');
    if (['pending','queued','running','in_progress'].includes(session.status)) throw Error('Review observation deadline reached; saved job retained.');
    if (!['success','pending_approval','completed','approved'].includes(session.status) || session.modelStatus !== 'succeeded') throw Error('Review validation did not complete successfully; mitigate before running later Reviews.');
    await record(item.instanceId, 'case-completed', {projectId:project.id, reviewId:review.id, readiness:ready.status, review:session.status});
    if (new URLSearchParams(location.search).get('pauseAfterReview') === '1') {
      await record(item.instanceId,'evaluation-checkpoint',{reviewId:review.id,reason:'Completed Review retained; pause before subsequent workflows for verified reader restart.'});
      log('Current Review and evidence saved. Evaluation paused before later Reviews for the reader restart.');
      return;
    }
  }
}
async function action(run: () => Promise<void>) {
  document.querySelectorAll<HTMLButtonElement>('button:not(#stop)').forEach(button => button.disabled = true);
  try { await run(); log('Requested step finished.'); }
  catch (error) {
    const code = error instanceof ApiError && ['request_timeout','unauthenticated','forbidden'].includes(error.code ?? '') ? error.code : 'observer_stopped';
    try { await record('evaluation-observer','observer-stopped',{code,httpStatus:error instanceof ApiError ? error.status : null}); } catch { /* The visible stop remains available if the recorder is unavailable. */ }
    log(`STOPPED: ${error instanceof Error ? error.message : 'Unknown failure'}`);
  }
  finally { document.querySelectorAll('button').forEach(button => button.disabled = false); }
}
plan = await (await fetch(`${recorder}/plan`)).json();
status.textContent = `Gold frozen: ${plan.freeze ? plan.freeze.sha256 : 'NO'}\nEvidence: ${plan.runDirectory}\n${plan.projects.map((item:any) => `${item.repo} · ${item.revision} · ${item.stagedFiles} staged files`).join('\n')}`;
document.querySelector('#create')!.addEventListener('click', () => void action(createAll));
document.querySelector('#run')!.addEventListener('click', () => void action(runAll));

const resumeButton = document.createElement('button');
resumeButton.textContent = 'Resume capacity-paused Reviews';
document.querySelector('main')!.insertBefore(resumeButton, status);
resumeButton.addEventListener('click', () => void action(() => runAll(true)));
document.querySelector('#collect')!.addEventListener('click', () => void action(async () => {
  for (const item of plan.projects) { const project = previous(item.instanceId,'project-created'); if(project) await collect(item, project.id, previous(item.instanceId,'review-created')?.id); }
}));

const diagnosticsButton = document.createElement('button');
diagnosticsButton.textContent = 'Collect assessment diagnostics';
document.querySelector('main')!.insertBefore(diagnosticsButton, status);
diagnosticsButton.addEventListener('click', () => void action(async () => {
  for (const item of plan.projects) {
    const project = previous(item.instanceId,'project-created');
    if (!project) continue;
    const usage = await api.getAiUsage({projectId:project.id,scope:'text',callKind:'review'});
    await record(item.instanceId,'readiness-usage-diagnostics',usage);
    log(`${item.repo}: saved ${usage.recent.length} recent safe usage records.`);
  }
}));

const reviewUsageButton = document.createElement('button');
reviewUsageButton.textContent = 'Collect Review usage across all scopes';
document.querySelector('main')!.insertBefore(reviewUsageButton, status);
reviewUsageButton.addEventListener('click', () => void action(async () => {
  const seen = new Set<string>();
  for (const event of [...plan.events].filter((event: any) => event.kind === 'review-created')) {
    if (seen.has(event.data.id)) continue;
    seen.add(event.data.id);
    const project = previous(event.instanceId, 'project-created');
    if (!project) throw Error('Saved Review project is unavailable.');
    const usage = await api.getAiUsage({projectId:project.id,sessionId:event.data.id,callKind:'review'});
    await record(event.instanceId,'review-usage-all-scopes',{reviewId:event.data.id,usage});
    log(`${event.instanceId}: Review ${event.data.id}; ${usage.totals.calls} usage records across all scopes collected.`);
  }
}));

const probeButton = document.createElement('button');
probeButton.textContent = 'Verify saved projects and loading';
document.querySelector('main')!.insertBefore(probeButton, status);
probeButton.addEventListener('click', () => void action(async () => {
  const measurements: Array<{path:string;status:number;durationMs:number;responseBytes:number}> = [];
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const started = performance.now();
    const response = await originalFetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.port === '37701') {
      const bytes = new TextEncoder().encode(await response.clone().text()).byteLength;
      measurements.push({path:url.pathname+url.search,status:response.status,durationMs:Math.round(performance.now()-started),responseBytes:bytes});
    }
    return response;
  };
  try {
    const rounds = [];
    let projects = await api.projects();
    for (let round=0;round<2;round++) {
      const started=performance.now();
      if(round) projects=await api.projects();
      const selected=projects.filter(project=>plan.projects.some((item:any)=>previous(item.instanceId,'project-created')?.id===project.id));
      let index=0;
      await Promise.all(Array.from({length:4},async()=>{
        while(index<selected.length){const project=selected[index++];await Promise.all([api.getSourcePresence(project.id),api.listStaticSessions(project.id,{summary:true}),api.listDynamicSessions(project.id)]);}
      }));
      rounds.push({round:round+1,selectedProjects:selected.length,enrichmentMs:Math.round(performance.now()-started)});
    }
    const imported=projects.find(project=>project.name==='GitHub import acceptance · Hello-World');
    const sources=imported ? await api.listConnectedSources(imported.id) : [];
    const result={rounds,measurements,projectMetadataCount:projects.length,contentRequests:measurements.filter(item=>/\/content(?:\?|$)/.test(item.path)).length,
      githubImport:imported ? {projectId:imported.id,sources:sources.map(source=>({id:source.id,name:source.name,status:source.syncStatus,run:source.latestSyncRun}))} : null};
    await record('acceptance-followup','acceptance-probe',result);
    log(JSON.stringify(result,null,2));
  } finally {window.fetch=originalFetch;}
}));

const stopButton=document.querySelector('#stop');
stopButton?.addEventListener('click',()=>void (async()=>{
 stopRequested=true;
 const latest=plan.events.filter((event:any)=>event.kind==='review-created').at(-1);
 if(!latest) { log('Stop requested; no subsequent workflow will start.'); return; }
 const project=previous(latest.instanceId,'project-created');
 try {
   const session=await api.getStaticSession(project.id,latest.data.id);
   if(['pending','queued','running','in_progress'].includes(session.status)) await api.cancelStaticSession(project.id,latest.data.id);
   await record(latest.instanceId,'evaluation-suspended',{reviewId:latest.data.id,reason:'Explicit local evaluation stop; retain all saved outcomes.'});
   log('Stop requested; active Review canceled and no subsequent workflow will start.');
 } catch(error) {log(`Stop requested: ${error instanceof Error ? error.message : 'cancel failed'}`);}
})());
