-- Durable, bearer-scoped Storage cleanup after project/artifact metadata deletion.
-- Metadata deletion and the object manifest are committed in one transaction.
create table if not exists public.storage_deletion_jobs (
  scope text not null check (scope in ('project', 'artifact')),
  target_id uuid not null,
  project_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scope, target_id)
);

create table if not exists public.storage_deletion_objects (
  scope text not null,
  target_id uuid not null,
  bucket_id text not null,
  path text not null,
  primary key (scope, target_id, bucket_id, path),
  foreign key (scope, target_id) references public.storage_deletion_jobs(scope, target_id) on delete cascade
);

create index if not exists storage_deletion_jobs_owner_idx on public.storage_deletion_jobs(owner_id, created_at);
alter table public.storage_deletion_jobs enable row level security;
alter table public.storage_deletion_objects enable row level security;
grant select on public.storage_deletion_jobs, public.storage_deletion_objects to authenticated;

drop policy if exists storage_deletion_jobs_owner_read on public.storage_deletion_jobs;
create policy storage_deletion_jobs_owner_read on public.storage_deletion_jobs
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists storage_deletion_objects_owner_read on public.storage_deletion_objects;
create policy storage_deletion_objects_owner_read on public.storage_deletion_objects
  for select to authenticated using (
    exists (select 1 from public.storage_deletion_jobs job
      where job.scope = storage_deletion_objects.scope
        and job.target_id = storage_deletion_objects.target_id
        and job.owner_id = auth.uid())
  );

create or replace function public.queue_storage_deletion(p_scope text, p_target_id uuid, p_project_id uuid)
returns boolean language plpgsql security definer set search_path = public, storage
as $$
declare
  v_project_id uuid;
  v_owner_id uuid;
begin
  if auth.uid() is null or p_scope not in ('project', 'artifact') or p_target_id is null or p_project_id is null then
    raise exception 'Invalid storage deletion request' using errcode = '42501';
  end if;

  if p_scope = 'project' then
    select id, owner_id into v_project_id, v_owner_id
    from public.projects where id = p_target_id for update;
    if v_project_id is null then return false; end if;
    if v_owner_id <> auth.uid() then
      raise exception 'Project owner required' using errcode = '42501';
    end if;
  else
    select a.project_id, p.owner_id into v_project_id, v_owner_id
    from public.artifacts a join public.projects p on p.id = a.project_id
    where a.id = p_target_id for update of a;
    if v_project_id is null then return false; end if;
    if not public.is_project_member(v_project_id) then
      raise exception 'Project membership required' using errcode = '42501';
    end if;
    -- The deleter owns the cleanup job even when another user owns the project.
    v_owner_id := auth.uid();
  end if;

  if v_project_id <> p_project_id then
    raise exception 'Deletion target is outside the requested project' using errcode = '42501';
  end if;

  insert into public.storage_deletion_jobs(scope, target_id, project_id, owner_id)
  values (p_scope, p_target_id, v_project_id, v_owner_id)
  on conflict (scope, target_id) do nothing;

  insert into public.storage_deletion_objects(scope, target_id, bucket_id, path)
  select p_scope, p_target_id, obj.bucket_id, obj.name
  from storage.objects obj
  where obj.bucket_id in ('project-artifacts', 'review-evidence', 'dynamic-evidence', 'decision-attachments', 'project-reports')
    and obj.name like v_project_id::text || '/%'
    and (p_scope = 'project' or (obj.bucket_id = 'project-artifacts'
      and obj.name like v_project_id::text || '/' || p_target_id::text || '/%'))
  on conflict do nothing;

  if p_scope = 'project' then
    delete from public.projects where id = p_target_id and owner_id = auth.uid();
  else
    delete from public.artifacts where id = p_target_id and project_id = v_project_id;
  end if;
  return true;
end;
$$;

create or replace function public.can_cleanup_storage_object(p_bucket_id text, p_path text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.storage_deletion_objects obj
    join public.storage_deletion_jobs job
      on job.scope = obj.scope and job.target_id = obj.target_id
    where job.owner_id = auth.uid() and obj.bucket_id = p_bucket_id and obj.path = p_path
  );
$$;

create or replace function public.complete_storage_deletion(p_scope text, p_target_id uuid)
returns boolean language plpgsql security definer set search_path = public, storage
as $$
begin
  if not exists (select 1 from public.storage_deletion_jobs
    where scope = p_scope and target_id = p_target_id and owner_id = auth.uid()) then
    return false;
  end if;
  if exists (
    select 1 from public.storage_deletion_objects manifest
    join storage.objects obj on obj.bucket_id = manifest.bucket_id and obj.name = manifest.path
    where manifest.scope = p_scope and manifest.target_id = p_target_id
  ) then return false; end if;
  delete from public.storage_deletion_jobs
    where scope = p_scope and target_id = p_target_id and owner_id = auth.uid();
  return true;
end;
$$;

revoke all on function public.queue_storage_deletion(text, uuid, uuid) from public;
revoke all on function public.can_cleanup_storage_object(text, text) from public;
revoke all on function public.complete_storage_deletion(text, uuid) from public;
grant execute on function public.queue_storage_deletion(text, uuid, uuid) to authenticated;
grant execute on function public.can_cleanup_storage_object(text, text) to authenticated;
grant execute on function public.complete_storage_deletion(text, uuid) to authenticated;

-- The project membership policies remain in force; these additive policies
-- grant only exact paths that were captured before the metadata commit.
drop policy if exists storage_deletion_manifest_read on storage.objects;
create policy storage_deletion_manifest_read on storage.objects for select to authenticated
  using (public.can_cleanup_storage_object(bucket_id, name));
drop policy if exists storage_deletion_manifest_delete on storage.objects;
create policy storage_deletion_manifest_delete on storage.objects for delete to authenticated
  using (public.can_cleanup_storage_object(bucket_id, name));
