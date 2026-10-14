-- New Runs freeze database-owned action grants and engine versions. Old histories remain unchanged.
create or replace function public.normalize_dynamic_action_policy(p_input jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare row_input jsonb;action_input jsonb;selectors text[]:='{}';actions text[];selector_value text;rows jsonb:='[]';
begin
 if p_input is null then return '{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb;end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_input->'allowCoordinates') is distinct from 'boolean' or jsonb_typeof(p_input->'interactions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('schemaVersion','interactions','allowCoordinates')) then raise exception 'Invalid action permissions';end if;
 if jsonb_array_length(p_input->'interactions')>20 then raise exception 'Too many action grants';end if;
 for row_input in select value from jsonb_array_elements(p_input->'interactions') loop
  if jsonb_typeof(row_input) is distinct from 'object' or jsonb_typeof(row_input->'selector') is distinct from 'string' or jsonb_typeof(row_input->'actions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(row_input) k where k not in ('selector','actions')) then raise exception 'Invalid control grant';end if;
  selector_value:=btrim(row_input->>'selector');
  if length(selector_value) not between 1 and 500 or length(row_input->>'selector')>500 or selector_value=any(selectors) or jsonb_array_length(row_input->'actions') not between 1 and 4 then raise exception 'Invalid or duplicate control grant';end if;
  selectors:=array_append(selectors,selector_value);actions:='{}';
  for action_input in select value from jsonb_array_elements(row_input->'actions') loop
   if jsonb_typeof(action_input) is distinct from 'string' or action_input#>>'{}' not in ('click','type','select_option','set_checked') or action_input#>>'{}'=any(actions) then raise exception 'Unsupported or duplicate action';end if;
   actions:=array_append(actions,action_input#>>'{}');
  end loop;
  rows:=rows||jsonb_build_array(jsonb_build_object('selector',selector_value,'actions',to_jsonb(actions)));
 end loop;
 return jsonb_build_object('schemaVersion',1,'interactions',rows,'allowCoordinates',p_input->'allowCoordinates');
end $$;
revoke all on function public.normalize_dynamic_action_policy(jsonb) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.save_dynamic_environment_without_action_policy(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_action_policy;end if;
 if to_regprocedure('public.start_dynamic_run_without_action_policy(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_action_policy;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_action_policy(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_action_policy;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_action_policy(uuid,jsonb,uuid),public.start_dynamic_run_without_action_policy(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_action_policy(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;policy jsonb;
begin
 policy:=public.normalize_dynamic_action_policy(p_input->'actionPolicy');
 result:=public.save_dynamic_environment_without_action_policy(p_project_id,p_input,p_id)||jsonb_build_object('actionPolicy',policy);
 update public.dynamic_environments set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_action_policy(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,actionPolicy}',public.normalize_dynamic_action_policy(null));
 result:=jsonb_set(result,'{run,executionVersions}','{"observer":1,"planner":1,"policy":1,"executor":1,"checker":1}'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;policy jsonb;
begin
 result:=public.start_dynamic_environment_run_without_action_policy(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' then return result;end if;
 select public.normalize_dynamic_action_policy(payload->'actionPolicy') into policy from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id;
 if policy is null then raise no_data_found;end if;
 result:=jsonb_set(result,'{run,environment,actionPolicy}',policy);
 result:=jsonb_set(result,'{run,actionPolicy}',policy);
 result:=jsonb_set(result,'{run,executionVersions}','{"observer":1,"planner":1,"policy":1,"executor":1,"checker":1}'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid),public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid),public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
