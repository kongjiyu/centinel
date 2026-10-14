-- Durable, actor-bound preparation/cleanup workers. Unit operations follow later.
create table if not exists public.dynamic_hook_operations (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,
 profile_id uuid not null,actor_id uuid not null,kind text not null check(kind in ('setup','cleanup')),
 state text not null check(state in ('queued','running','completed','blocked','cancelled','interrupted')),
 idempotency_key text not null, payload jsonb not null,lease_token uuid,worker_id text,heartbeat_at timestamptz,expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),foreign key(profile_id,project_id) references public.dynamic_environments(id,project_id),unique(project_id,idempotency_key)
);
create unique index if not exists dynamic_one_active_hook_per_project on public.dynamic_hook_operations(project_id) where state in ('queued','running');
alter table public.dynamic_hook_operations enable row level security;
drop policy if exists dynamic_hook_read on public.dynamic_hook_operations;
create policy dynamic_hook_read on public.dynamic_hook_operations for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_hook_operations from public,anon,authenticated;
grant select(id,project_id,profile_id,actor_id,kind,state,idempotency_key,payload,worker_id,heartbeat_at,expires_at,created_at) on public.dynamic_hook_operations to authenticated;
alter table public.dynamic_environment_data add column if not exists operation_id uuid references public.dynamic_hook_operations(id);
alter table public.dynamic_environment_data drop constraint if exists dynamic_environment_data_state_check;
alter table public.dynamic_environment_data add constraint dynamic_environment_data_state_check check(state in ('unprepared','ready','in_use','cleanup_required','preparing','cleaning'));
create or replace function public.recover_dynamic_hooks(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_hook_operations;result jsonb;recovered jsonb:='[]'::jsonb;stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 for op in select * from public.dynamic_hook_operations where project_id=p_project_id and state in ('queued','running') and (case when state='queued' then created_at+interval '90 seconds'<=stamp else expires_at<=stamp end) for update loop
  result:=op.payload||jsonb_build_object('state','interrupted','verdict','not_tested','reason','Data operation stopped responding. Inspect the target and record cleanup before reuse.','updatedAt',stamp);
  update public.dynamic_hook_operations set state='interrupted',payload=result,lease_token=null where id=op.id;
  update public.dynamic_environment_data set state='cleanup_required' where operation_id=op.id;
  recovered:=recovered||jsonb_build_array(result);
 end loop;return recovered;
end $$;
create or replace function public.start_dynamic_hook(p_project_id uuid,p_profile_id uuid,p_kind text,p_key text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare profile public.dynamic_environments;existing public.dynamic_hook_operations;data_state jsonb;op_id uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();result jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_kind not in ('setup','cleanup') or p_key is null or length(p_key) not between 1 and 128 then raise exception 'Valid hook request required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));perform public.recover_dynamic_hooks(p_project_id);
 select * into existing from public.dynamic_hook_operations where project_id=p_project_id and idempotency_key=p_key;
 if found then if existing.actor_id<>auth.uid() or existing.profile_id<>p_profile_id or existing.kind<>p_kind then raise exception 'Hook idempotency conflict';end if;return jsonb_build_object('operation',existing.payload,'reused',true);end if;
 if exists(select 1 from public.dynamic_runs where project_id=p_project_id and state in ('queued','running')) or exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and state in ('queued','running')) then raise exception 'Project work is active';end if;
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;if not found then raise no_data_found;end if;
 data_state:=public.read_dynamic_environment_data(p_project_id,p_profile_id);
 if (p_kind='setup' and data_state->>'state' not in ('unprepared','ready')) or (p_kind='cleanup' and data_state->>'state'<>'cleanup_required') then raise exception 'Data state does not permit this hook';end if;
 result:=jsonb_build_object('id',op_id,'projectId',p_project_id,'environmentId',p_profile_id,'kind',p_kind,'state','queued','verdict','not_tested','createdBy',auth.uid(),'createdAt',stamp,'updatedAt',stamp,'idempotencyKey',p_key,'environment',profile.payload,'command',jsonb_build_object('program',p_command->'program','script',p_command->'script','fingerprint',p_command->'fingerprint','authorizationId',p_command->'authorizationId','gitCommit',p_command->'gitCommit'),'result',null,'reason',null);
 insert into public.dynamic_hook_operations(id,project_id,profile_id,actor_id,kind,state,idempotency_key,payload) values(op_id,p_project_id,p_profile_id,auth.uid(),p_kind,'queued',p_key,result);
 update public.dynamic_environment_data set state=case when p_kind='setup' then 'preparing' else 'cleaning' end,operation_id=op_id where profile_id=p_profile_id;
 return jsonb_build_object('operation',result,'reused',false);
end $$;
create or replace function public.claim_dynamic_hook(p_project_id uuid,p_id uuid,p_worker text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_hook_operations;stamp timestamptz;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into op from public.dynamic_hook_operations where id=p_id and project_id=p_project_id for update;stamp:=clock_timestamp();
 if not found or op.state<>'queued' or op.created_at+interval '90 seconds'<=stamp then return null;end if;
 if op.actor_id<>auth.uid() then raise insufficient_privilege;end if;
 if p_token is null or p_worker is null or length(p_worker) not between 1 and 128 then raise exception 'Worker required';end if;
 op.payload:=op.payload||jsonb_build_object('state','running','updatedAt',stamp,'lease',jsonb_build_object('workerId',p_worker,'heartbeatAt',stamp,'expiresAt',stamp+interval '90 seconds'));
 update public.dynamic_hook_operations set state='running',payload=op.payload,lease_token=p_token,worker_id=p_worker,heartbeat_at=stamp,expires_at=stamp+interval '90 seconds' where id=p_id;return op.payload;
end $$;
create or replace function public.heartbeat_dynamic_hook(p_project_id uuid,p_id uuid,p_worker text,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare op public.dynamic_hook_operations;stamp timestamptz;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_hook_operations where id=p_id and project_id=p_project_id for update;stamp:=clock_timestamp();
 if not found or op.state<>'running' or op.actor_id<>auth.uid() or op.worker_id is distinct from p_worker or op.lease_token is distinct from p_token or op.expires_at<=stamp or coalesce((op.payload->>'cancelRequested')::boolean,false) then return false;end if;
 op.payload:=jsonb_set(op.payload,'{lease}',jsonb_build_object('workerId',p_worker,'heartbeatAt',stamp,'expiresAt',stamp+interval '90 seconds'));
 update public.dynamic_hook_operations set payload=op.payload,heartbeat_at=stamp,expires_at=stamp+interval '90 seconds' where id=p_id;return true;
end $$;
create or replace function public.finish_dynamic_hook(p_project_id uuid,p_id uuid,p_token uuid,p_state text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_hook_operations;stamp timestamptz;result jsonb;successful boolean;profile_version integer;operation_note text;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_hook_operations where id=p_id and project_id=p_project_id for update;stamp:=clock_timestamp();
 if not found or op.state<>'running' or op.actor_id<>auth.uid() or op.lease_token is distinct from p_token or op.expires_at<=stamp then return null;end if;
 if p_state not in ('completed','blocked','cancelled') or p_result->>'outcome' not in ('passed','failed','cancelled','timeout','output_limit','runner_error') then raise exception 'Invalid hook completion';end if;
 if coalesce((op.payload->>'cancelRequested')::boolean,false) then p_state:='cancelled';p_result:=p_result||jsonb_build_object('outcome','cancelled');end if;
 successful:=p_state='completed' and p_result->>'outcome'='passed';profile_version:=(op.payload->'environment'->>'version')::integer;
 result:=op.payload||jsonb_build_object('state',p_state,'verdict',case when p_state='completed' then case when successful then 'passed' else 'failed' end else 'not_tested' end,'result',p_result,'updatedAt',stamp);
 update public.dynamic_hook_operations set state=p_state,payload=result,lease_token=null where id=p_id;
 operation_note:='Approved '||op.kind||' script '||(op.payload->'command'->>'script')||' ended: '||(p_result->>'outcome')||'. Exit code: '||coalesce(p_result->>'exitCode','unavailable')||'.';
 insert into public.dynamic_environment_events(project_id,profile_id,run_id,kind,outcome,note,actor_id) select op.project_id,op.profile_id,run_id,case when op.kind='setup' then 'preparation' else 'cleanup' end,case when successful then 'completed' else 'failed' end,operation_note,auth.uid() from public.dynamic_environment_data where profile_id=op.profile_id and operation_id=p_id;
 update public.dynamic_environment_data set state=case when successful then case when op.kind='setup' then 'ready' else 'unprepared' end else 'cleanup_required' end,
 prepared_version=case when successful and op.kind='setup' then profile_version else null end,
 preparation=case when successful and op.kind='setup' then jsonb_build_object('note',operation_note,'actorId',auth.uid(),'at',stamp,'profileVersion',profile_version,'operationId',p_id) else null end,
 operation_id=case when successful then null else operation_id end,run_id=case when successful then null else run_id end where profile_id=op.profile_id and operation_id=p_id;
 return result;
end $$;
create or replace function public.cancel_dynamic_hook(p_project_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.dynamic_hook_operations;result jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into op from public.dynamic_hook_operations where id=p_id and project_id=p_project_id for update;if not found then raise no_data_found;end if;
 if op.state not in ('queued','running') then return op.payload;end if;
 if op.state='running' then
  result:=op.payload||jsonb_build_object('cancelRequested',true,'reason','Stop requested; waiting for the executing worker to acknowledge termination.','updatedAt',clock_timestamp());
  update public.dynamic_hook_operations set payload=result where id=p_id;return result;
 end if;
 result:=op.payload||jsonb_build_object('state','cancelled','verdict','not_tested','reason','Cancelled by a project member; inspect partial output and clean the environment before reuse.','updatedAt',clock_timestamp());
 update public.dynamic_hook_operations set state='cancelled',payload=result,lease_token=null where id=p_id;
 update public.dynamic_environment_data set state='cleanup_required' where operation_id=p_id;return result;
end $$;
revoke all on function public.recover_dynamic_hooks(uuid) from public;
revoke all on function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) from public;
revoke all on function public.claim_dynamic_hook(uuid,uuid,text,uuid) from public;
revoke all on function public.heartbeat_dynamic_hook(uuid,uuid,text,uuid) from public;
revoke all on function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) from public;
revoke all on function public.cancel_dynamic_hook(uuid,uuid) from public;
grant execute on function public.recover_dynamic_hooks(uuid) to authenticated;
grant execute on function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.claim_dynamic_hook(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.heartbeat_dynamic_hook(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.cancel_dynamic_hook(uuid,uuid) to authenticated;

create or replace function public.read_dynamic_environment_data(p_project_id uuid,p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data; profile public.dynamic_environments; result jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 perform public.recover_dynamic_hooks(p_project_id);
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 if not found then raise no_data_found; end if;
 insert into public.dynamic_environment_data(profile_id,project_id) values(p_profile_id,p_project_id) on conflict do nothing;
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if row_data.state='in_use' and exists(select 1 from public.dynamic_runs where id=row_data.run_id and state not in ('queued','running')) then
  update public.dynamic_environment_data set state='cleanup_required' where profile_id=p_profile_id;row_data.state:='cleanup_required';
 end if;
 if row_data.state='ready' and row_data.prepared_version<>profile.version then
  update public.dynamic_environment_data set state='unprepared' where profile_id=p_profile_id;row_data.state:='unprepared';
 end if;
 result:=jsonb_build_object('profileId',p_profile_id,'state',row_data.state,'preparedVersion',row_data.prepared_version,'preparation',row_data.preparation,'runId',row_data.run_id,'operationId',row_data.operation_id,
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'runId',run_id,'kind',kind,'outcome',outcome,'note',note,'actorId',actor_id,'createdAt',created_at) order by created_at desc) from public.dynamic_environment_events where profile_id=p_profile_id),'[]'::jsonb));
 return result;
end $$;
create or replace function public.record_dynamic_environment_data(p_project_id uuid,p_profile_id uuid,p_kind text,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data; profile public.dynamic_environments; prepared_snapshot jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 if p_kind not in ('preparation','cleanup') or p_outcome not in ('completed','failed') or p_note is null or length(btrim(p_note)) not between 3 and 2000 then raise exception 'Record a bounded preparation/cleanup note'; end if;
 perform public.read_dynamic_environment_data(p_project_id,p_profile_id);
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if row_data.state in ('in_use','preparing','cleaning') then raise exception 'Run is still active'; end if;
 if p_kind='preparation' and row_data.state='cleanup_required' then raise exception 'Complete cleanup before preparation'; end if;
 if p_kind='cleanup' and row_data.state<>'cleanup_required' then raise exception 'No completed run needs cleanup'; end if;
 insert into public.dynamic_environment_events(project_id,profile_id,run_id,kind,outcome,note,actor_id) values(p_project_id,p_profile_id,case when p_kind='cleanup' then row_data.run_id else null end,p_kind,p_outcome,btrim(p_note),auth.uid());
 if p_kind='preparation' then
  prepared_snapshot:=jsonb_build_object('note',btrim(p_note),'actorId',auth.uid(),'at',clock_timestamp(),'profileVersion',profile.version);
  update public.dynamic_environment_data set state=case when p_outcome='completed' then 'ready' else 'unprepared' end,prepared_version=profile.version,preparation=prepared_snapshot,operation_id=null,run_id=null where profile_id=p_profile_id;
 elsif p_outcome='completed' then
  update public.dynamic_environment_data set state='unprepared',prepared_version=null,preparation=null,operation_id=null,run_id=null where profile_id=p_profile_id;
 end if;
 return public.read_dynamic_environment_data(p_project_id,p_profile_id);
end $$;

create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;profile public.dynamic_environments;fresh_run_id uuid;data_state jsonb;snapshot jsonb;can_execute boolean;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 perform public.recover_dynamic_hooks(p_project_id);
 result:=public.start_dynamic_run(p_project_id,p_actor_id,p_revision_id,p_key);fresh_run_id:=(result->'run'->>'id')::uuid;
 if result->>'reused'='true' then
  if result->'run'->'environment'->>'id' is distinct from p_environment->>'id' then raise exception 'Idempotency environment conflict'; end if;
  return result;
 end if;
 select * into profile from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id for update;
 if not found or profile.version<>(p_environment->>'version')::integer then raise exception 'Environment changed; repeat preflight'; end if;
 data_state:=public.read_dynamic_environment_data(p_project_id,profile.id);
 can_execute:=jsonb_typeof(p_environment->'preflight')='array' and jsonb_array_length(p_environment->'preflight')>0 and not exists(select 1 from jsonb_array_elements(p_environment->'preflight') check_row where check_row->>'ready' is distinct from 'true');
 if can_execute then
  if data_state->>'state'<>'ready' then raise exception 'Prepare clean data before execution'; end if;
  update public.dynamic_environment_data set state='in_use',run_id=fresh_run_id where profile_id=profile.id;
 end if;
 snapshot:=profile.payload||jsonb_build_object('variableNames',p_environment->'variableNames','preflight',p_environment->'preflight','checkedAt',p_environment->'checkedAt','preparation',data_state->'preparation');
 result:=jsonb_set(result,'{run,environment}',snapshot);update public.dynamic_runs set payload=result->'run' where id=fresh_run_id;
 return result;
end $$;

create or replace function public.start_dynamic_run(p_project_id uuid, p_actor_id uuid, p_revision_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  revision_row public.dynamic_mission_revisions;
  existing public.dynamic_runs;
  run_id uuid := gen_random_uuid();
  stamp timestamptz := now();
  result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_key is null or length(btrim(p_key)) not between 1 and 128 then raise exception 'Idempotency key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));
  select * into revision_row from public.dynamic_mission_revisions where id = p_revision_id and project_id = p_project_id;
  if not found then raise no_data_found; end if;
  select * into existing from public.dynamic_runs where project_id = p_project_id and idempotency_key = p_key;
  if found then
    if existing.revision_id <> p_revision_id or existing.payload->>'createdBy' <> p_actor_id::text then raise exception 'Idempotency conflict'; end if;
    return jsonb_build_object('run',existing.payload,'reused',true);
  end if;
  perform public.recover_dynamic_hooks(p_project_id);
  if exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and state in ('queued','running')) then raise exception 'Data operation is active'; end if;
  result := jsonb_build_object('id',run_id,'projectId',p_project_id,'missionId',revision_row.mission_id,'revision',revision_row.payload,
    'idempotencyKey',p_key,'createdBy',p_actor_id,'createdAt',stamp,'updatedAt',stamp,
    'state','queued','verdict','not_tested','reason',null,'checks','[]'::jsonb,'evidence','[]'::jsonb,'legacySessionId',null);
  insert into public.dynamic_runs(id,project_id,mission_id,revision_id,idempotency_key,state,payload,created_at)
    values(run_id,p_project_id,revision_row.mission_id,p_revision_id,p_key,'queued',result,stamp);
  return jsonb_build_object('run',result,'reused',false);
end $$;

