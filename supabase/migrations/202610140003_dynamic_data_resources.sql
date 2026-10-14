-- Persistent project-scoped target-data reservations; no expiry declares data clean.
alter table public.dynamic_environment_data add column if not exists resource_key text;
alter table public.dynamic_environment_data add column if not exists resource_reserved boolean not null default false;
update public.dynamic_environment_data set resource_key='profile:'||profile_id::text,resource_reserved=(state<>'unprepared' or preparation is not null) where resource_key is null;
create unique index if not exists dynamic_one_resource_owner on public.dynamic_environment_data(project_id,resource_key) where resource_reserved;
create or replace function public.dynamic_resource_key(p_profile_id uuid,p_payload jsonb)
returns text language sql immutable set search_path=public as $$select case when coalesce(p_payload->>'dataResourceKey','')='' then 'profile:'||p_profile_id::text else 'shared:'||lower(p_payload->>'dataResourceKey') end$$;
create or replace function public.claim_dynamic_data_resource(p_project_id uuid,p_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare profile public.dynamic_environments;row_data public.dynamic_environment_data;wanted text;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));perform public.read_dynamic_environment_data(p_project_id,p_profile_id);
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;if not found then raise no_data_found;end if;
 wanted:=public.dynamic_resource_key(p_profile_id,profile.payload);select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if row_data.resource_reserved and row_data.resource_key is distinct from wanted then raise exception 'Clean the original data resource before changing its key';end if;
 if exists(select 1 from public.dynamic_environment_data where project_id=p_project_id and resource_key=wanted and resource_reserved and profile_id<>p_profile_id) then raise exception 'Another environment owns this data resource; finish its cleanup first';end if;
 update public.dynamic_environment_data set resource_key=wanted,resource_reserved=true where profile_id=p_profile_id;
end $$;
revoke all on function public.dynamic_resource_key(uuid,jsonb),public.claim_dynamic_data_resource(uuid,uuid) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.read_dynamic_environment_data_without_resource_info(uuid,uuid)') is null then alter function public.read_dynamic_environment_data(uuid,uuid) rename to read_dynamic_environment_data_without_resource_info;end if;
 if to_regprocedure('public.finish_dynamic_hook_without_resource_release(uuid,uuid,uuid,text,jsonb)') is null then alter function public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb) rename to finish_dynamic_hook_without_resource_release;end if;
 if to_regprocedure('public.acquire_dynamic_session_capture_without_resource_guard(uuid,uuid,uuid,uuid,text)') is null then alter function public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text) rename to acquire_dynamic_session_capture_without_resource_guard;end if;
