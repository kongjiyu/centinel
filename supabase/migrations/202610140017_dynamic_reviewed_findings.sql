-- Separate Dynamic candidates, immutable observations and attributable decisions.
-- Existing Static findings and Assessment aggregation remain unchanged.
create table if not exists public.dynamic_findings(
 id uuid primary key,project_id uuid not null references public.projects(id) on delete cascade,
 finding_key text not null,version integer not null check(version>0),payload jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(project_id,finding_key),unique(id,project_id)
);
create table if not exists public.dynamic_finding_observations(
 id uuid primary key,project_id uuid not null,finding_id uuid not null,
 run_id uuid not null references public.dynamic_runs(id) on delete cascade,check_id text not null,
 payload jsonb not null,created_at timestamptz not null default now(),
 foreign key(finding_id,project_id) references public.dynamic_findings(id,project_id) on delete cascade,
 unique(run_id,check_id)
);
create table if not exists public.dynamic_finding_events(
 id uuid primary key,project_id uuid not null,finding_id uuid not null,
 payload jsonb not null,created_at timestamptz not null default now(),
 foreign key(finding_id,project_id) references public.dynamic_findings(id,project_id) on delete cascade
);
alter table public.dynamic_findings enable row level security;
alter table public.dynamic_finding_observations enable row level security;
alter table public.dynamic_finding_events enable row level security;
drop policy if exists dynamic_findings_read on public.dynamic_findings;
create policy dynamic_findings_read on public.dynamic_findings for select to authenticated using(public.is_project_member(project_id));
drop policy if exists dynamic_observations_read on public.dynamic_finding_observations;
create policy dynamic_observations_read on public.dynamic_finding_observations for select to authenticated using(public.is_project_member(project_id));
drop policy if exists dynamic_finding_events_read on public.dynamic_finding_events;
create policy dynamic_finding_events_read on public.dynamic_finding_events for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_findings,public.dynamic_finding_observations,public.dynamic_finding_events from anon,authenticated;
grant select on public.dynamic_findings,public.dynamic_finding_observations,public.dynamic_finding_events to authenticated;

create or replace function public.collect_dynamic_findings(p_project_id uuid,p_run_id uuid)
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
   on conflict(run_id,check_id) do nothing;
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

create or replace function public.review_dynamic_finding(p_project_id uuid,p_finding_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.dynamic_findings%rowtype;eid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();decision text:=p_input->>'decision';note text:=p_input->>'note';severity text:=p_input->>'severity';priority text:=p_input->>'priority';confidence text:=p_input->>'confidence';
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Decision object required';end if;
 if exists(select 1 from jsonb_object_keys(p_input) key where key not in ('version','decision','note','severity','priority','confidence')) then raise exception 'Invalid review input';end if;
 if decision is null or decision not in ('confirmed','rejected','needs_investigation') or note is null or length(btrim(note)) not between 3 and 4000 or jsonb_typeof(p_input->'version') is distinct from 'number' then raise exception 'Explicit bounded review decision required';end if;
 if severity is not null and severity not in ('critical','high','medium','low','info') or priority is not null and priority not in ('high','medium','low') or confidence is not null and confidence not in ('low','medium','high') then raise exception 'Use shared triage vocabulary';end if;
 if decision='confirmed' and (severity is null or priority is null or confidence is null) then raise exception 'Confirmed findings require explicit triage';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into f from public.dynamic_findings where id=p_finding_id and project_id=p_project_id for update;
 if f.id is null or p_input->>'version'<>f.version::text then raise exception 'Finding version changed';end if;
 f.version:=f.version+1;
 f.payload:=f.payload||jsonb_build_object('version',f.version,'verification',decision,'confidenceBasis',btrim(note),'updatedAt',stamp);
 if decision='confirmed' then f.payload:=f.payload||jsonb_build_object('severity',severity,'priority',priority,'confidence',confidence);end if;
 insert into public.dynamic_finding_events(id,project_id,finding_id,payload,created_at) values(eid,p_project_id,f.id,jsonb_build_object('id',eid,'findingId',f.id,'projectId',p_project_id,'actorId',auth.uid(),'version',f.version,'kind','verification','decision',decision,'note',btrim(note),'severity',f.payload->'severity','priority',f.payload->'priority','confidence',f.payload->'confidence','createdAt',stamp),stamp);
 update public.dynamic_findings set version=f.version,payload=f.payload,updated_at=stamp where id=f.id;
 return f.payload;
end $$;

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
  if not exists(select 1 from jsonb_array_elements(r->'checks') c where c->>'checkId'=o->>'checkId' and c->>'criterionId'=o->>'criterionId' and c->>'verdict'='passed' and jsonb_typeof(c->'evidenceIds')='array' and jsonb_array_length(c->'evidenceIds')>0 and not exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') ref where not exists(select 1 from jsonb_array_elements(r->'evidence') e where e->>'id'=ref and e->>'sha256' ~ '^[a-f0-9]{64}$'))) then raise exception 'Matching independently passed check evidence required';end if;
  if r->'environment' is distinct from r->'regression'->'environment' then changes:=changes||'"Recorded environment differs from the failed baseline."'::jsonb;end if;
  if r->'executionVersions' is distinct from r->'regression'->'executionVersions' then changes:=changes||'"Execution versions differ from the failed baseline."'::jsonb;end if;
  if r->>'createdBy'<>r->'regression'->>'createdBy' then changes:=changes||'"Executing actor differs from the failed baseline."'::jsonb;end if;
 end if;
 f.version:=f.version+1;f.payload:=f.payload||jsonb_build_object('version',f.version,'remediation',status,'updatedAt',stamp);
 insert into public.dynamic_finding_events(id,project_id,finding_id,payload,created_at) values(eid,p_project_id,f.id,jsonb_build_object('id',eid,'findingId',f.id,'projectId',p_project_id,'actorId',auth.uid(),'version',f.version,'kind','remediation','remediation',status,'regressionRunId',rid,'conditionChanges',changes,'note',btrim(note),'createdAt',stamp),stamp);
 update public.dynamic_findings set version=f.version,payload=f.payload,updated_at=stamp where id=f.id;
 return f.payload;
end $$;
revoke all on function public.collect_dynamic_findings(uuid,uuid),public.review_dynamic_finding(uuid,uuid,jsonb),public.record_dynamic_remediation(uuid,uuid,jsonb) from public,anon;
grant execute on function public.collect_dynamic_findings(uuid,uuid),public.review_dynamic_finding(uuid,uuid,jsonb),public.record_dynamic_remediation(uuid,uuid,jsonb) to authenticated;

create or replace function public.read_dynamic_finding(p_project_id uuid,p_finding_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 select jsonb_build_object('finding',f.payload,'observations',coalesce((select jsonb_agg(o.payload order by o.created_at,o.id) from public.dynamic_finding_observations o where o.finding_id=f.id and o.project_id=p_project_id),'[]'),'events',coalesce((select jsonb_agg(e.payload order by e.created_at,e.id) from public.dynamic_finding_events e where e.finding_id=f.id and e.project_id=p_project_id),'[]')) into result from public.dynamic_findings f where f.id=p_finding_id and f.project_id=p_project_id;
 return result;
end $$;
revoke all on function public.read_dynamic_finding(uuid,uuid) from public,anon;
grant execute on function public.read_dynamic_finding(uuid,uuid) to authenticated;
