-- Approved local variable references; no values are persisted in profile/Run JSON.
do $$begin
 if to_regprocedure('public.normalize_dynamic_action_policy_without_private_inputs(jsonb)') is null then alter function public.normalize_dynamic_action_policy(jsonb) rename to normalize_dynamic_action_policy_without_private_inputs;end if;
end $$;
revoke all on function public.normalize_dynamic_action_policy_without_private_inputs(jsonb) from public,anon,authenticated;
create or replace function public.normalize_dynamic_action_policy(p_input jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb;item jsonb;grants jsonb:='[]';keys text[]:='{}';key text;
begin
 if p_input is not null and jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid action permissions';end if;
 result:=public.normalize_dynamic_action_policy_without_private_inputs(p_input-'privateInputs');
 if p_input ? 'privateInputs' then
  if jsonb_typeof(p_input->'privateInputs') is distinct from 'array' or jsonb_array_length(p_input->'privateInputs')>10 then raise exception 'Invalid private input permissions';end if;
  for item in select value from jsonb_array_elements(p_input->'privateInputs') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('selector','variable','origin')) or jsonb_typeof(item->'selector') is distinct from 'string' or length(btrim(item->>'selector')) not between 1 and 500 or length(item->>'selector')>500 or jsonb_typeof(item->'variable') is distinct from 'string' or item->>'variable'!~'^[A-Z][A-Z0-9_]{0,63}$' or jsonb_typeof(item->'origin') is distinct from 'string' or item->>'origin'!~'^https?://[^/@?#[:space:]]+$' then raise exception 'Invalid private input grant';end if;
   key:=item->>'origin'||chr(10)||btrim(item->>'selector');if key=any(keys) then raise exception 'Duplicate private input';end if;keys:=array_append(keys,key);grants:=grants||jsonb_build_array(item||jsonb_build_object('selector',btrim(item->>'selector')));
  end loop;
  result:=result||jsonb_build_object('privateInputs',grants);
 end if;
 return result;
