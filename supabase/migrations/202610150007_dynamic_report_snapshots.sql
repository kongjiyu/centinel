-- Server-captured, immutable Dynamic-only reports. No client-supplied findings or verdicts.
create table public.dynamic_report_snapshots (
 id uuid primary key,project_id uuid not null references public.projects(id) on delete cascade,
 run_id uuid not null references public.dynamic_runs(id) on delete cascade,
 created_by uuid not null,created_at timestamptz not null,payload jsonb not null,
 unique(id,project_id),check(octet_length(payload::text)<=4194304)
);
alter table public.dynamic_report_snapshots enable row level security;
create policy dynamic_report_read on public.dynamic_report_snapshots for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_report_snapshots from public,anon,authenticated;
grant select on public.dynamic_report_snapshots to authenticated;

-- Defence in depth for exports: never copy runtime credentials or OS paths.
create function public._dynamic_report_safe(value jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare output jsonb; k text; v jsonb;
begin
 if jsonb_typeof(value)='object' then
  output:='{}';for k,v in select * from jsonb_each(value) loop
   if lower(k) ~ '(password|secret|cookie|authorization|apikey|api_key|prompt|reasoning|objectpath|workspacepath|sessionreference|idempotency|lease)' or lower(k) in ('token','accesstoken','refreshtoken') then continue;end if;
   output:=output||jsonb_build_object(k,public._dynamic_report_safe(v));
  end loop;return output;
 elsif jsonb_typeof(value)='array' then select coalesce(jsonb_agg(public._dynamic_report_safe(item)),'[]') into output from jsonb_array_elements(value) item;return output;
 elsif jsonb_typeof(value)='string' then return to_jsonb(regexp_replace(value#>>'{}','(/Users/|/home/|[A-Za-z]:\\)[^[:space:]"<>]*','[local path withheld]','g'));
 end if;return value;
end $$;
revoke all on function public._dynamic_report_safe(jsonb) from public,anon,authenticated;

create function public.capture_dynamic_report(p_project_id uuid,p_run_id uuid,p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;old public.dynamic_report_snapshots%rowtype;stamp timestamptz:=clock_timestamp();result jsonb;details jsonb;copies jsonb;artifacts jsonb;events jsonb;usage jsonb:='[]';
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_report_id is null then raise exception 'Report identity required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into old from public.dynamic_report_snapshots where id=p_report_id;
 if old.id is not null then
  if old.project_id<>p_project_id or old.run_id<>p_run_id or old.created_by<>auth.uid() then raise insufficient_privilege;end if;
  return old.payload;
 end if;
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'state' not in ('completed','blocked','cancelled','interrupted') then raise exception 'Select a stopped Run before capturing a report';end if;
 select coalesce(jsonb_agg(public.read_dynamic_finding(p_project_id,f.id) order by f.id),'[]') into details from public.dynamic_findings f where f.project_id=p_project_id and exists(select 1 from public.dynamic_finding_observations o where o.finding_id=f.id and o.run_id=p_run_id);
 select coalesce(jsonb_agg(public._dynamic_evidence_copy_json(c) order by c.id),'[]') into copies from public.dynamic_evidence_copies c where c.project_id=p_project_id and c.run_id=p_run_id;
 select coalesce(jsonb_agg(payload order by id),'[]') into artifacts from public.dynamic_run_artifacts where project_id=p_project_id and run_id=p_run_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'runId',run_id,'kind',kind,'outcome',outcome,'note',note,'actorId',actor_id,'createdAt',created_at) order by created_at,id),'[]') into events from public.dynamic_environment_events where project_id=p_project_id and run_id=p_run_id;
 -- The ledger may be absent in an isolated Dynamic-only upgrade fixture.
 if to_regclass('public.model_usage_records') is not null then
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''stage'',stage,''provider'',provider,''model'',model,''outcome'',outcome,''input'',input_tokens,''output'',output_tokens,''cacheRead'',cache_read_tokens,''cacheCreation'',cache_creation_tokens,''durationMs'',duration_ms,''createdAt'',created_at) order by created_at,id),''[]'') from public.model_usage_records where project_id=$1 and owner_id=$2 and metadata->>''runId''=$3'
  into usage using p_project_id,(r->>'createdBy')::uuid,p_run_id::text;
 end if;
 result:=jsonb_build_object('metadata',jsonb_build_object('schemaVersion','centinel-dynamic-report-v1','generatorVersion','dynamic-report-1','reportId',p_report_id,'projectId',p_project_id,'runId',p_run_id,'actorId',auth.uid(),'generatedAt',stamp),
 'run',r-'lease'-'idempotencyKey'-'legacySessionId'-'actionPolicy',
 'findings',details,'evidenceCopies',copies,'artifacts',artifacts,'dataEvents',events,'modelUsage',jsonb_build_object('status',case when jsonb_array_length(usage)>0 then 'available' else 'unavailable' end,'calls',usage),
 'limitations',jsonb_build_array('Dynamic-only report; incoming Static context is synthetic when supplied.','Finding decisions and shared-copy availability are frozen at capture time; later changes require a new report.','Evidence bytes are separate private copies; report references do not grant access and may expire or be deleted.','Downloaded exports cannot be remotely revoked.','Persona simulation is not a real-user study or complete accessibility assessment.','Recorded usage may be incomplete; missing token counts or cost are not zero.'));
 -- Only the frozen environment description is needed, never local setup commands/session references.
 if jsonb_typeof(r->'environment')='object' then result:=jsonb_set(result,'{run,environment}',(r->'environment')-'actionPolicy'-'startupInstructions'-'sessionSnapshot'-'sessionReference');end if;
 result:=public._dynamic_report_safe(result);
 if octet_length(result::text)>4194304 then raise exception 'Report exceeds bounded snapshot size';end if;
 insert into public.dynamic_report_snapshots(id,project_id,run_id,created_by,created_at,payload) values(p_report_id,p_project_id,p_run_id,auth.uid(),stamp,result);
 return result;
end $$;
revoke all on function public.capture_dynamic_report(uuid,uuid,uuid) from public,anon;
grant execute on function public.capture_dynamic_report(uuid,uuid,uuid) to authenticated;
