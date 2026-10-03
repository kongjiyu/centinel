-- Phase 3A Supabase authority additions.
--
-- Application requests use the bearer-authenticated client and these rows are
-- protected by the membership policies from the foundation migrations. No
-- function in this migration requires or references a service-role key.

-- Report history must retain all three immutable object paths so an existing
-- export can be reopened after its original signed URLs expire.
alter table public.report_exports
  add column if not exists pdf_storage_path text,
  add column if not exists object_paths jsonb not null default '{}'::jsonb;

create index if not exists report_exports_project_created_idx
  on public.report_exports(project_id, created_at desc);

-- Model Provider settings are configured in the desktop UI and encrypted by
-- the sidecar. Keep the primary and fallback protocol information together so
-- the Review worker can resolve one auditable provider chain without reading
-- process environment variables or legacy SQLite settings.
alter table public.model_configurations
  add column if not exists api_format text,
  add column if not exists fallback_api_format text,
  add column if not exists fallback_base_url text,
  add column if not exists fallback_secret_ciphertext text;

-- Phase 1's StoreRequirementMapping contract records the immutable artifact
-- locator alongside the older file_id field. Add the missing column before
-- the request-scoped repository starts writing those mappings.
alter table public.requirement_mappings
  add column if not exists artifact_id uuid references public.artifacts(id) on delete set null;

drop policy if exists report_exports_member on public.report_exports;
create policy report_exports_member on public.report_exports
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));

-- Artifact versions are immutable inputs. A new source revision is a new row,
-- never an update to an existing hash/storage object. Deletes remain possible
-- through normal project/artifact retention operations; row updates cannot
-- rewrite the review input or move its private Storage object.
create or replace function public.prevent_artifact_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.project_id <> new.project_id
     or old.artifact_id <> new.artifact_id
     or old.version_number <> new.version_number
     or old.content_hash <> new.content_hash
     or coalesce(old.storage_path, '') <> coalesce(new.storage_path, '')
     or coalesce(old.source_revision, '') <> coalesce(new.source_revision, '')
     or coalesce(old.content_type, '') <> coalesce(new.content_type, '')
     or coalesce(old.byte_size, -1) <> coalesce(new.byte_size, -1) then
    raise exception 'artifact versions are immutable; insert a new version instead';
  end if;
  return new;
end;
$$;

drop trigger if exists artifact_versions_immutable on public.artifact_versions;
create trigger artifact_versions_immutable
  before update on public.artifact_versions
  for each row execute procedure public.prevent_artifact_version_mutation();

-- Every newly-created version must point at a private project-prefixed object.
-- Existing nullable rows remain readable so this additive migration does not
-- destroy historical imports; the request repository never creates such rows.
create or replace function public.validate_artifact_version_storage_path()
returns trigger
language plpgsql
as $$
begin
  if new.storage_path is not null and split_part(new.storage_path, '/', 1) <> new.project_id::text then
    raise exception 'artifact Storage paths must begin with their project id';
  end if;
  if new.content_hash is null or length(trim(new.content_hash)) = 0 then
    raise exception 'artifact versions require a content hash';
  end if;
  return new;
end;
$$;

drop trigger if exists artifact_versions_storage_path_guard on public.artifact_versions;
create trigger artifact_versions_storage_path_guard
  before insert or update on public.artifact_versions
  for each row execute procedure public.validate_artifact_version_storage_path();

-- NOT VALID preserves historical imports that predate Storage authority while
-- enforcing the invariant for every new version written after this migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artifact_versions_private_storage_required') then
    alter table public.artifact_versions
      add constraint artifact_versions_private_storage_required
      check (storage_path is not null and length(trim(content_hash)) > 0) not valid;
  end if;
end $$;

-- Decision attachments are metadata for objects in the private bucket. The
-- path guard prevents an attachment from being associated with another
-- project's object while membership RLS controls who can read it.
create or replace function public.validate_decision_attachment_storage_path()
returns trigger
language plpgsql
as $$
begin
  if split_part(new.storage_path, '/', 1) <> new.project_id::text then
    raise exception 'decision attachment Storage paths must begin with their project id';
  end if;
  return new;
end;
$$;

drop trigger if exists review_decision_attachments_storage_path_guard on public.review_decision_attachments;
create trigger review_decision_attachments_storage_path_guard
  before insert or update on public.review_decision_attachments
  for each row execute procedure public.validate_decision_attachment_storage_path();
