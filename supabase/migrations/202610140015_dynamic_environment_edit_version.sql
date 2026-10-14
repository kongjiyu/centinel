-- Version-aware editor saves cannot overwrite newer file permissions. Legacy
-- callers without an expected version keep their existing save contract.
do $$begin
 if to_regprocedure('public.save_dynamic_environment_without_edit_version(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_edit_version;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_edit_version(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_version integer;expected numeric;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 if p_input ? '_expectedVersion' then
  if p_id is null or jsonb_typeof(p_input->'_expectedVersion') is distinct from 'number' then raise exception 'Invalid expected environment version';end if;
  expected:=(p_input->>'_expectedVersion')::numeric;
  if expected not between 1 and 2147483647 or expected<>trunc(expected) then raise exception 'Invalid expected environment version';end if;
  select version into current_version from public.dynamic_environments where id=p_id and project_id=p_project_id for update;
  if not found then raise no_data_found;end if;
  if current_version<>expected then raise exception 'Environment version changed';end if;
 end if;
 return public.save_dynamic_environment_without_edit_version(p_project_id,p_input,p_id);
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;
