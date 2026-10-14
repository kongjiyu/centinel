create table public.dynamic_unit_reports(
 id uuid primary key,project_id uuid not null references public.projects(id) on delete cascade,
 unit_run_id uuid not null references public.dynamic_unit_runs(id) on delete cascade,
 actor_id uuid not null,payload jsonb not null check(octet_length(payload::text)<=4194304),created_at timestamptz not null
);
alter table public.dynamic_unit_reports enable row level security;
create policy dynamic_unit_report_read on public.dynamic_unit_reports for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_unit_reports from public,anon,authenticated;grant select on public.dynamic_unit_reports to authenticated;
create function public.capture_dynamic_unit_report(p_project_id uuid,p_run_id uuid,p_report_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.dynamic_unit_reports;r jsonb;result jsonb;events jsonb;stamp timestamptz:=clock_timestamp();begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_report_id is null then raise exception 'Report identity required';end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into old from public.dynamic_unit_reports where id=p_report_id;if found then if old.project_id<>p_project_id or old.unit_run_id<>p_run_id or old.actor_id<>auth.uid() then raise insufficient_privilege;end if;return old.payload;end if;
 select payload into r from public.dynamic_unit_runs where project_id=p_project_id and id=p_run_id;
 if r is null or r->>'state' is null or r->>'state' not in ('completed','blocked','cancelled','interrupted') then raise exception 'Select a stopped unit Run';end if;
 select coalesce(jsonb_agg(payload order by created_at,id),'[]') into events from public.dynamic_unit_data_events where project_id=p_project_id and unit_run_id=p_run_id;
 result:=jsonb_build_object('metadata',jsonb_build_object('schemaVersion','centinel-unit-report-v1','generatorVersion','unit-report-1','reportId',p_report_id,'projectId',p_project_id,'runId',p_run_id,'actorId',auth.uid(),'generatedAt',stamp),'run',r-'lease'-'idempotencyKey','cleanupEvents',events,'limitations',jsonb_build_array('Existing framework tests only; no browser criterion, application finding or model usage is inferred.','Cleanup history is frozen at capture; later cleanup requires a new report.','Downloaded exports cannot be remotely revoked.'));
 result:=jsonb_set(result,'{run,environment}',(r->'environment')-'startupInstructions'-'actionPolicy'-'sessionReference');result:=public._dynamic_report_safe(result);
 insert into public.dynamic_unit_reports(id,project_id,unit_run_id,actor_id,payload,created_at) values(p_report_id,p_project_id,p_run_id,auth.uid(),result,stamp);return result;
end $$;
revoke all on function public.capture_dynamic_unit_report(uuid,uuid,uuid) from public,anon;grant execute on function public.capture_dynamic_unit_report(uuid,uuid,uuid) to authenticated;
