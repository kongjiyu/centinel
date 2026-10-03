-- Connected-source synchronization state. This migration is additive: old
-- upload/local sources and completed review manifests remain untouched.

alter table public.project_sources
  add column if not exists provider text,
  add column if not exists selected_scope jsonb not null default '{}'::jsonb,
  add column if not exists remote_revision text,
  add column if not exists sync_cursor jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists last_error text;

update public.project_sources
set provider = case kind
  when 'github_repository' then 'github'
  when 'google_drive' then 'google_drive'
  when 'slack_channel' then 'slack'
  else provider
end
where provider is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_sources_provider_check') then
    alter table public.project_sources add constraint project_sources_provider_check
      check (provider is null or provider in ('github', 'google_drive', 'slack'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_sources_status_check') then
    alter table public.project_sources add constraint project_sources_status_check
      check (status in ('active', 'removed', 'inaccessible', 'disconnected'));
  end if;
end $$;

-- A remote connection is unique within a project. Keep legacy/local rows
-- outside this key by requiring a provider and remote identifier.
do $$
begin
  if not exists (
    select 1 from public.project_sources
    where provider is not null and remote_id is not null
    group by project_id, provider, remote_id having count(*) > 1
  ) then
    create unique index if not exists project_sources_connected_remote_idx
      on public.project_sources(project_id, provider, remote_id)
      where provider is not null and remote_id is not null;
  else
    raise notice 'Existing duplicate connected sources retained; source uniqueness index was not created.';
  end if;
end $$;
create index if not exists project_sources_integration_idx
  on public.project_sources(integration_id, project_id);

alter table public.source_items
  add column if not exists artifact_id uuid references public.artifacts(id) on delete set null,
  add column if not exists artifact_version_id uuid references public.artifact_versions(id) on delete set null,
  add column if not exists status text not null default 'available',
  add column if not exists last_seen_at timestamptz,
  add column if not exists unavailable_at timestamptz,
  add column if not exists error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'source_items_status_check') then
    alter table public.source_items add constraint source_items_status_check
      check (status in ('available', 'removed', 'inaccessible', 'unsupported'));
  end if;
end $$;

-- A source item's provider identity survives path/name changes. The existing
-- source/path key is retained for old rows and for items without a remote id.
do $$
begin
  if not exists (
    select 1 from public.source_items
    where remote_id is not null
    group by source_id, remote_id having count(*) > 1
  ) then
    create unique index if not exists source_items_remote_identity_idx
      on public.source_items(source_id, remote_id)
      where remote_id is not null;
  else
    raise notice 'Existing duplicate source item identities retained; remote identity index was not created.';
  end if;
end $$;
create index if not exists source_items_artifact_idx on public.source_items(artifact_id, artifact_version_id);
create index if not exists source_items_status_idx on public.source_items(source_id, status);

alter table public.source_sync_runs
  add column if not exists idempotency_key text,
  add column if not exists remote_revision text,
  add column if not exists cursor_start jsonb,
  add column if not exists cursor_end jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists updated_count integer not null default 0,
  add column if not exists unchanged_count integer not null default 0,
  add column if not exists removed_count integer not null default 0,
  add column if not exists inaccessible_count integer not null default 0,
  add column if not exists error_code text,
  add column if not exists retryable boolean not null default false;

alter table public.source_sync_runs drop constraint if exists source_sync_runs_status_check;
alter table public.source_sync_runs add constraint source_sync_runs_status_check
  check (status in ('queued', 'running', 'partial', 'success', 'failure', 'cancelled'));
create unique index if not exists source_sync_runs_idempotency_idx
  on public.source_sync_runs(source_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists source_sync_runs_history_idx
  on public.source_sync_runs(source_id, created_at desc);

-- Keep source objects private. The Phase 1 membership-aware storage policies
-- already scope object names by project UUID, and storage_project_id validates
-- the first path segment before casting it.
insert into storage.buckets (id, name, public)
values ('project-artifacts', 'project-artifacts', false)
on conflict (id) do update set public = false;
