-- Separate existing-framework Runs. Browser criteria and findings are never fabricated.
create table public.dynamic_unit_runs(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,
 profile_id uuid not null,actor_id uuid not null,state text not null check(state in ('queued','running','completed','blocked','cancelled','interrupted')),
 idempotency_key text not null,payload jsonb not null check(octet_length(payload::text)<=4194304),
 lease_token uuid,worker_id text,expires_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 foreign key(profile_id,project_id) references public.dynamic_environments(id,project_id),unique(project_id,idempotency_key)
);
create unique index dynamic_one_active_unit_per_project on public.dynamic_unit_runs(project_id) where state in ('queued','running');
alter table public.dynamic_unit_runs enable row level security;
create policy dynamic_unit_read on public.dynamic_unit_runs for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_unit_runs from public,anon,authenticated;
grant select(id,project_id,profile_id,actor_id,state,idempotency_key,payload,worker_id,expires_at,created_at) on public.dynamic_unit_runs to authenticated;
alter table public.dynamic_environment_data add column unit_run_id uuid references public.dynamic_unit_runs(id);
create table public.dynamic_unit_data_events(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,
 unit_run_id uuid not null references public.dynamic_unit_runs(id) on delete cascade,
 payload jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.dynamic_unit_data_events enable row level security;
create policy dynamic_unit_events_read on public.dynamic_unit_data_events for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_unit_data_events from public,anon,authenticated;
grant select on public.dynamic_unit_data_events to authenticated;

create function public.recover_dynamic_unit_runs(p_project_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_unit_runs;stamp timestamptz:=clock_timestamp();result jsonb;all_results jsonb:='[]';begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 for op in select * from public.dynamic_unit_runs where project_id=p_project_id and state in ('queued','running') and case when state='queued' then created_at+interval '90 seconds'<=stamp else expires_at<=stamp end for update loop
  result:=op.payload||jsonb_build_object('state','interrupted','verdict','not_tested','reason','Unit worker stopped responding. Inspect the workspace and confirm cleanup before reuse.','updatedAt',stamp);
  update public.dynamic_unit_runs set state='interrupted',payload=result,lease_token=null where id=op.id;
  update public.dynamic_environment_data set state='cleanup_required' where unit_run_id=op.id;
  all_results:=all_results||jsonb_build_array(result);
 end loop;return all_results;
end $$;
create function public.require_no_dynamic_unit_work(p_project_id uuid) returns void language plpgsql security definer set search_path=public as $$begin
 perform public.recover_dynamic_unit_runs(p_project_id);if exists(select 1 from public.dynamic_unit_runs where project_id=p_project_id and state in ('queued','running')) then raise exception 'Unit execution is active; stop it and confirm cleanup before reuse';end if;
end $$;
revoke all on function public.require_no_dynamic_unit_work(uuid) from public,anon,authenticated;

create function public.start_dynamic_unit_run(p_project_id uuid,p_profile_id uuid,p_key text,p_command jsonb,p_timeout_ms integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.dynamic_unit_runs;profile public.dynamic_environments;data_state jsonb;id uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();result jsonb;begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_key is null or length(p_key) not between 1 and 128 or p_timeout_ms is null or p_timeout_ms not between 100 and 300000 then raise exception 'Bounded unit request required';end if;
 if jsonb_typeof(p_command) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('program','script','fingerprint','authorizationId','gitCommit','frameworkVersion','cliSha256','nodeVersion')) or p_command->>'program' is distinct from 'node' or p_command->>'script' is null or p_command->>'script' !~ '^[A-Za-z0-9][A-Za-z0-9_:.-]{0,100}$' or p_command->>'fingerprint' is null or p_command->>'fingerprint' !~ '^[a-f0-9]{64}$' or p_command->>'authorizationId' is null or p_command->>'authorizationId' !~ '^[a-f0-9]{64}$' or p_command->>'cliSha256' is null or p_command->>'cliSha256' !~ '^[a-f0-9]{64}$' or p_command->>'frameworkVersion' is null or p_command->>'frameworkVersion' !~ '^[34]\.[0-9]+\.[0-9]+([-+].*)?$' or p_command->>'nodeVersion' is null or p_command->>'nodeVersion' !~ '^v[0-9]+\.[0-9]+\.[0-9]+$' or length(p_command::text)>2000 then raise exception 'Fixed installed Vitest/Node command required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));perform public.recover_dynamic_unit_runs(p_project_id);
 select * into old from public.dynamic_unit_runs where project_id=p_project_id and idempotency_key=p_key;
 if found then if old.actor_id<>auth.uid() or old.profile_id<>p_profile_id or old.payload->'command' is distinct from p_command or old.payload->'timeoutMs' is distinct from to_jsonb(p_timeout_ms) then raise exception 'Unit idempotency conflict';end if;return jsonb_build_object('run',old.payload,'reused',true);end if;
 perform public.recover_dynamic_runs(p_project_id);perform public.recover_dynamic_hooks(p_project_id);perform public.require_no_dynamic_session_capture(p_project_id);
 if exists(select 1 from public.dynamic_runs where project_id=p_project_id and state in ('queued','running')) or exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and state in ('queued','running')) or exists(select 1 from public.dynamic_unit_runs where project_id=p_project_id and state in ('queued','running')) then raise exception 'Project execution is active';end if;
 select * into profile from public.dynamic_environments where project_id=p_project_id and dynamic_environments.id=p_profile_id for update;if not found then raise no_data_found;end if;
 data_state:=public.read_dynamic_environment_data(p_project_id,p_profile_id);if data_state->>'state'<>'ready' or (data_state->>'preparedVersion')::integer is distinct from profile.version then raise exception 'Prepare clean unit test data for this environment version';end if;
 perform public.claim_dynamic_data_resource(p_project_id,p_profile_id);
 result:=jsonb_build_object('id',id,'projectId',p_project_id,'environmentId',p_profile_id,'kind','unit','state','queued','verdict','not_tested','createdBy',auth.uid(),'createdAt',stamp,'updatedAt',stamp,'idempotencyKey',p_key,'command',p_command,'timeoutMs',p_timeout_ms,'environment',profile.payload||jsonb_build_object('preparation',data_state->'preparation','resourceKey',data_state->'resource'->'key'),'result',null,'reason',null);
 insert into public.dynamic_unit_runs(id,project_id,profile_id,actor_id,state,idempotency_key,payload) values(id,p_project_id,p_profile_id,auth.uid(),'queued',p_key,result);
 update public.dynamic_environment_data set state='in_use',unit_run_id=id,run_id=null where profile_id=p_profile_id;
 return jsonb_build_object('run',result,'reused',false);
end $$;
create function public.claim_dynamic_unit_run(p_project_id uuid,p_id uuid,p_worker text,p_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_unit_runs;stamp timestamptz:=clock_timestamp();begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_unit_runs where project_id=p_project_id and id=p_id for update;
 if not found or op.state<>'queued' or op.created_at+interval '90 seconds'<=stamp then return null;end if;if op.actor_id<>auth.uid() then raise insufficient_privilege;end if;
 if p_token is null or p_worker is null or length(p_worker) not between 1 and 128 then raise exception 'Unit worker required';end if;
 op.payload:=op.payload||jsonb_build_object('state','running','updatedAt',stamp,'lease',jsonb_build_object('workerId',p_worker,'heartbeatAt',stamp,'expiresAt',stamp+interval '90 seconds'));
 update public.dynamic_unit_runs set state='running',payload=op.payload,lease_token=p_token,worker_id=p_worker,expires_at=stamp+interval '90 seconds' where id=p_id;return op.payload;
end $$;
create function public.heartbeat_dynamic_unit_run(p_project_id uuid,p_id uuid,p_worker text,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare op public.dynamic_unit_runs;stamp timestamptz:=clock_timestamp();begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_unit_runs where project_id=p_project_id and id=p_id for update;
 if not found or op.state<>'running' or op.actor_id<>auth.uid() or op.worker_id is distinct from p_worker or op.lease_token is distinct from p_token or op.expires_at<=stamp or coalesce((op.payload->>'cancelRequested')::boolean,false) then return false;end if;
 op.payload:=jsonb_set(op.payload,'{lease}',jsonb_build_object('workerId',p_worker,'heartbeatAt',stamp,'expiresAt',stamp+interval '90 seconds'));update public.dynamic_unit_runs set payload=op.payload,expires_at=stamp+interval '90 seconds' where id=p_id;return true;
end $$;
create function public.finish_dynamic_unit_run(p_project_id uuid,p_id uuid,p_token uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_unit_runs;stamp timestamptz:=clock_timestamp();outcome text;final_state text;verdict text;assessment jsonb;counts jsonb;actual_total integer;begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_unit_runs where project_id=p_project_id and id=p_id for update;
 if not found or op.state<>'running' or op.actor_id<>auth.uid() or op.lease_token is distinct from p_token or op.expires_at<=stamp then return null;end if;
 outcome:=p_result->>'outcome';if p_result->'schemaVersion' is distinct from '1'::jsonb or outcome is null or outcome not in ('passed','failed','not_tested','no_tests','configuration_error','missing_dependencies','parser_error','cancelled','timeout','output_limit','runner_error') or octet_length(p_result::text)>2097152 then raise exception 'Bounded unit result required';end if;
 assessment:=p_result->'assessment';counts:=assessment->'counts';
 if outcome in ('passed','failed','not_tested','no_tests') then
  if p_result->'framework'->>'name' is distinct from 'vitest' or p_result->'framework'->>'version' is distinct from op.payload->'command'->>'frameworkVersion' or jsonb_typeof(counts) is distinct from 'object' or not(counts ?& array['total','passed','failed','pending','todo','totalSuites','failedSuites']) or jsonb_typeof(assessment->'tests') is distinct from 'array' then raise exception 'Installed framework result required';end if;
  actual_total:=jsonb_array_length(assessment->'tests');if actual_total>5000 or actual_total is distinct from (counts->>'total')::integer or (counts->>'total')::integer is distinct from (counts->>'passed')::integer+(counts->>'failed')::integer+(counts->>'pending')::integer+(counts->>'todo')::integer then raise exception 'Unit counts disagree';end if;
  if exists(select 1 from jsonb_each(counts) c where jsonb_typeof(c.value)<>'number' or c.value::text !~ '^[0-9]+$' or c.value::text::integer>10000) then raise exception 'Bounded integer counts required';end if;
  if (select count(*) from jsonb_array_elements(assessment->'tests') t where t->>'status'='passed')<>(counts->>'passed')::integer or (select count(*) from jsonb_array_elements(assessment->'tests') t where t->>'status'='failed')<>(counts->>'failed')::integer or (select count(*) from jsonb_array_elements(assessment->'tests') t where t->>'status' in ('pending','skipped'))<>(counts->>'pending')::integer or (select count(*) from jsonb_array_elements(assessment->'tests') t where t->>'status'='todo')<>(counts->>'todo')::integer then raise exception 'Per-test counts disagree';end if;
  if outcome='passed' and ((counts->>'passed')::integer=0 or (counts->>'failed')::integer<>0 or (counts->>'failedSuites')::integer<>0 or assessment->'success' is distinct from 'true'::jsonb or p_result->'process'->'exitCode' is distinct from '0'::jsonb or p_result->'process'->'outcome' is distinct from '"passed"'::jsonb or p_result->'process'->'signal' is distinct from 'null'::jsonb) then raise exception 'Passing unit evidence required';end if;
  if outcome='no_tests' and actual_total<>0 then raise exception 'No-tests counts disagree';end if;
  if outcome='not_tested' and ((counts->>'passed')::integer<>0 or (counts->>'failed')::integer<>0) then raise exception 'Skipped counts disagree';end if;
 end if;
 if coalesce((op.payload->>'cancelRequested')::boolean,false) then outcome:='cancelled';p_result:=p_result||jsonb_build_object('outcome','cancelled','reason','Stop requested; retained framework data is diagnostic only.');end if;
 final_state:=case when outcome='cancelled' then 'cancelled' when outcome in ('passed','failed') then 'completed' else 'blocked' end;verdict:=case when outcome in ('passed','failed') then outcome else 'not_tested' end;
 op.payload:=op.payload||jsonb_build_object('state',final_state,'verdict',verdict,'result',p_result,'updatedAt',stamp,'reason',p_result->'reason');update public.dynamic_unit_runs set state=final_state,payload=op.payload,lease_token=null where id=p_id;
 update public.dynamic_environment_data set state='cleanup_required' where unit_run_id=p_id;return op.payload;
end $$;
create function public.cancel_dynamic_unit_run(p_project_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_unit_runs;begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_unit_runs where project_id=p_project_id and id=p_id for update;if not found then raise no_data_found;end if;
 if op.state not in ('queued','running') then return op.payload;end if;
 op.payload:=op.payload||case when op.state='running' then jsonb_build_object('cancelRequested',true,'reason','Stop requested; waiting for unit worker termination.') else jsonb_build_object('state','cancelled','verdict','not_tested','reason','Unit run cancelled before execution.') end||jsonb_build_object('updatedAt',clock_timestamp());
 update public.dynamic_unit_runs set state=case when op.state='queued' then 'cancelled' else 'running' end,payload=op.payload where id=p_id;
 if op.state='queued' then update public.dynamic_environment_data set state='cleanup_required' where unit_run_id=p_id;end if;return op.payload;
end $$;
revoke all on function public.recover_dynamic_unit_runs(uuid),public.start_dynamic_unit_run(uuid,uuid,text,jsonb,integer),public.claim_dynamic_unit_run(uuid,uuid,text,uuid),public.heartbeat_dynamic_unit_run(uuid,uuid,text,uuid),public.finish_dynamic_unit_run(uuid,uuid,uuid,jsonb),public.cancel_dynamic_unit_run(uuid,uuid) from public,anon;
grant execute on function public.recover_dynamic_unit_runs(uuid),public.start_dynamic_unit_run(uuid,uuid,text,jsonb,integer),public.claim_dynamic_unit_run(uuid,uuid,text,uuid),public.heartbeat_dynamic_unit_run(uuid,uuid,text,uuid),public.finish_dynamic_unit_run(uuid,uuid,uuid,jsonb),public.cancel_dynamic_unit_run(uuid,uuid) to authenticated;

-- Preserve all prior browser/hook contracts while enforcing cross-run exclusion.
alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_unit_guard;
revoke all on function public.start_dynamic_run_without_unit_guard(uuid,uuid,uuid,text) from public,anon,authenticated;
create function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text) returns jsonb language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_unit_work(p_project_id);end if;return public.start_dynamic_run_without_unit_guard(p_project_id,p_actor_id,p_revision_id,p_key);
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text) to authenticated;
alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_unit_guard;
revoke all on function public.start_dynamic_environment_run_without_unit_guard(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb) returns jsonb language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_unit_work(p_project_id);end if;return public.start_dynamic_environment_run_without_unit_guard(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
end $$;
revoke all on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
alter function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) rename to start_dynamic_hook_without_unit_guard;
revoke all on function public.start_dynamic_hook_without_unit_guard(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
create function public.start_dynamic_hook(p_project_id uuid,p_profile_id uuid,p_kind text,p_key text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_unit_work(p_project_id);end if;return public.start_dynamic_hook_without_unit_guard(p_project_id,p_profile_id,p_kind,p_key,p_command);
end $$;
revoke all on function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) to authenticated;
alter function public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text) rename to acquire_dynamic_session_capture_without_unit_guard;
revoke all on function public.acquire_dynamic_session_capture_without_unit_guard(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
create function public.acquire_dynamic_session_capture(p_project_id uuid,p_profile_id uuid,p_id uuid,p_token uuid,p_worker text) returns boolean language plpgsql security definer set search_path=public as $$begin
 perform public.require_no_dynamic_unit_work(p_project_id);return public.acquire_dynamic_session_capture_without_unit_guard(p_project_id,p_profile_id,p_id,p_token,p_worker);
end $$;
revoke all on function public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text) to authenticated;
alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_unit_guard;
revoke all on function public.save_dynamic_environment_without_unit_guard(uuid,jsonb,uuid) from public,anon,authenticated;
create function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$begin
 perform public.require_no_dynamic_unit_work(p_project_id);return public.save_dynamic_environment_without_unit_guard(p_project_id,p_input,p_id);
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;

alter function public.read_dynamic_environment_data(uuid,uuid) rename to read_dynamic_environment_data_without_unit_recovery;
revoke all on function public.read_dynamic_environment_data_without_unit_recovery(uuid,uuid) from public,anon,authenticated;
create function public.read_dynamic_environment_data(p_project_id uuid,p_profile_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform public.recover_dynamic_unit_runs(p_project_id);result:=public.read_dynamic_environment_data_without_unit_recovery(p_project_id,p_profile_id);
 return result||jsonb_build_object('unitRunId',(select unit_run_id from public.dynamic_environment_data where profile_id=p_profile_id and project_id=p_project_id));
end $$;
revoke all on function public.read_dynamic_environment_data(uuid,uuid) from public,anon;
grant execute on function public.read_dynamic_environment_data(uuid,uuid) to authenticated;

alter function public.record_dynamic_environment_data(uuid,uuid,text,text,text) rename to record_dynamic_environment_data_without_unit_events;
revoke all on function public.record_dynamic_environment_data_without_unit_events(uuid,uuid,text,text,text) from public,anon,authenticated;
create function public.record_dynamic_environment_data(p_project_id uuid,p_profile_id uuid,p_kind text,p_outcome text,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$declare unit_id uuid;result jsonb;begin
 perform public.require_no_dynamic_unit_work(p_project_id);select unit_run_id into unit_id from public.dynamic_environment_data where project_id=p_project_id and profile_id=p_profile_id;
 result:=public.record_dynamic_environment_data_without_unit_events(p_project_id,p_profile_id,p_kind,p_outcome,p_note);
 if unit_id is not null and p_kind='cleanup' then
  insert into public.dynamic_unit_data_events(project_id,unit_run_id,payload) values(p_project_id,unit_id,jsonb_build_object('kind','cleanup','outcome',p_outcome,'note',p_note,'actorId',auth.uid(),'createdAt',clock_timestamp()));
  if p_outcome='completed' then update public.dynamic_environment_data set unit_run_id=null where profile_id=p_profile_id;end if;
 end if;return public.read_dynamic_environment_data(p_project_id,p_profile_id);
end $$;
revoke all on function public.record_dynamic_environment_data(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.record_dynamic_environment_data(uuid,uuid,text,text,text) to authenticated;

alter function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) rename to finish_dynamic_hook_without_unit_cleanup;
revoke all on function public.finish_dynamic_hook_without_unit_cleanup(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.finish_dynamic_hook(p_project_id uuid,p_id uuid,p_token uuid,p_state text,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare unit_id uuid;result jsonb;begin
 select unit_run_id into unit_id from public.dynamic_environment_data where project_id=p_project_id and operation_id=p_id;
 result:=public.finish_dynamic_hook_without_unit_cleanup(p_project_id,p_id,p_token,p_state,p_result);
 if unit_id is not null and result is not null and result->>'kind'='cleanup' then
  insert into public.dynamic_unit_data_events(project_id,unit_run_id,payload) values(p_project_id,unit_id,jsonb_build_object('kind','cleanup','outcome',case when result->>'verdict'='passed' then 'completed' else 'failed' end,'note','Approved cleanup hook ended: '||(result->'result'->>'outcome'),'actorId',auth.uid(),'createdAt',clock_timestamp(),'operationId',p_id));
  if result->>'verdict'='passed' then update public.dynamic_environment_data set unit_run_id=null where unit_run_id=unit_id;end if;
 end if;return result;
end $$;
revoke all on function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) to authenticated;

-- Failed prerequisite attempts are historical outcomes, but execute no code and
-- acquire no target-data reservation. Never invent an installed command/version.
create function public.record_dynamic_unit_preflight(p_project_id uuid,p_profile_id uuid,p_key text,p_timeout_ms integer,p_outcome text,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.dynamic_unit_runs;profile public.dynamic_environments;rid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();result jsonb;begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_key is null or length(p_key) not between 1 and 128 or p_timeout_ms is null or p_timeout_ms not between 100 and 300000 or p_outcome is null or p_outcome not in ('configuration_error','missing_dependencies') or p_reason is null or length(p_reason) not between 1 and 500 then raise exception 'Bounded preflight failure required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into old from public.dynamic_unit_runs where project_id=p_project_id and idempotency_key=p_key;
 if found then if old.actor_id<>auth.uid() or old.profile_id<>p_profile_id or old.payload->'timeoutMs' is distinct from to_jsonb(p_timeout_ms) then raise exception 'Preflight request conflict';end if;return old.payload;end if;
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id;if not found then raise no_data_found;end if;
 result:=jsonb_build_object('id',rid,'projectId',p_project_id,'environmentId',p_profile_id,'kind','unit','state','blocked','verdict','not_tested','createdBy',auth.uid(),'createdAt',stamp,'updatedAt',stamp,'idempotencyKey',p_key,'timeoutMs',p_timeout_ms,'environment',profile.payload,'reason',p_reason,'command',jsonb_build_object('program','node','script',null,'fingerprint',null,'authorizationId',null,'gitCommit',null,'frameworkVersion',null,'cliSha256',null,'nodeVersion',null),'result',jsonb_build_object('schemaVersion',1,'framework',jsonb_build_object('name','vitest','version',null),'command',jsonb_build_object('program','node','script',null,'args','[]'::jsonb),'workspace',jsonb_build_object('fingerprint',null,'gitCommit',null,'authorizationId',null),'outcome',p_outcome,'process',null,'assessment',null,'reason',p_reason,'startedAt',stamp,'finishedAt',stamp,'limitations',jsonb_build_array('No repository code was started; this prerequisite attempt acquired no data reservation.')));
 insert into public.dynamic_unit_runs(id,project_id,profile_id,actor_id,state,idempotency_key,payload) values(rid,p_project_id,p_profile_id,auth.uid(),'blocked',p_key,result);return result;
end $$;
revoke all on function public.record_dynamic_unit_preflight(uuid,uuid,text,integer,text,text) from public,anon;
grant execute on function public.record_dynamic_unit_preflight(uuid,uuid,text,integer,text,text) to authenticated;
