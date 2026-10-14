-- Explicit repeat consent; preserve historical policies and Run snapshots.
-- New Runs freeze database-owned action grants and engine versions. Old histories remain unchanged.
create or replace function public.normalize_dynamic_action_policy(p_input jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare row_input jsonb;action_input jsonb;selectors text[]:='{}';actions text[];selector_value text;rows jsonb:='[]';
begin
 if p_input is null then return '{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb;end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_input->'allowCoordinates') is distinct from 'boolean' or jsonb_typeof(p_input->'interactions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('schemaVersion','interactions','allowCoordinates')) then raise exception 'Invalid action permissions';end if;
 if jsonb_array_length(p_input->'interactions')>20 then raise exception 'Too many action grants';end if;
 for row_input in select value from jsonb_array_elements(p_input->'interactions') loop
  if jsonb_typeof(row_input) is distinct from 'object' or jsonb_typeof(row_input->'selector') is distinct from 'string' or jsonb_typeof(row_input->'actions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(row_input) k where k not in ('selector','actions','repeatable')) then raise exception 'Invalid control grant';end if;
  selector_value:=btrim(row_input->>'selector');
  if length(selector_value) not between 1 and 500 or length(row_input->>'selector')>500 or selector_value=any(selectors) or jsonb_array_length(row_input->'actions') not between 1 and 4 then raise exception 'Invalid or duplicate control grant';end if;
  selectors:=array_append(selectors,selector_value);actions:='{}';
  for action_input in select value from jsonb_array_elements(row_input->'actions') loop
   if jsonb_typeof(action_input) is distinct from 'string' or action_input#>>'{}' not in ('click','type','select_option','set_checked') or action_input#>>'{}'=any(actions) then raise exception 'Unsupported or duplicate action';end if;
   actions:=array_append(actions,action_input#>>'{}');
  end loop;
  if row_input ? 'repeatable' and (jsonb_typeof(row_input->'repeatable') is distinct from 'boolean' or not ('click'=any(actions))) then raise exception 'Repeat consent requires an approved click action';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('selector',selector_value,'actions',to_jsonb(actions))||case when row_input ? 'repeatable' then jsonb_build_object('repeatable',row_input->'repeatable') else '{}'::jsonb end);
 end loop;
 return jsonb_build_object('schemaVersion',1,'interactions',rows,'allowCoordinates',p_input->'allowCoordinates');
end $$;
revoke all on function public.normalize_dynamic_action_policy(jsonb) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_repeat_guard_version(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_repeat_guard_version;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_repeat_guard_version(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_repeat_guard_version;end if;
end $$;
revoke all on function public.start_dynamic_run_without_repeat_guard_version(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_repeat_guard_version(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_repeat_guard_version(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,planner}','2'::jsonb);
 result:=jsonb_set(result,'{run,executionVersions,policy}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,executor}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_repeat_guard_version(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,planner}','2'::jsonb);
 result:=jsonb_set(result,'{run,executionVersions,policy}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,executor}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