end $$;
revoke all on function public.read_dynamic_environment_data_without_resource_info(uuid,uuid),public.finish_dynamic_hook_without_resource_release(uuid,uuid,uuid,text,jsonb),public.acquire_dynamic_session_capture_without_resource_guard(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
create or replace function public.read_dynamic_environment_data(p_project_id uuid,p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;profile public.dynamic_environments;row_data public.dynamic_environment_data;owner_data public.dynamic_environment_data;wanted text;owner_name text;
begin
 result:=public.read_dynamic_environment_data_without_resource_info(p_project_id,p_profile_id);
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id;
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id;
 wanted:=case when row_data.resource_reserved then row_data.resource_key else public.dynamic_resource_key(p_profile_id,profile.payload) end;
 select * into owner_data from public.dynamic_environment_data where project_id=p_project_id and resource_key=wanted and resource_reserved;
 if found then select payload->>'name' into owner_name from public.dynamic_environments where id=owner_data.profile_id;end if;
 return result||jsonb_build_object('resource',jsonb_build_object('key',wanted,'reserved',row_data.resource_reserved,'available',owner_data.profile_id is null or owner_data.profile_id=p_profile_id,'ownerProfileId',owner_data.profile_id,'ownerName',owner_name,'ownerState',owner_data.state));
end $$;
create or replace function public.record_dynamic_environment_data(p_project_id uuid,p_profile_id uuid,p_kind text,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;row_data public.dynamic_environment_data;
begin
 perform public.require_no_dynamic_session_capture(p_project_id);perform public.read_dynamic_environment_data(p_project_id,p_profile_id);
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if p_kind='cleanup' and not row_data.resource_reserved and row_data.state<>'cleanup_required' then raise exception 'No data reservation needs cleanup';end if;
 perform public.claim_dynamic_data_resource(p_project_id,p_profile_id);
 if p_kind='cleanup' and row_data.resource_reserved and row_data.state in ('ready','unprepared') then update public.dynamic_environment_data set state='cleanup_required' where profile_id=p_profile_id;end if;
 result:=public.record_dynamic_environment_data_without_session_guard(p_project_id,p_profile_id,p_kind,p_outcome,p_note);
 if p_kind='preparation' then
  update public.dynamic_environment_data set preparation=preparation||jsonb_build_object('resourceKey',resource_key),state=case when p_outcome='failed' then 'cleanup_required' else state end where profile_id=p_profile_id;
 elsif p_kind='cleanup' and p_outcome='completed' then update public.dynamic_environment_data set resource_reserved=false where profile_id=p_profile_id;
 end if;
 return public.read_dynamic_environment_data(p_project_id,p_profile_id);
end $$;
create or replace function public.start_dynamic_hook(p_project_id uuid,p_profile_id uuid,p_kind text,p_key text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 if exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and idempotency_key=p_key) then return public.start_dynamic_hook_without_session_guard(p_project_id,p_profile_id,p_kind,p_key,p_command);end if;
 perform public.require_no_dynamic_session_capture(p_project_id);perform public.claim_dynamic_data_resource(p_project_id,p_profile_id);
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if p_kind='cleanup' and row_data.resource_reserved and row_data.state in ('ready','unprepared') then update public.dynamic_environment_data set state='cleanup_required' where profile_id=p_profile_id;end if;
 return public.start_dynamic_hook_without_session_guard(p_project_id,p_profile_id,p_kind,p_key,p_command);
end $$;
create or replace function public.finish_dynamic_hook(p_project_id uuid,p_id uuid,p_token uuid,p_state text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.finish_dynamic_hook_without_resource_release(p_project_id,p_id,p_token,p_state,p_result);
 if result is not null and result->>'kind'='setup' and result->>'state'='completed' and result->'result'->>'outcome'='passed' then update public.dynamic_environment_data set preparation=preparation||jsonb_build_object('resourceKey',resource_key) where profile_id=(result->>'environmentId')::uuid;end if;
 if result is not null and result->>'kind'='cleanup' and result->>'state'='completed' and result->'result'->>'outcome'='passed' then update public.dynamic_environment_data set resource_reserved=false where profile_id=(result->>'environmentId')::uuid;end if;
 return result;
end $$;
create or replace function public.acquire_dynamic_session_capture(p_project_id uuid,p_profile_id uuid,p_id uuid,p_token uuid,p_worker text)
returns boolean language plpgsql security definer set search_path=public as $$begin perform public.require_no_dynamic_session_capture(p_project_id);perform public.claim_dynamic_data_resource(p_project_id,p_profile_id);return public.acquire_dynamic_session_capture_without_resource_guard(p_project_id,p_profile_id,p_id,p_token,p_worker);end $$;
create or replace function public.save_dynamic_environment_without_session_guard(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare env_id uuid:=coalesce(p_id,gen_random_uuid()); current_version integer; result jsonb; stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select version into current_version from public.dynamic_environments where id=env_id and project_id=p_project_id;
 if p_id is not null and not found then raise no_data_found; end if;
 current_version:=coalesce(current_version,0)+1;
 result:=jsonb_build_object('id',env_id,'projectId',p_project_id,'version',current_version,'updatedBy',auth.uid(),'updatedAt',stamp,
 'name',p_input->'name','targetUrl',p_input->'targetUrl','allowedOrigins',p_input->'allowedOrigins','viewport',p_input->'viewport',
 'accountRole',p_input->'accountRole','requiredVariables',p_input->'requiredVariables','startupInstructions',p_input->'startupInstructions','targetVersion',p_input->'targetVersion');
 if coalesce(p_input->>'sessionReference','')<>'' then
  if jsonb_typeof(p_input->'sessionReference') is distinct from 'string' or p_input->>'sessionReference' !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' or jsonb_typeof(p_input->'sessionReadySelector') is distinct from 'string' or length(btrim(p_input->>'sessionReadySelector')) not between 1 and 500 then raise exception 'Invalid session reference';end if;
  result:=result||jsonb_build_object('sessionReference',p_input->'sessionReference','sessionReadySelector',p_input->'sessionReadySelector');
 elsif coalesce(p_input->>'sessionReadySelector','')<>'' then raise exception 'Session reference required';end if;
 if coalesce(p_input->>'dataResourceKey','')<>'' then
  if jsonb_typeof(p_input->'dataResourceKey') is distinct from 'string' or p_input->>'dataResourceKey' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then raise exception 'Invalid data resource key';end if;
  result:=result||jsonb_build_object('dataResourceKey',lower(p_input->>'dataResourceKey'));
 end if;
 if jsonb_typeof(result->'requiredVariables')<>'array' or jsonb_typeof(result->'allowedOrigins')<>'array' or length(result->>'name') not between 1 and 120 then raise exception 'Invalid environment'; end if;
 insert into public.dynamic_environments(id,project_id,payload,version,updated_at) values(env_id,p_project_id,result,current_version,stamp)
 on conflict(id) do update set payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at;
 return result;
end $$;


create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data;
begin
 perform public.require_no_dynamic_session_capture(p_project_id);
 if p_id is not null then select * into row_data from public.dynamic_environment_data where project_id=p_project_id and profile_id=p_id for update;if found and row_data.resource_reserved and row_data.resource_key is distinct from public.dynamic_resource_key(p_id,p_input) then raise exception 'Clean the original data resource before changing its key';end if;end if;
 return public.save_dynamic_environment_without_session_guard(p_project_id,p_input,p_id);
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;profile public.dynamic_environments;fresh_run_id uuid;data_state jsonb;snapshot jsonb;can_execute boolean;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 perform public.recover_dynamic_hooks(p_project_id);
 if not exists(select 1 from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_session_capture(p_project_id);end if;
 result:=public.start_dynamic_run_without_session_guard(p_project_id,p_actor_id,p_revision_id,p_key);fresh_run_id:=(result->'run'->>'id')::uuid;
 if result->>'reused'='true' then
  if result->'run'->'environment'->>'id' is distinct from p_environment->>'id' then raise exception 'Idempotency environment conflict'; end if;
  return result;
 end if;
 select * into profile from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id for update;
 if not found or profile.version<>(p_environment->>'version')::integer then raise exception 'Environment changed; repeat preflight'; end if;
 data_state:=public.read_dynamic_environment_data(p_project_id,profile.id);
 can_execute:=jsonb_typeof(p_environment->'preflight')='array' and jsonb_array_length(p_environment->'preflight')>0 and not exists(select 1 from jsonb_array_elements(p_environment->'preflight') check_row where check_row->>'ready' is distinct from 'true');
 if can_execute then
  perform public.claim_dynamic_data_resource(p_project_id,profile.id);
  if data_state->>'state'<>'ready' then raise exception 'Prepare clean data before execution'; end if;
  update public.dynamic_environment_data set state='in_use',run_id=fresh_run_id where profile_id=profile.id;
 end if;
 snapshot:=profile.payload||jsonb_build_object('variableNames',p_environment->'variableNames','preflight',p_environment->'preflight','checkedAt',p_environment->'checkedAt','preparation',data_state->'preparation');
 if profile.payload->>'sessionReference' is not null and p_environment->'sessionSnapshot' is not null then
  if p_environment->'sessionSnapshot'->>'reference' is distinct from profile.payload->>'sessionReference' or jsonb_typeof(p_environment->'sessionSnapshot'->'version') is distinct from 'string' or p_environment->'sessionSnapshot'->>'version' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_environment->'sessionSnapshot'->'expiresAt') is distinct from 'string' then raise exception 'Invalid session snapshot';end if;
  if (p_environment->'sessionSnapshot'->>'expiresAt')::timestamptz<=clock_timestamp() or (p_environment->'sessionSnapshot'->>'expiresAt')::timestamptz>clock_timestamp()+interval '7 days' then raise exception 'Session snapshot expired or unbounded';end if;
  snapshot:=snapshot||jsonb_build_object('sessionSnapshot',jsonb_build_object('reference',profile.payload->'sessionReference','version',p_environment->'sessionSnapshot'->'version','expiresAt',p_environment->'sessionSnapshot'->'expiresAt'));
 end if;
 snapshot:=snapshot||jsonb_build_object('resourceKey',data_state->'resource'->'key');
 result:=jsonb_set(result,'{run,environment}',snapshot);update public.dynamic_runs set payload=result->'run' where id=fresh_run_id;
 return result;
end $$;



revoke all on function public.save_dynamic_environment_without_session_guard(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.read_dynamic_environment_data(uuid,uuid),public.record_dynamic_environment_data(uuid,uuid,text,text,text),public.start_dynamic_hook(uuid,uuid,text,text,jsonb),public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb),public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text),public.save_dynamic_environment(uuid,jsonb,uuid),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.read_dynamic_environment_data(uuid,uuid),public.record_dynamic_environment_data(uuid,uuid,text,text,text),public.start_dynamic_hook(uuid,uuid,text,text,jsonb),public.finish_dynamic_hook(uuid,uuid,uuid,text,jsonb),public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text),public.save_dynamic_environment(uuid,jsonb,uuid),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
create or replace function public.dynamic_target_origin(p_url text)
returns text language sql immutable set search_path=public as $$
 select parts[1]||'://'||parts[2]||case when parts[3] is null or (parts[1]='http' and parts[3]::integer=80) or (parts[1]='https' and parts[3]::integer=443) then '' else ':'||(parts[3]::integer)::text end
 from (select regexp_match(lower(p_url),'^(https?)://(?:[^@/]*@)?(\[[^]]+\]|[^:/?#]+)(?::([0-9]+))?') parts) parsed
$$;
revoke all on function public.dynamic_target_origin(text) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target_origin text;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 if not exists(select 1 from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key) then
  perform public.require_no_dynamic_session_capture(p_project_id);
  select public.dynamic_target_origin(payload->>'targetUrl') into target_origin from public.dynamic_mission_revisions where id=p_revision_id and project_id=p_project_id;
  if exists(select 1 from public.dynamic_environment_data d join public.dynamic_environments e on e.id=d.profile_id where d.project_id=p_project_id and d.resource_reserved and d.resource_key like 'shared:%' and public.dynamic_target_origin(e.payload->>'targetUrl')=target_origin) then raise exception 'Choose the saved environment for this reserved target data';end if;
 end if;
 return public.start_dynamic_run_without_session_guard(p_project_id,p_actor_id,p_revision_id,p_key);
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text) to authenticated;
