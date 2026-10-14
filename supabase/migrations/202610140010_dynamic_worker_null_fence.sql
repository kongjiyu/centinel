-- SQL NULL comparisons must not bypass an existing private worker credential.
do $$begin
 if to_regprocedure('public.heartbeat_dynamic_run_without_null_fence(uuid,uuid,text,uuid)') is null then alter function public.heartbeat_dynamic_run(uuid,uuid,text,uuid) rename to heartbeat_dynamic_run_without_null_fence;end if;
 if to_regprocedure('public.transition_dynamic_run_without_null_fence(uuid,uuid,text,jsonb)') is null then alter function public.transition_dynamic_run(uuid,uuid,text,jsonb) rename to transition_dynamic_run_without_null_fence;end if;
end $$;
revoke all on function public.heartbeat_dynamic_run_without_null_fence(uuid,uuid,text,uuid),public.transition_dynamic_run_without_null_fence(uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.heartbeat_dynamic_run(p_project_id uuid,p_run_id uuid,p_worker_id text,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_worker_id is null or p_token is null then return false;end if;
 return public.heartbeat_dynamic_run_without_null_fence(p_project_id,p_run_id,p_worker_id,p_token);
end $$;
create or replace function public.transition_dynamic_run(p_project_id uuid,p_run_id uuid,p_expected text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_expected='running' and p_patch->>'state' is distinct from 'cancelled' then
  select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
  if found and r.state='running' then
   if r.payload->>'createdBy'<>auth.uid()::text then raise insufficient_privilege;end if;
   if exists(select 1 from public.dynamic_run_leases where run_id=p_run_id and project_id=p_project_id) and p_patch->>'leaseToken' is null then return null;end if;
  end if;
 end if;
 return public.transition_dynamic_run_without_null_fence(p_project_id,p_run_id,p_expected,p_patch);
end $$;
revoke all on function public.heartbeat_dynamic_run(uuid,uuid,text,uuid),public.transition_dynamic_run(uuid,uuid,text,jsonb) from public;
grant execute on function public.heartbeat_dynamic_run(uuid,uuid,text,uuid),public.transition_dynamic_run(uuid,uuid,text,jsonb) to authenticated;
