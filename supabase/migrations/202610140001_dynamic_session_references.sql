-- Add optional reference-only authentication metadata. Existing profiles stay compatible.
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
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
 if jsonb_typeof(result->'requiredVariables')<>'array' or jsonb_typeof(result->'allowedOrigins')<>'array' or length(result->>'name') not between 1 and 120 then raise exception 'Invalid environment'; end if;
 insert into public.dynamic_environments(id,project_id,payload,version,updated_at) values(env_id,p_project_id,result,current_version,stamp)
 on conflict(id) do update set payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at;
 return result;
end $$;

revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;

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
 if profile.payload->>'sessionReference' is not null and p_environment->'sessionSnapshot' is not null then
  if p_environment->'sessionSnapshot'->>'reference' is distinct from profile.payload->>'sessionReference' or jsonb_typeof(p_environment->'sessionSnapshot'->'version') is distinct from 'string' or p_environment->'sessionSnapshot'->>'version' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_environment->'sessionSnapshot'->'expiresAt') is distinct from 'string' then raise exception 'Invalid session snapshot';end if;
  if (p_environment->'sessionSnapshot'->>'expiresAt')::timestamptz<=clock_timestamp() or (p_environment->'sessionSnapshot'->>'expiresAt')::timestamptz>clock_timestamp()+interval '7 days' then raise exception 'Session snapshot expired or unbounded';end if;
  snapshot:=snapshot||jsonb_build_object('sessionSnapshot',jsonb_build_object('reference',profile.payload->'sessionReference','version',p_environment->'sessionSnapshot'->'version','expiresAt',p_environment->'sessionSnapshot'->'expiresAt'));
 end if;
 result:=jsonb_set(result,'{run,environment}',snapshot);update public.dynamic_runs set payload=result->'run' where id=fresh_run_id;
 return result;
end $$;


revoke all on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
