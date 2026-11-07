-- Additive saved-test (Mission) management: rename and archive/unarchive.
-- No table or column changes: displayName/archivedAt/archivedBy live in the existing
-- dynamic_missions.payload JSON. Runs, revisions and evidence are never deleted; archive only
-- hides a saved test from the default list. Existing member-only RLS read policies still apply,
-- and authenticated users keep SELECT only; this guarded RPC is the sole new write path.
create or replace function public.update_dynamic_mission(
  p_project_id uuid,
  p_actor_id uuid,
  p_mission_id uuid,
  p_display_name text default null,
  p_clear_display_name boolean default false,
  p_archived boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  current_payload jsonb;
  result jsonb;
  stamp timestamptz := now();
  trimmed text := nullif(btrim(p_display_name), '');
begin
  if auth.uid() is null or auth.uid() <> p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_display_name is not null and (trimmed is null or length(trimmed) > 200) then raise exception 'Invalid saved test name'; end if;
  if p_display_name is null and not coalesce(p_clear_display_name, false) and p_archived is null then raise exception 'No saved test change'; end if;
  -- Same project lock as save_dynamic_revision, so currentRevisionId updates are never lost.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));
  select payload into current_payload from public.dynamic_missions where id = p_mission_id and project_id = p_project_id for update;
  if not found then raise no_data_found; end if;
  result := current_payload;
  if trimmed is not null then
    result := result || jsonb_build_object('displayName', trimmed);
  elsif coalesce(p_clear_display_name, false) then
    result := result - 'displayName';
  end if;
  if p_archived is true and coalesce(current_payload->>'archivedAt', '') = '' then
    result := result || jsonb_build_object('archivedAt', stamp, 'archivedBy', p_actor_id);
  elsif p_archived is false then
    result := result - 'archivedAt' - 'archivedBy';
  end if;
  result := result || jsonb_build_object('updatedAt', stamp, 'updatedBy', p_actor_id);
  update public.dynamic_missions set payload = result where id = p_mission_id and project_id = p_project_id;
  return result;
end $$;

revoke all on function public.update_dynamic_mission(uuid,uuid,uuid,text,boolean,boolean) from public, anon;
grant execute on function public.update_dynamic_mission(uuid,uuid,uuid,text,boolean,boolean) to authenticated;
