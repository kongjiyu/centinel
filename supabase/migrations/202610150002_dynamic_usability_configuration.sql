-- Optional, explicitly selected usability perspective/rules. No historical rewrites.
create or replace function public.validate_dynamic_usability(p_config jsonb,p_checks jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare rule jsonb;ids jsonb;ref jsonb;field text;
begin
 if jsonb_typeof(p_config) is distinct from 'object' or p_config->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_config->'persona') is distinct from 'string' or p_config->>'persona' not in ('first_time','keyboard_only','returning') then raise exception 'Supported usability configuration required';end if;
 if exists(select 1 from jsonb_object_keys(p_config) k where k not in ('schemaVersion','persona','rules','feedbackCheckIds','errorRecoveryCheckIds')) then raise exception 'Unsupported usability field';end if;
 if jsonb_typeof(p_config->'rules') is distinct from 'array' then raise exception 'Usability rules required';end if;
 if jsonb_array_length(p_config->'rules') not between 1 and 5 or (select count(distinct value) from jsonb_array_elements(p_config->'rules'))<>jsonb_array_length(p_config->'rules') then raise exception 'Unique bounded usability rules required';end if;
 for rule in select value from jsonb_array_elements(p_config->'rules') loop
  if jsonb_typeof(rule) is distinct from 'string' or rule #>> '{}' not in ('labels','keyboard','focus','feedback','error_recovery') then raise exception 'Unsupported usability rule';end if;
 end loop;
 foreach field in array array['feedbackCheckIds','errorRecoveryCheckIds'] loop
  ids:=p_config->field;
  if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Explicit usability check references required';end if;
  if jsonb_array_length(ids)>20 or (select count(distinct value) from jsonb_array_elements(ids))<>jsonb_array_length(ids) then raise exception 'Unique bounded usability references required';end if;
  for ref in select value from jsonb_array_elements(ids) loop
   if jsonb_typeof(ref) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(p_checks) c where c->'id'=ref) then raise exception 'Usability references unknown check';end if;
   if field='feedbackCheckIds' and (p_config->'rules') ? 'feedback' and not exists(select 1 from jsonb_array_elements(p_checks) c where c->'id'=ref and c->>'kind' in ('visible_text','element_visible')) then raise exception 'Feedback needs a visible text or element check';end if;
  end loop;
  if ((field='feedbackCheckIds' and (p_config->'rules') ? 'feedback') or (field='errorRecoveryCheckIds' and (p_config->'rules') ? 'error_recovery')) and jsonb_array_length(ids)=0 then raise exception 'Selected rule needs explicit check references';end if;
 end loop;
end $$;
revoke all on function public.validate_dynamic_usability(jsonb,jsonb) from public,anon,authenticated;

do $$begin
 if to_regprocedure('public.save_dynamic_revision_without_usability(uuid,uuid,jsonb,uuid)') is null then alter function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) rename to save_dynamic_revision_without_usability;end if;
end $$;
revoke all on function public.save_dynamic_revision_without_usability(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_revision(p_project_id uuid,p_actor_id uuid,p_input jsonb,p_mission_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 -- Delegate authentication, membership and existing revision/criteria validation.
 result:=public.save_dynamic_revision_without_usability(p_project_id,p_actor_id,p_input,p_mission_id);
 if p_input ? 'usability' then
  perform public.validate_dynamic_usability(p_input->'usability',result->'checks');
  result:=result||jsonb_build_object('usability',p_input->'usability');
  update public.dynamic_mission_revisions set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;
 end if;
 return result;
end $$;
revoke all on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) to authenticated;

-- Version fresh Runs only. Reused requests and historical records stay immutable.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_usability_version(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_usability_version;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_usability_version(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_usability_version;end if;
end $$;
revoke all on function public.start_dynamic_run_without_usability_version(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_usability_version(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_usability_version(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' or not (result->'run'->'revision') ? 'usability' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,usability}','1'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_usability_version(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' or not (result->'run'->'revision') ? 'usability' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,usability}','1'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
