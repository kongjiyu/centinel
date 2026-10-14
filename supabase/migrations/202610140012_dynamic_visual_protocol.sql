-- Identify explicit viewport visual-action protocol on fresh Runs only.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_visual_protocol(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_visual_protocol;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_visual_protocol(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_visual_protocol;end if;
end $$;
revoke all on function public.start_dynamic_run_without_visual_protocol(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_visual_protocol(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_visual_protocol(p_project_id,p_actor_id,p_revision_id,p_key);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,visual}','1'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_visual_protocol(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,visual}','1'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
