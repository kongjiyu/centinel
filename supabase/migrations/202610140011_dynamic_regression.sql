-- New regression Runs pin a completed baseline and its immutable revision.
-- Current execution still goes through existing environment/data/session guards.
create or replace function public.start_dynamic_regression_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_baseline_id uuid,p_environment jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare baseline public.dynamic_runs;existing public.dynamic_runs;result jsonb;snapshot jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select * into existing from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key;
 if found then
  if existing.payload->'regression'->>'runId' is distinct from p_baseline_id::text or existing.revision_id is distinct from p_revision_id or existing.payload->>'createdBy' is distinct from p_actor_id::text or existing.payload->'environment'->>'id' is distinct from p_environment->>'id' then raise exception 'Idempotency regression conflict';end if;
  return jsonb_build_object('run',existing.payload,'reused',true);
 end if;
 select * into baseline from public.dynamic_runs where id=p_baseline_id and project_id=p_project_id for share;
 if not found then raise no_data_found;end if;
 if baseline.state<>'completed' or baseline.revision_id<>p_revision_id or jsonb_typeof(baseline.payload->'checks') is distinct from 'array' or jsonb_typeof(baseline.payload->'evidence') is distinct from 'array' then raise exception 'Completed baseline with pinned checks required';end if;
 if jsonb_array_length(baseline.payload->'checks')=0 or jsonb_array_length(baseline.payload->'evidence')=0 then raise exception 'Retained baseline observations required';end if;
 if p_environment is null or p_environment='null'::jsonb then result:=public.start_dynamic_run(p_project_id,p_actor_id,p_revision_id,p_key);else result:=public.start_dynamic_environment_run(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);end if;
 if result->>'reused'='true' then raise exception 'Regression request raced a different request';end if;
 snapshot:=jsonb_build_object('schemaVersion',1,'runId',baseline.id,'revisionId',baseline.revision_id,'createdAt',baseline.payload->'createdAt','createdBy',baseline.payload->'createdBy','verdict',baseline.payload->'verdict','targetUrl',coalesce(baseline.payload->'environment'->'targetUrl',baseline.payload->'revision'->'targetUrl'),'environment',coalesce(baseline.payload->'environment','null'::jsonb),'checks',baseline.payload->'checks','evidence',baseline.payload->'evidence');
 if baseline.payload ? 'executionVersions' then snapshot:=snapshot||jsonb_build_object('executionVersions',baseline.payload->'executionVersions');end if;
 if baseline.payload ? 'actionPolicy' then snapshot:=snapshot||jsonb_build_object('actionPolicy',baseline.payload->'actionPolicy');end if;
 if baseline.payload ? 'executionBudget' then snapshot:=snapshot||jsonb_build_object('executionBudget',baseline.payload->'executionBudget');end if;
 result:=jsonb_set(result,'{run,regression}',snapshot);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
revoke all on function public.start_dynamic_regression_run(uuid,uuid,uuid,text,uuid,jsonb) from public;
grant execute on function public.start_dynamic_regression_run(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;