end $$;
revoke all on function public.normalize_dynamic_action_policy(jsonb) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.save_dynamic_environment_without_private_inputs(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_private_inputs;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_private_inputs(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare policy jsonb;item jsonb;
begin
 policy:=public.normalize_dynamic_action_policy(p_input->'actionPolicy');
 for item in select value from jsonb_array_elements(coalesce(policy->'privateInputs','[]')) loop
  if not coalesce((p_input->'allowedOrigins') ? (item->>'origin'),false) or not coalesce((p_input->'requiredVariables') ? (item->>'variable'),false) then raise exception 'Private input needs an approved origin and required variable';end if;
 end loop;
 return public.save_dynamic_environment_without_private_inputs(p_project_id,p_input,p_id);
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;
create or replace function public.save_dynamic_private_inputs(p_project_id uuid,p_profile_id uuid,p_version integer,p_grants jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_profile jsonb;policy jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select payload into current_profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;if not found then raise no_data_found;end if;
 if p_version is null or (current_profile->>'version')::integer<>p_version then raise exception 'Environment version changed';end if;
 policy:=coalesce(current_profile->'actionPolicy','{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb)||jsonb_build_object('privateInputs',p_grants);
 return public.save_dynamic_environment(p_project_id,current_profile||jsonb_build_object('actionPolicy',public.normalize_dynamic_action_policy(policy)),p_profile_id);
end $$;
revoke all on function public.save_dynamic_private_inputs(uuid,uuid,integer,jsonb) from public;
grant execute on function public.save_dynamic_private_inputs(uuid,uuid,integer,jsonb) to authenticated;
-- Record local-reference input protocol on fresh Runs only.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_private_input_protocol(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_private_input_protocol;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_private_input_protocol(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_private_input_protocol;end if;
end $$;
revoke all on function public.start_dynamic_run_without_private_input_protocol(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_private_input_protocol(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_private_input_protocol(p_project_id,p_actor_id,p_revision_id,p_key);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,privateInputs}','1'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_private_input_protocol(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,privateInputs}','1'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
create or replace function public.checkpoint_dynamic_exploration(p_project_id uuid,p_run_id uuid,p_worker_id text,p_token uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs;l public.dynamic_run_leases;item jsonb;state_ids text[]:='{}';state_id text;control jsonb;control_refs text[];action jsonb;objective jsonb;check_ids jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
 if not found or r.state<>'running' then return false;end if;
 if r.payload->>'createdBy'<>auth.uid()::text then raise insufficient_privilege;end if;
 select * into l from public.dynamic_run_leases where run_id=p_run_id and project_id=p_project_id;
 if not found or p_token is null or p_worker_id is null or l.worker_id is distinct from p_worker_id or l.lease_token is distinct from p_token or l.expires_at<=clock_timestamp() then return false;end if;
 if r.payload->'revision'->>'mode' is distinct from 'exploratory' then raise exception 'Run is not exploratory';end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->'schemaVersion' is distinct from '1'::jsonb or p_snapshot->>'mode' is distinct from 'exploratory' or p_snapshot->'exhaustive' is distinct from 'false'::jsonb or octet_length(p_snapshot::text)>800000 then raise exception 'Invalid or oversized exploratory scope';end if;
 if exists(select 1 from jsonb_object_keys(p_snapshot) k where k not in ('schemaVersion','mode','objectives','states','actions','unvisitedControls','unresolvedControls','unresolvedTargetActions','limits','truncated','exhaustive','limitations')) then raise exception 'Unsupported scope field';end if;
 if jsonb_typeof(p_snapshot->'states') is distinct from 'array' or jsonb_typeof(p_snapshot->'actions') is distinct from 'array' or jsonb_typeof(p_snapshot->'objectives') is distinct from 'array' or jsonb_typeof(p_snapshot->'unvisitedControls') is distinct from 'array' or jsonb_typeof(p_snapshot->'unresolvedControls') is distinct from 'array' or jsonb_typeof(p_snapshot->'limitations') is distinct from 'array' then raise exception 'Scope arrays required';end if;
 if jsonb_array_length(p_snapshot->'states')>51 or jsonb_array_length(p_snapshot->'actions')>25 or jsonb_array_length(p_snapshot->'objectives')>20 or jsonb_array_length(p_snapshot->'unvisitedControls')>2040 or jsonb_array_length(p_snapshot->'unresolvedControls')>2040 or jsonb_array_length(p_snapshot->'limitations')>10 or p_snapshot->'limits' is distinct from '{"maxStates":51,"maxActions":25}'::jsonb or jsonb_typeof(p_snapshot->'truncated') is distinct from 'boolean' then raise exception 'Scope bounds exceeded';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'states') loop
  state_id:=item->>'id';if state_id is null or state_id!~'^[a-f0-9]{64}$' or state_id=any(state_ids) or not coalesce(public.dynamic_context_text(item->'url',2000),false) or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title')>500 or jsonb_typeof(item->'controls') is distinct from 'array' or jsonb_typeof(item->'visits') is distinct from 'number' or jsonb_typeof(item->'omittedControls') is distinct from 'boolean' then raise exception 'Invalid sampled state';end if;
  if (item->>'visits')::numeric<>trunc((item->>'visits')::numeric) or (item->>'visits')::numeric not between 1 and 100 or jsonb_array_length(item->'controls')>40 then raise exception 'State bounds exceeded';end if;
  state_ids:=array_append(state_ids,state_id);control_refs:='{}';
  for control in select value from jsonb_array_elements(item->'controls') loop
   if control->>'ref' is null or control->>'ref'!~'^e[0-9]{1,2}$' or control->>'ref'=any(control_refs) or not coalesce(public.dynamic_context_text(control->'role',1000),false) or jsonb_typeof(control->'name') is distinct from 'string' or length(control->>'name')>250 or control ? 'selector' and not coalesce(public.dynamic_context_text(control->'selector',2000),false) or exists(select 1 from jsonb_object_keys(control) k where k not in ('ref','role','name','selector')) then raise exception 'Invalid sampled control';end if;control_refs:=array_append(control_refs,control->>'ref');
  end loop;
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('id','url','title','visits','omittedControls','controls')) then raise exception 'Unsupported state field';end if;
 end loop;
 for action in select value from jsonb_array_elements(p_snapshot->'actions') loop
  if not coalesce(action->>'beforeStateId'=any(state_ids),false) or action ? 'afterStateId' and not coalesce(action->>'afterStateId'=any(state_ids),false) or coalesce(action->>'status','') not in ('dispatched','skipped','blocked','unavailable','uncertain') or coalesce(action->>'action','') not in ('click','type','select_option','set_checked','upload_file','download_file','type_secret','press_key','scroll','wait','navigate','assert_visible') or jsonb_typeof(action->'step') is distinct from 'number' then raise exception 'Invalid exploratory action';end if;
  if (action->>'step')::numeric<>trunc((action->>'step')::numeric) or (action->>'step')::numeric not between 0 and 24 then raise exception 'Invalid action step';end if;
  if action ? 'targetRef' and not exists(select 1 from jsonb_array_elements(p_snapshot->'states') s cross join lateral jsonb_array_elements(s->'controls') c where s->>'id'=action->>'beforeStateId' and c->>'ref'=action->>'targetRef') then raise exception 'Dangling target reference';end if;
  if exists(select 1 from jsonb_object_keys(action) k where k not in ('step','action','beforeStateId','afterStateId','targetRef','status')) then raise exception 'Unsupported action field';end if;
 end loop;
 for item in select value from jsonb_array_elements((p_snapshot->'unvisitedControls')||(p_snapshot->'unresolvedControls')) loop
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'states') s cross join lateral jsonb_array_elements(s->'controls') c where s->>'id'=item->>'stateId' and c->>'ref'=item->>'ref') or exists(select 1 from jsonb_object_keys(item) k where k not in ('stateId','ref')) then raise exception 'Dangling scope reference';end if;
 end loop;
 -- Objectives are selected from the frozen checks, never supplied by a planner.
 select coalesce(jsonb_agg(jsonb_build_object('criterionId',criterion,'checkIds',ids,'verdict','not_tested')),'[]') into check_ids from (select c->>'criterionId' criterion,jsonb_agg(c->'id') ids from jsonb_array_elements(r.payload->'revision'->'checks') c group by c->>'criterionId') grouped;
 for objective in select value from jsonb_array_elements(p_snapshot->'objectives') loop
  if exists(select 1 from jsonb_object_keys(objective) k where k not in ('criterionId','checkIds','verdict')) or jsonb_typeof(objective->'checkIds') is distinct from 'array' then raise exception 'Invalid selected objective';end if;
  if objective->>'verdict' is distinct from 'not_tested' or not exists(select 1 from jsonb_array_elements(check_ids) selected where selected->>'criterionId'=objective->>'criterionId' and jsonb_array_length(selected->'checkIds')=jsonb_array_length(objective->'checkIds') and (selected->'checkIds') @> (objective->'checkIds') and (objective->'checkIds') @> (selected->'checkIds')) then raise exception 'Unverified or invented objective';end if;
 end loop;
 if (select count(distinct o->>'criterionId') from jsonb_array_elements(p_snapshot->'objectives') o)<>jsonb_array_length(p_snapshot->'objectives') then raise exception 'Duplicate selected objective';end if;
 if jsonb_array_length(p_snapshot->'objectives')<>jsonb_array_length(check_ids) then raise exception 'Incomplete selected objectives';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'limitations') loop if not coalesce(public.dynamic_context_text(item,2000),false) then raise exception 'Invalid scope limitation';end if;end loop;
 if jsonb_typeof(p_snapshot->'unresolvedTargetActions') is distinct from 'number' or ((p_snapshot->>'unresolvedTargetActions')::numeric not between 0 and 25 or (p_snapshot->>'unresolvedTargetActions')::numeric<>trunc((p_snapshot->>'unresolvedTargetActions')::numeric)) then raise exception 'Invalid unresolved count';end if;
 update public.dynamic_runs set payload=jsonb_set(r.payload,'{exploration}',p_snapshot) where id=p_run_id and project_id=p_project_id;return true;
end $$;
revoke all on function public.checkpoint_dynamic_exploration(uuid,uuid,text,uuid,jsonb) from public;
grant execute on function public.checkpoint_dynamic_exploration(uuid,uuid,text,uuid,jsonb) to authenticated;



