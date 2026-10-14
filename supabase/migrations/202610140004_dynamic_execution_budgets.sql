-- Freeze sanitized limits; preserve existing snapshots and data/session guards.
create or replace function public.normalize_dynamic_execution_budget(p_input jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb:='{"runtimeMs":300000,"maxSteps":25,"maxModelCalls":100,"maxObservationChars":32000,"maxConsoleBytes":262144}';item record;minimum bigint;maximum bigint;number_value numeric;
begin
 if p_input is null then return result;end if;
 if jsonb_typeof(p_input)<>'object' then raise exception 'Execution limits must be an object';end if;
 for item in select * from jsonb_each(p_input) loop
  case item.key
   when 'runtimeMs' then minimum:=1000;maximum:=300000;
   when 'maxSteps' then minimum:=1;maximum:=25;
   when 'maxModelCalls' then minimum:=1;maximum:=100;
   when 'maxObservationChars' then minimum:=256;maximum:=32000;
   when 'maxConsoleBytes' then minimum:=1024;maximum:=262144;
   when 'maxAccountedTokens' then minimum:=1;maximum:=1000000;
   else raise exception 'Unsupported execution limit';
  end case;
  if jsonb_typeof(item.value)<>'number' then raise exception 'Execution limits must be integers';end if;
  number_value:=item.value::text::numeric;
  if number_value<>trunc(number_value) or number_value<minimum or number_value>maximum then raise exception 'Execution limit outside supported bounds';end if;
  result:=result||jsonb_build_object(item.key,number_value::bigint);
 end loop;
 return result;
end $$;
revoke all on function public.normalize_dynamic_execution_budget(jsonb) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.save_dynamic_environment_without_budget_validation(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment_without_session_guard(uuid,jsonb,uuid) rename to save_dynamic_environment_without_budget_validation;end if;
 if to_regprocedure('public.start_dynamic_run_without_budget_snapshot(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_budget_snapshot;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_budget_snapshot(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_budget_snapshot;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_budget_validation(uuid,jsonb,uuid),public.start_dynamic_run_without_budget_snapshot(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_budget_snapshot(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.save_dynamic_environment_without_session_guard(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;limits jsonb;
begin
 limits:=public.normalize_dynamic_execution_budget(p_input->'budgets');
 result:=public.save_dynamic_environment_without_budget_validation(p_project_id,p_input,p_id)||jsonb_build_object('budgets',limits);
 update public.dynamic_environments set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
revoke all on function public.save_dynamic_environment_without_session_guard(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;limits jsonb;
begin
 result:=public.start_dynamic_run_without_budget_snapshot(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' then return result;end if;
 limits:=public.normalize_dynamic_execution_budget(null);
 limits:=jsonb_set(limits,'{maxSteps}',to_jsonb(least((limits->>'maxSteps')::integer,(result->'run'->'revision'->>'maxSteps')::integer)));
 result:=jsonb_set(result,'{run,executionBudget}',limits);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid;
 return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;limits jsonb;profile_limits jsonb;
begin
 result:=public.start_dynamic_environment_run_without_budget_snapshot(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' then return result;end if;
 select payload->'budgets' into profile_limits from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id;
 limits:=public.normalize_dynamic_execution_budget(profile_limits);
 result:=jsonb_set(result,'{run,environment,budgets}',limits);
 limits:=jsonb_set(limits,'{maxSteps}',to_jsonb(least((limits->>'maxSteps')::integer,(result->'run'->'revision'->>'maxSteps')::integer)));
 result:=jsonb_set(result,'{run,executionBudget}',limits);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid;
 return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
