-- Extend usability lineage and source uniqueness; preserve existing payloads/history.
begin;
alter table public.dynamic_finding_observations add column if not exists source text not null default 'dynamic_checker';
alter table public.dynamic_finding_observations drop constraint if exists dynamic_finding_observations_run_id_check_id_key;
create unique index if not exists dynamic_finding_observations_run_source_check on public.dynamic_finding_observations(run_id,source,check_id);
create or replace function public.transition_dynamic_run(p_project_id uuid,p_run_id uuid,p_expected text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;a jsonb;cfg jsonb;row jsonb;ref jsonb;proof_id text;keys text[]:='{}';identities text[]:='{}';identity_key text;observation_key text;rule jsonb;
begin
 -- Existing transition holds the row lock and checks actor, live lease and state.
 result:=public.transition_dynamic_run_without_usability(p_project_id,p_run_id,p_expected,p_patch);
 if result is null then return null;end if;
 if result->>'state'<>'completed' then
  if p_patch ? 'usability' then raise exception 'Only terminal verification can retain usability results';end if;return result;
 end if;
 cfg:=result->'revision'->'usability';a:=p_patch->'usability';
 if cfg is null then if a is not null then raise exception 'Unselected usability results';end if;return result;end if;
 if jsonb_typeof(a) is distinct from 'object' or a->'schemaVersion' is distinct from '1'::jsonb or a->'config' is distinct from cfg or octet_length(a::text)>400000 then raise exception 'Frozen bounded usability assessment required';end if;
 if exists(select 1 from jsonb_object_keys(a) k where k not in ('schemaVersion','config','observations','limitations','keyboardActions','assessedAt','suggestions')) then raise exception 'Unsupported assessment field';end if;
 if jsonb_typeof(a->'observations') is distinct from 'array' or jsonb_typeof(a->'limitations') is distinct from 'array' or jsonb_typeof(a->'keyboardActions') is distinct from 'number' or jsonb_typeof(a->'assessedAt') is distinct from 'string' then raise exception 'Assessment fields required';end if;
 if jsonb_array_length(a->'observations')>160 or jsonb_array_length(a->'limitations') not between 1 and 10 or (a->>'keyboardActions')::numeric not between 0 and 42 or (a->>'keyboardActions')::numeric<>trunc((a->>'keyboardActions')::numeric) or length(a->>'assessedAt')>50 then raise exception 'Assessment bounds exceeded';end if;
 if not isfinite((a->>'assessedAt')::timestamptz) then raise exception 'Finite assessment timestamp required';end if;
 if jsonb_typeof(result->'evidence') is distinct from 'array' then raise exception 'Assessment evidence required';end if;
 if (select count(*) from jsonb_array_elements(result->'evidence') e where e->>'kind'='usability')<>1 then raise exception 'Unique assessment proof required';end if;
 select e->>'id' into proof_id from jsonb_array_elements(result->'evidence') e where e->>'kind'='usability' and e->>'sha256'~'^[a-f0-9]{64}$';
 if proof_id is null then raise exception 'Assessment checksum required';end if;
 for row in select value from jsonb_array_elements(a->'observations') loop
  if jsonb_typeof(row) is distinct from 'object' then raise exception 'Observation object required';end if;
  if exists(select 1 from jsonb_object_keys(row) k where k not in ('ruleId','persona','kind','verdict','expected','observed','controlRef','controlKey','checkId','evidenceIds')) or not coalesce((cfg->'rules') ? (row->>'ruleId'),false) or row->'persona' is distinct from cfg->'persona' or row->>'kind' is distinct from 'deterministic' or coalesce(row->>'verdict','') not in ('passed','failed','uncertain','not_tested') then raise exception 'Observation must match selected rule/persona';end if;
  if not coalesce(public.dynamic_context_text(row->'expected',2000),false) or not coalesce(public.dynamic_context_text(row->'observed',2000),false) then raise exception 'Bounded observation text required';end if;
  if row ? 'controlRef' and (jsonb_typeof(row->'controlRef') is distinct from 'string' or row->>'controlRef'!~'^u([0-9]|[1-3][0-9])$') then raise exception 'Invalid sampled control';end if;
  if row ? 'controlKey' and (not row ? 'controlRef' or jsonb_typeof(row->'controlKey') is distinct from 'string' or row->>'controlKey'!~'^[a-f0-9]{64}$') then raise exception 'Invalid stable control key';end if;
  if row ? 'controlKey' then identity_key:=jsonb_build_array(row->>'ruleId',row->>'controlKey')::text;if identity_key=any(identities) then raise exception 'Ambiguous stable identity';end if;identities:=array_append(identities,identity_key);end if;
  if row ? 'checkId' and (jsonb_typeof(row->'checkId') is distinct from 'string' or not coalesce((case row->>'ruleId' when 'feedback' then cfg->'feedbackCheckIds' when 'error_recovery' then cfg->'errorRecoveryCheckIds' else '[]'::jsonb end) ? (row->>'checkId'),false)) then raise exception 'Invalid criterion reference';end if;
  observation_key:=jsonb_build_array(row->>'ruleId',row->>'controlRef',row->>'checkId')::text;if observation_key=any(keys) then raise exception 'Duplicate rule observation';end if;keys:=array_append(keys,observation_key);
  if jsonb_typeof(row->'evidenceIds') is distinct from 'array' then raise exception 'Observation proof references required';end if;
  if not (row->'evidenceIds') ? proof_id or jsonb_array_length(row->'evidenceIds')>20 or (select count(distinct value) from jsonb_array_elements(row->'evidenceIds'))<>jsonb_array_length(row->'evidenceIds') then raise exception 'Unique assessment evidence required';end if;
  for ref in select value from jsonb_array_elements(row->'evidenceIds') loop
   if jsonb_typeof(ref) is distinct from 'string' or (select count(*) from jsonb_array_elements(result->'evidence') e where e->'id'=ref and e->>'sha256'~'^[a-f0-9]{64}$')<>1 then raise exception 'Dangling or ambiguous assessment evidence';end if;
  end loop;
 end loop;
 for rule in select value from jsonb_array_elements(cfg->'rules') loop
  if not exists(select 1 from jsonb_array_elements(a->'observations') o where o->'ruleId'=rule) then raise exception 'Selected rule result missing';end if;
 end loop;
 for row in select value from jsonb_array_elements(a->'limitations') loop if not coalesce(public.dynamic_context_text(row,2000),false) then raise exception 'Assessment limitations required';end if;end loop;
 if cfg->'includeSuggestions'='true'::jsonb then perform public.validate_dynamic_usability_suggestions(a);elsif a ? 'suggestions' then raise exception 'Model suggestions were not selected';end if;
 result:=result||jsonb_build_object('usability',a);
 update public.dynamic_runs set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.transition_dynamic_run(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.transition_dynamic_run(uuid,uuid,text,jsonb) to authenticated;



do $$begin
 if to_regprocedure('public.collect_dynamic_functional_findings(uuid,uuid)') is null then alter function public.collect_dynamic_findings(uuid,uuid) rename to collect_dynamic_functional_findings;end if;
end $$;
revoke all on function public.collect_dynamic_functional_findings(uuid,uuid) from public,anon,authenticated;
create or replace function public.collect_dynamic_functional_findings(p_project_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;c jsonb;d jsonb;f public.dynamic_findings%rowtype;k text;oid uuid;stamp timestamptz:=clock_timestamp();refs jsonb;result jsonb:='[]';n integer;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'state' is distinct from 'completed' then raise exception 'Only completed independent checks can produce candidates';end if;
 if jsonb_typeof(r->'checks') is distinct from 'array' or jsonb_typeof(r->'revision'->'checks') is distinct from 'array' or jsonb_typeof(r->'evidence') is distinct from 'array' then raise exception 'Completed independent check records required';end if;
 for c in select value from jsonb_array_elements(r->'checks') loop
  if c->>'verdict' is distinct from 'failed' then continue;end if;
  select value into d from jsonb_array_elements(r->'revision'->'checks') where value->>'id'=c->>'checkId' and value->>'criterionId'=c->>'criterionId';
  if d is null or jsonb_typeof(c->'evidenceIds') is distinct from 'array' then continue;end if;
  if jsonb_array_length(c->'evidenceIds')=0 then continue;end if;
  select coalesce(jsonb_agg(e.value),'[]') into refs from jsonb_array_elements(r->'evidence') e where c->'evidenceIds' ? (e.value->>'id') and e.value->>'sha256' ~ '^[a-f0-9]{64}$';
  if jsonb_array_length(refs)<>jsonb_array_length(c->'evidenceIds') or exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') ref where (select count(*) from jsonb_array_elements(refs) e where e->>'id'=ref)<>1) or (select count(*) from jsonb_array_elements(r->'checks') duplicate where duplicate->>'checkId'=c->>'checkId')<>1 then continue;end if;
  k:=encode(sha256(convert_to(jsonb_build_array(r->>'missionId',c->>'checkId',c->>'criterionId',coalesce(r->'environment'->>'targetUrl',r->'revision'->>'targetUrl'))::text,'UTF8')),'hex');
  select * into f from public.dynamic_findings where project_id=p_project_id and finding_key=k for update;
  if f.id is null then
   f.id:=gen_random_uuid();f.project_id:=p_project_id;f.finding_key:=k;f.version:=1;
   f.payload:=jsonb_build_object('id',f.id,'projectId',p_project_id,'missionId',r->>'missionId','key',k,'version',1,'source','dynamic_checker','title',d->>'description','category','functional','verification','unreviewed','remediation','open','severity',null,'priority',null,'confidence',null,'confidenceBasis','Independent check failed; application defect and triage require human verification.','observationCount',0,'createdAt',stamp,'updatedAt',stamp);
   insert into public.dynamic_findings(id,project_id,finding_key,version,payload,created_at,updated_at) values(f.id,p_project_id,k,1,f.payload,stamp,stamp);
  end if;
  oid:=gen_random_uuid();
  insert into public.dynamic_finding_observations(id,project_id,finding_id,run_id,check_id,payload,created_at)
   values(oid,p_project_id,f.id,p_run_id,c->>'checkId',jsonb_build_object('id',oid,'findingId',f.id,'projectId',p_project_id,'runId',p_run_id,'revisionId',r->'revision'->>'id','executorId',r->>'createdBy','checkId',c->>'checkId','criterionId',c->>'criterionId','definition',d,'result',c,'evidence',refs,'targetUrl',coalesce(r->'environment'->>'targetUrl',r->'revision'->>'targetUrl'),'targetVersion',r->'environment'->'targetVersion','goal',r->'revision'->>'goal','createdAt',stamp),stamp)
   on conflict(run_id,source,check_id) do nothing;
  get diagnostics n=row_count;
  if n=1 then
   f.version:=f.version+case when (f.payload->>'observationCount')::integer=0 then 0 else 1 end;
   f.payload:=f.payload||jsonb_build_object('version',f.version,'observationCount',(f.payload->>'observationCount')::integer+1,'updatedAt',stamp);
   -- A new failure after resolution is visible as an open recurrence. Prior
   -- decisions remain immutable; current verification requires investigation.
   if f.payload->>'remediation'='resolved' then
    oid:=gen_random_uuid();insert into public.dynamic_finding_events(id,project_id,finding_id,payload,created_at) values(oid,p_project_id,f.id,jsonb_build_object('id',oid,'findingId',f.id,'projectId',p_project_id,'actorId',auth.uid(),'version',f.version,'kind','recurrence','automatic',true,'remediation','open','regressionRunId',null,'note','A new failed independent observation reopened the resolved finding; review the retained Run.','createdAt',stamp),stamp);
    f.payload:=f.payload||jsonb_build_object('remediation','open','verification','needs_investigation','confidence',null,'confidenceBasis','A new independent failure after resolution requires human verification.');
   end if;
   update public.dynamic_findings set version=f.version,payload=f.payload,updated_at=stamp where id=f.id;
  end if;
  result:=result||jsonb_build_array(f.payload);
 end loop;
 return result;
end $$;

revoke all on function public.collect_dynamic_functional_findings(uuid,uuid) from public,anon,authenticated;
create or replace function public.collect_dynamic_findings(p_project_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;r jsonb;a jsonb;c jsonb;refs jsonb;f public.dynamic_findings%rowtype;k text;check_key text;identity text;correlation text;oid uuid;stamp timestamptz:=clock_timestamp();n integer;idx integer;definition jsonb;observation jsonb;hints jsonb;
begin
 result:=public.collect_dynamic_functional_findings(p_project_id,p_run_id);
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 a:=r->'usability';if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'observations') is distinct from 'array' then return result;end if;
 if a->'config' is distinct from r->'revision'->'usability' then raise exception 'Frozen usability results required';end if;
 for c,idx in select value,(ordinality-1)::integer from jsonb_array_elements(a->'observations') with ordinality loop
  if c->>'kind' is distinct from 'deterministic' or c->>'verdict' is distinct from 'failed' or not coalesce((a->'config'->'rules') ? (c->>'ruleId'),false) or c->'persona' is distinct from a->'config'->'persona' or jsonb_typeof(c->'evidenceIds') is distinct from 'array' then continue;end if;
  if jsonb_array_length(c->'evidenceIds')=0 then continue;end if;
  select coalesce(jsonb_agg(e),'[]') into refs from jsonb_array_elements(r->'evidence') e where (c->'evidenceIds') ? (e->>'id') and e->>'sha256'~'^[a-f0-9]{64}$';
  if jsonb_array_length(refs)<>jsonb_array_length(c->'evidenceIds') or not exists(select 1 from jsonb_array_elements(refs) e where e->>'kind'='usability') or exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') supplied where (select count(*) from jsonb_array_elements(refs) e where e->>'id'=supplied)<>1) then continue;end if;
  if c->>'controlKey'~'^[a-f0-9]{64}$' then identity:=c->>'controlKey';correlation:='stable_control';
  elsif c->>'checkId' is not null then identity:=c->>'checkId';correlation:='explicit_check';
  else identity:=p_run_id::text||':'||idx::text;correlation:='run_only';end if;
  check_key:='usability:'||encode(sha256(convert_to(jsonb_build_array(c->>'ruleId',c->>'persona',correlation,identity)::text,'UTF8')),'hex');
  k:=encode(sha256(convert_to(jsonb_build_array('usability',r->>'missionId',check_key,coalesce(r->'environment'->>'targetUrl',r->'revision'->>'targetUrl'))::text,'UTF8')),'hex');
  select * into f from public.dynamic_findings where project_id=p_project_id and finding_key=k for update;
  if f.id is null then
   f.id:=gen_random_uuid();f.project_id:=p_project_id;f.finding_key:=k;f.version:=1;
   f.payload:=jsonb_build_object('id',f.id,'projectId',p_project_id,'missionId',r->>'missionId','key',k,'version',1,'source','dynamic_usability','title','Usability: '||(c->>'ruleId')||' · '||case correlation when 'stable_control' then 'control '||left(identity,8) when 'explicit_check' then 'check '||identity else 'Run '||left(p_run_id::text,8)||' · '||coalesce(c->>'controlRef','sampled rule') end,'category','usability','verification','unreviewed','remediation','open','severity',null,'priority',null,'confidence',null,'confidenceBasis','A bounded deterministic usability rule failed. Product impact and triage require human investigation; subjective suggestions are not confirmation.','observationCount',0,'createdAt',stamp,'updatedAt',stamp);
   insert into public.dynamic_findings(id,project_id,finding_key,version,payload,created_at,updated_at) values(f.id,p_project_id,k,1,f.payload,stamp,stamp);
  end if;
  definition:=jsonb_build_object('id',check_key,'criterionId',c->>'ruleId','description',f.payload->>'title','required',false,'kind','visible_text','expected',c->>'expected');
  observation:=jsonb_build_object('checkId',check_key,'criterionId',c->>'ruleId','verdict','failed','observed',c->>'observed','reason','Recorded bounded usability rule failure; human review required.','evidenceIds',c->'evidenceIds','checkedAt',a->'assessedAt');
  select coalesce(jsonb_agg(h),'[]') into hints from jsonb_array_elements(coalesce(a->'suggestions'->'items','[]')) h where (h->'observationIndexes') @> jsonb_build_array(idx);
  oid:=gen_random_uuid();
  insert into public.dynamic_finding_observations(id,project_id,finding_id,run_id,check_id,source,payload,created_at) values(oid,p_project_id,f.id,p_run_id,check_key,'dynamic_usability',jsonb_build_object('id',oid,'findingId',f.id,'projectId',p_project_id,'runId',p_run_id,'revisionId',r->'revision'->>'id','executorId',r->>'createdBy','checkId',check_key,'criterionId',c->>'ruleId','definition',definition,'result',observation,'usability',c||jsonb_build_object('observationIndex',idx,'correlation',correlation),'suggestions',hints,'evidence',refs,'targetUrl',coalesce(r->'environment'->>'targetUrl',r->'revision'->>'targetUrl'),'targetVersion',r->'environment'->'targetVersion','goal',r->'revision'->>'goal','createdAt',stamp),stamp) on conflict(run_id,source,check_id) do nothing;
  get diagnostics n=row_count;
  if n=1 then
   f.version:=f.version+case when (f.payload->>'observationCount')::integer=0 then 0 else 1 end;
   f.payload:=f.payload||jsonb_build_object('version',f.version,'observationCount',(f.payload->>'observationCount')::integer+1,'updatedAt',stamp);
   if f.payload->>'remediation'='resolved' then
    oid:=gen_random_uuid();insert into public.dynamic_finding_events(id,project_id,finding_id,payload,created_at) values(oid,p_project_id,f.id,jsonb_build_object('id',oid,'findingId',f.id,'projectId',p_project_id,'actorId',auth.uid(),'version',f.version,'kind','recurrence','automatic',true,'remediation','open','regressionRunId',null,'note','A new failed usability observation reopened the issue; inspect the retained rule evidence.','createdAt',stamp),stamp);
    f.payload:=f.payload||jsonb_build_object('remediation','open','verification','needs_investigation','confidence',null,'confidenceBasis','A new independent usability failure after resolution requires human investigation.');
   end if;
   update public.dynamic_findings set version=f.version,payload=f.payload,updated_at=stamp where id=f.id;
  end if;
  result:=result||jsonb_build_array(f.payload);
 end loop;
 return result;
end $$;
revoke all on function public.collect_dynamic_findings(uuid,uuid) from public,anon;
grant execute on function public.collect_dynamic_findings(uuid,uuid) to authenticated;

create or replace function public.record_dynamic_remediation(p_project_id uuid,p_finding_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.dynamic_findings%rowtype;r jsonb;o jsonb;eid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();status text:=p_input->>'status';note text:=p_input->>'note';rid uuid;changes jsonb:='[]';
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Decision object required';end if;
 if exists(select 1 from jsonb_object_keys(p_input) key where key not in ('version','status','note','regressionRunId')) then raise exception 'Invalid remediation input';end if;
 if status is null or status not in ('open','in_progress','resolved') or note is null or length(btrim(note)) not between 3 and 4000 or jsonb_typeof(p_input->'version') is distinct from 'number' then raise exception 'Explicit bounded remediation required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into f from public.dynamic_findings where id=p_finding_id and project_id=p_project_id for update;
 if f.id is null or p_input->>'version'<>f.version::text then raise exception 'Finding version changed';end if;
 if status='resolved' then
  if f.payload->>'verification'<>'confirmed' or p_input->>'regressionRunId' is null then raise exception 'Confirm and inspect a pinned regression before resolution';end if;
  begin rid:=(p_input->>'regressionRunId')::uuid;exception when invalid_text_representation then raise exception 'Valid regression Run required';end;
  select payload into r from public.dynamic_runs where id=rid and project_id=p_project_id;
  if r is null or r->>'state' is distinct from 'completed' or r->>'verdict' is distinct from 'passed' then raise exception 'Passed completed regression required';end if;
  select payload into o from public.dynamic_finding_observations where finding_id=f.id and run_id::text=r->'regression'->>'runId';
  if o is null or r->'regression'->>'revisionId'<>o->>'revisionId' or r->'revision'->>'id'<>o->>'revisionId' then raise exception 'Pinned finding observation and revision required';end if;
  if f.payload->>'source'='dynamic_usability' then
   if o->'usability'->>'correlation'='run_only' then raise exception 'Stable control or explicit criterion identity required for verified remediation';end if;
   if jsonb_typeof(r->'usability'->'observations') is distinct from 'array' then raise exception 'Retained regression usability assessment required';end if;
   if (select count(*) from jsonb_array_elements(r->'usability'->'observations') c where c->'ruleId'=o->'usability'->'ruleId' and c->'persona'=o->'usability'->'persona' and (case o->'usability'->>'correlation' when 'stable_control' then c->'controlKey'=o->'usability'->'controlKey' when 'explicit_check' then c->'checkId'=o->'usability'->'checkId' else false end))<>1 then raise exception 'Unique matching usability identity required';end if;
   if not exists(select 1 from jsonb_array_elements(r->'usability'->'observations') c where c->'ruleId'=o->'usability'->'ruleId' and c->'persona'=o->'usability'->'persona' and (case o->'usability'->>'correlation' when 'stable_control' then c->'controlKey'=o->'usability'->'controlKey' when 'explicit_check' then c->'checkId'=o->'usability'->'checkId' else false end) and c->>'verdict'='passed' and jsonb_typeof(c->'evidenceIds')='array' and jsonb_array_length(c->'evidenceIds')>0 and exists(select 1 from jsonb_array_elements(r->'evidence') e where e->>'kind'='usability' and (c->'evidenceIds') ? (e->>'id') and e->>'sha256'~'^[a-f0-9]{64}$') and not exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') supplied where (select count(*) from jsonb_array_elements(r->'evidence') e where e->>'id'=supplied and e->>'sha256'~'^[a-f0-9]{64}$')<>1)) then raise exception 'Matching passed usability rule evidence required';end if;
  else
  if not exists(select 1 from jsonb_array_elements(r->'checks') c where c->>'checkId'=o->>'checkId' and c->>'criterionId'=o->>'criterionId' and c->>'verdict'='passed' and jsonb_typeof(c->'evidenceIds')='array' and jsonb_array_length(c->'evidenceIds')>0 and not exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') ref where not exists(select 1 from jsonb_array_elements(r->'evidence') e where e->>'id'=ref and e->>'sha256' ~ '^[a-f0-9]{64}$'))) then raise exception 'Matching independently passed check evidence required';end if;
  end if;
  if r->'environment' is distinct from r->'regression'->'environment' then changes:=changes||'"Recorded environment differs from the failed baseline."'::jsonb;end if;
  if r->'executionVersions' is distinct from r->'regression'->'executionVersions' then changes:=changes||'"Execution versions differ from the failed baseline."'::jsonb;end if;
  if r->>'createdBy'<>r->'regression'->>'createdBy' then changes:=changes||'"Executing actor differs from the failed baseline."'::jsonb;end if;
 end if;
 f.version:=f.version+1;f.payload:=f.payload||jsonb_build_object('version',f.version,'remediation',status,'updatedAt',stamp);
 insert into public.dynamic_finding_events(id,project_id,finding_id,payload,created_at) values(eid,p_project_id,f.id,jsonb_build_object('id',eid,'findingId',f.id,'projectId',p_project_id,'actorId',auth.uid(),'version',f.version,'kind','remediation','remediation',status,'regressionRunId',rid,'conditionChanges',changes,'note',btrim(note),'createdAt',stamp),stamp);
 update public.dynamic_findings set version=f.version,payload=f.payload,updated_at=stamp where id=f.id;
 return f.payload;
end $$;
revoke all on function public.record_dynamic_remediation(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_dynamic_remediation(uuid,uuid,jsonb) to authenticated;

commit;
