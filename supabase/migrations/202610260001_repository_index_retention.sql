begin;

do $$ begin
  if to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'Storage operation-aware policy helpers are required for repository indexes';
  end if;
end $$;

-- Shared repository snapshots remain readable only while every frozen source
-- artifact they name still belongs to the project. The archive itself stays
-- in the private project-artifacts bucket under a dedicated namespace.
create or replace function public.repository_index_object_allowed(
  p_name text,
  p_user_metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_match text[];
  v_project_id uuid;
  v_fingerprint text;
  v_artifact_ids jsonb;
  v_array_length integer;
  v_distinct_count integer;
  v_id_count integer;
  v_current_count integer;
begin
  if auth.uid() is null or p_name is null or jsonb_typeof(p_user_metadata) is distinct from 'object' then
    return false;
  end if;

  v_match := regexp_match(
    p_name,
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/_repository-index/open-codebase-index-0\.38\.1/([0-9a-f]{64})\.json\.gz$'
  );
  if v_match is null then return false; end if;

  v_project_id := public.storage_project_id(p_name);
  if v_project_id is null or not public.is_project_member(v_project_id) then return false; end if;

  v_fingerprint := v_match[2];
  if p_user_metadata -> 'schemaVersion' is distinct from '1'::jsonb
     or p_user_metadata ->> 'fingerprint' is distinct from v_fingerprint then
    return false;
  end if;

  v_artifact_ids := p_user_metadata -> 'artifactIds';
  if jsonb_typeof(v_artifact_ids) is distinct from 'array' then return false; end if;
  v_array_length := jsonb_array_length(v_artifact_ids);
  if v_array_length < 1 or v_array_length > 1024 then return false; end if;

  if exists (
    select 1
    from jsonb_array_elements(v_artifact_ids) as item(value)
    where jsonb_typeof(item.value) is distinct from 'string'
       or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;

  select count(distinct lower(item.artifact_id)), count(*)
    into v_distinct_count, v_id_count
  from jsonb_array_elements_text(v_artifact_ids) as item(artifact_id);
  if v_id_count <> v_array_length or v_distinct_count <> v_array_length then return false; end if;

  select count(*)
    into v_current_count
  from public.artifacts artifact
  where artifact.project_id = v_project_id
    and lower(artifact.id::text) in (
      select lower(item.artifact_id)
      from jsonb_array_elements_text(v_artifact_ids) as item(artifact_id)
    );

  return v_current_count = v_array_length;
exception when others then
  -- Malformed object metadata must deny access without exposing a database
  -- diagnostic to the Storage API caller.
  return false;
end;
$$;

revoke all on function public.repository_index_object_allowed(text, jsonb) from public, anon;
grant execute on function public.repository_index_object_allowed(text, jsonb) to authenticated;

-- The namespace test is intentionally broader than the one accepted engine
-- path above. Unknown versions and malformed index objects fail closed too.
drop policy if exists repository_index_member_read on storage.objects;
create policy repository_index_member_read on storage.objects
  as restrictive for select to authenticated
  using (
    bucket_id <> 'project-artifacts'
    or name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/_repository-index(/|$)'
    or (
      storage.allow_any_operation(array['object.get_authenticated', 'object.list', 'object.list_v2', 'object.info_authenticated', 'object.get_authenticated_info', 'object.head_authenticated_info', 'object.upload'])
      and public.repository_index_object_allowed(name, user_metadata)
    )
    or (
      storage.allow_any_operation(array['object.delete', 'object.delete_many'])
      and (public.repository_index_object_allowed(name, user_metadata) or public.can_cleanup_storage_object(bucket_id, name))
    )
  );

drop policy if exists repository_index_member_insert on storage.objects;
create policy repository_index_member_insert on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id <> 'project-artifacts'
    or name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/_repository-index(/|$)'
    or public.repository_index_object_allowed(name, user_metadata)
  );

-- Index snapshots are immutable at a fingerprint path. Replacing one through
-- UPDATE/UPSERT could change the manifest for all project members.
drop policy if exists repository_index_member_update_deny on storage.objects;
create policy repository_index_member_update_deny on storage.objects
  as restrictive for update to authenticated
  using (
    bucket_id <> 'project-artifacts'
    or name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/_repository-index(/|$)'
  )
  with check (
    bucket_id <> 'project-artifacts'
    or name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/_repository-index(/|$)'
  );

create or replace function public.queue_repository_index_retention_after_artifact_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_owner_id uuid;
begin
  -- Project deletion already captured the complete project prefix before it
  -- deleted metadata. Avoid duplicate per-artifact cleanup jobs on cascade.
  if exists (
    select 1
    from public.storage_deletion_jobs job
    where job.scope = 'project'
      and job.target_id = old.project_id
  ) then
    return old;
  end if;

  if auth.uid() is not null then
    v_owner_id := auth.uid();
  else
    select project.owner_id into v_owner_id
    from public.projects project
    where project.id = old.project_id;
  end if;
  if v_owner_id is null then return old; end if;

  insert into public.storage_deletion_jobs(scope, target_id, project_id, owner_id)
  values ('artifact', old.id, old.project_id, v_owner_id)
  on conflict (scope, target_id) do nothing;

  -- Any source deletion invalidates the project's shared retrieval snapshot,
  -- so capture every current snapshot under this project's reserved prefix.
  insert into public.storage_deletion_objects(scope, target_id, bucket_id, path)
  select 'artifact', old.id, obj.bucket_id, obj.name
  from storage.objects obj
  where obj.bucket_id = 'project-artifacts'
    and obj.name ~ ('^' || old.project_id::text || '/_repository-index/')
  on conflict do nothing;

  return old;
end;
$$;

revoke all on function public.queue_repository_index_retention_after_artifact_delete() from public, anon, authenticated;
drop trigger if exists repository_index_retention_after_artifact_delete on public.artifacts;
create trigger repository_index_retention_after_artifact_delete
  after delete on public.artifacts
  for each row execute function public.queue_repository_index_retention_after_artifact_delete();

-- Sidecar calls this inexpensive RPC before any repository embedding request.
-- A successful authenticated call proves this retention policy is installed.
create or replace function public.repository_index_storage_ready()
returns integer
language sql
immutable
security invoker
set search_path = public
as $$
  select 1;
$$;

revoke all on function public.repository_index_storage_ready() from public, anon;
grant execute on function public.repository_index_storage_ready() to authenticated;

commit;
