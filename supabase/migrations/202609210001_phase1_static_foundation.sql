-- Centinel Static Review Phase 1 durable foundation.
--
-- This migration is intentionally additive. 202609140001_initial.sql is
-- already used by local installations, so new tables and columns are added
-- here rather than replacing that migration. The sidecar always connects
-- with the user's access token; service-role credentials are only needed by
-- an operator applying migrations or running the legacy import command.

create extension if not exists vector;
-- Supabase installations commonly keep extensions in `extensions`, while
-- self-hosted PostgreSQL often installs them in `public`. Resolving the type
-- through the search path supports both layouts without a second vector type.
set search_path = public, extensions;

-- Keep presentation metadata one-to-one with auth.users. A trigger covers
-- new sign-ups, while the sidecar's ensureProfile operation remains safe for
-- existing users and OAuth callbacks.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_user_profile();

create table if not exists public.project_standards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  title text not null,
  description text not null default '',
  source text not null default 'manual',
  version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid references public.project_sources(id) on delete set null,
  path text not null,
  name text not null default '',
  kind text not null default 'file',
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create table if not exists public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  version_number integer not null,
  content_hash text not null,
  byte_size bigint,
  storage_path text,
  source_revision text,
  content_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artifact_id, version_number),
  unique (artifact_id, content_hash)
);

create table if not exists public.standard_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  standard_id uuid not null references public.project_standards(id) on delete cascade,
  artifact_id uuid references public.artifacts(id) on delete set null,
  requirement_id uuid references public.requirements(id) on delete set null,
  coverage_status text not null default 'unknown',
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.review_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  artifact_version_id uuid references public.artifact_versions(id) on delete set null,
  kind text not null default 'text',
  locator jsonb not null default '{}'::jsonb,
  content text,
  storage_path text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  immutable boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.finding_state_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  comment text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.review_assessments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  risk_level text not null,
  score numeric,
  policy_version text not null,
  summary text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (review_session_id)
);

create table if not exists public.review_progress_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  stage text not null,
  status text not null,
  progress numeric check (progress >= 0 and progress <= 1),
  message text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.model_configurations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  purpose text not null default 'static_review',
  provider text not null,
  model text not null,
  base_url text,
  secret_ciphertext text,
  fallback_provider text,
  fallback_model text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, purpose)
);

create table if not exists public.model_usage_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  review_session_id uuid references public.review_sessions(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  stage text not null,
  attempt integer not null check (attempt > 0),
  provider text not null,
  model text not null,
  outcome text not null,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_creation_tokens integer,
  duration_ms integer,
  error_code text,
  cost numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);

-- The initial migration used success/failure, while the Phase 1 lifecycle
-- needs explicit pending-approval/completed and cancelled states. Preserve
-- the old values for backward compatibility with existing rows and routes.
alter table public.review_sessions
  drop constraint if exists review_sessions_status_check;
alter table public.review_sessions
  add constraint review_sessions_status_check check (
    status in ('queued', 'running', 'success', 'failure', 'blocked', 'cancelled',
               'failed', 'pending_approval', 'completed', 'approved', 'changes_requested')
  );
alter table public.review_sessions add column if not exists parent_review_id uuid references public.review_sessions(id) on delete set null;
alter table public.review_sessions add column if not exists idempotency_key text;
alter table public.review_sessions add column if not exists source_manifest_hash text;
alter table public.review_sessions add column if not exists cancelled_at timestamptz;
alter table public.review_sessions add column if not exists completed_at timestamptz;
alter table public.review_sessions add column if not exists source_manifest_id uuid references public.review_source_snapshots(id) on delete set null;
alter table public.review_sessions add column if not exists scope jsonb not null default '{}'::jsonb;
alter table public.review_sessions add column if not exists lineage jsonb not null default '{}'::jsonb;
alter table public.review_sessions add column if not exists deterministic_finding_count integer not null default 0;
alter table public.review_sessions add column if not exists model_finding_count integer not null default 0;
alter table public.review_sessions add column if not exists model_status text not null default 'not_requested';
alter table public.review_sessions add column if not exists summary text not null default '';
alter table public.review_sessions add column if not exists revision integer not null default 0;
create unique index if not exists review_sessions_project_idempotency_idx
  on public.review_sessions(project_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.review_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  operation text not null check (operation in ('start', 'cancel', 'retry')),
  idempotency_key text not null,
  review_id uuid not null references public.review_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (operation, project_id, idempotency_key)
);

alter table public.findings add column if not exists correlation_fingerprint text;
alter table public.findings add column if not exists artifact_version_id uuid references public.artifact_versions(id) on delete set null;
alter table public.findings add column if not exists evidence_id uuid references public.review_evidence(id) on delete set null;
alter table public.findings add column if not exists requirement_id uuid references public.requirements(id) on delete set null;
alter table public.findings add column if not exists standard_id uuid references public.project_standards(id) on delete set null;
alter table public.findings add column if not exists verifier text;
alter table public.findings add column if not exists location jsonb not null default '{}'::jsonb;
create unique index if not exists findings_review_fingerprint_idx
  on public.findings(review_session_id, correlation_fingerprint)
  where correlation_fingerprint is not null;

alter table public.requirement_mappings add column if not exists standard_id uuid references public.project_standards(id) on delete set null;
alter table public.requirement_mappings add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- Embeddings are retrieval indexes, not the source of truth. Provenance and
-- content hashes remain in artifacts/artifact_versions/requirements/standards.
create table if not exists public.artifact_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  artifact_version_id uuid not null references public.artifact_versions(id) on delete cascade,
  ordinal integer not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artifact_version_id, ordinal),
  unique (artifact_version_id, content_hash)
);

create table if not exists public.requirement_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  ordinal integer not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (requirement_id, ordinal),
  unique (requirement_id, content_hash)
);

create table if not exists public.standard_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  standard_id uuid not null references public.project_standards(id) on delete cascade,
  ordinal integer not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (standard_id, ordinal),
  unique (standard_id, content_hash)
);

create index if not exists artifact_versions_project_hash_idx on public.artifact_versions(project_id, content_hash);
create index if not exists review_evidence_review_created_idx on public.review_evidence(review_session_id, created_at);
create index if not exists finding_history_finding_created_idx on public.finding_state_history(finding_id, created_at);
create index if not exists model_usage_review_created_idx on public.model_usage_records(review_session_id, created_at);
create index if not exists review_progress_review_created_idx on public.review_progress_events(review_session_id, created_at);
create index if not exists artifact_chunks_embedding_idx on public.artifact_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists requirement_chunks_embedding_idx on public.requirement_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists standard_chunks_embedding_idx on public.standard_chunks using hnsw (embedding vector_cosine_ops);

-- Ensure the project_id copied onto requirement_mappings is populated for old
-- rows and remains consistent for new rows. The column is intentionally
-- nullable for compatibility with the original schema.
update public.requirement_mappings rm
set project_id = r.project_id
from public.requirements r
where rm.requirement_id = r.id and rm.project_id is null;

create or replace function public.requirement_mapping_project_guard()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is null then
    select project_id into new.project_id from public.requirements where id = new.requirement_id;
  end if;
  if new.project_id is null then
    raise exception 'requirement mapping must reference a project';
  end if;
  return new;
end;
$$;
drop trigger if exists requirement_mapping_project_guard on public.requirement_mappings;
create trigger requirement_mapping_project_guard
  before insert or update on public.requirement_mappings
  for each row execute procedure public.requirement_mapping_project_guard();

-- RLS for the additive static tables. Every predicate requires both a signed
-- in user and project membership; model configurations are owner-scoped.
alter table public.project_standards enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.standard_mappings enable row level security;
alter table public.review_evidence enable row level security;
alter table public.finding_state_history enable row level security;
alter table public.review_assessments enable row level security;
alter table public.review_progress_events enable row level security;
alter table public.review_operations enable row level security;
alter table public.model_configurations enable row level security;
alter table public.model_usage_records enable row level security;
alter table public.audit_events enable row level security;
alter table public.artifact_chunks enable row level security;
alter table public.requirement_chunks enable row level security;
alter table public.standard_chunks enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'project_standards', 'artifacts', 'artifact_versions', 'standard_mappings',
    'review_evidence', 'finding_state_history', 'review_assessments',
    'review_progress_events', 'review_operations', 'model_usage_records', 'audit_events',
    'artifact_chunks', 'requirement_chunks', 'standard_chunks'
  ] loop
    execute format('drop policy if exists %I on public.%I;', table_name || '_member', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() is not null and public.is_project_member(project_id)) with check (auth.uid() is not null and public.is_project_member(project_id));',
      table_name || '_member', table_name
    );
  end loop;
end $$;

drop policy if exists model_configurations_owner on public.model_configurations;
create policy model_configurations_owner on public.model_configurations
  for all to authenticated
  using (auth.uid() is not null and owner_id = auth.uid())
  with check (auth.uid() is not null and owner_id = auth.uid());

-- Tighten the existing project-scoped policies to authenticated callers. The
-- policy names are stable, so this remains idempotent on repeated deploys.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects', 'project_members', 'project_sources', 'source_sync_runs',
    'source_items', 'review_sessions', 'review_source_snapshots',
    'review_traceability_snapshots', 'review_decisions',
    'review_decision_attachments', 'findings', 'requirements',
    'requirement_mappings', 'test_items', 'dynamic_sessions',
    'dynamic_actions', 'dynamic_evidence', 'project_assessments',
    'report_exports', 'model_audit_events', 'token_usage'
  ] loop
    -- Existing policies already require membership; explicit role targeting
    -- avoids an accidentally permissive anon policy added out-of-band.
    begin
      execute format('alter policy %I on public.%I to authenticated;', table_name || '_member', table_name);
    exception when undefined_object then
      null;
    end;
  end loop;
end $$;

-- Additive private storage buckets and membership-aware path policies. Object
-- paths must start with a project UUID, e.g. <project>/<review>/evidence.json.
insert into storage.buckets (id, name, public)
values
  ('project-artifacts', 'project-artifacts', false),
  ('review-evidence', 'review-evidence', false),
  ('dynamic-evidence', 'dynamic-evidence', false),
  ('decision-attachments', 'decision-attachments', false),
  ('project-reports', 'project-reports', false)
on conflict (id) do update set public = excluded.public;

create or replace function public.storage_project_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  candidate text;
begin
  candidate := (storage.foldername(object_name))[1];
  if candidate is null then return null; end if;
  return candidate::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

do $$
declare
  bucket text;
  policy_prefix text;
begin
  foreach bucket in array array['project-artifacts', 'review-evidence', 'dynamic-evidence', 'decision-attachments', 'project-reports'] loop
    policy_prefix := replace(bucket, '-', '_');
    -- Replace the initial migration's cast-before-validation policy. Without
    -- this drop, a non-UUID object path could still error before the safer
    -- phase1 policy gets a chance to evaluate it.
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_read');
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_write');
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_update');
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_delete');
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_phase1_read');
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.is_project_member(public.storage_project_id(name)));',
      policy_prefix || '_phase1_read', bucket
    );
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_phase1_write');
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_project_member(public.storage_project_id(name)));',
      policy_prefix || '_phase1_write', bucket
    );
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_phase1_update');
    execute format(
      'create policy %I on storage.objects for update to authenticated using (bucket_id = %L and public.is_project_member(public.storage_project_id(name))) with check (bucket_id = %L and public.is_project_member(public.storage_project_id(name)));',
      policy_prefix || '_phase1_update', bucket, bucket
    );
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_phase1_delete');
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_project_member(public.storage_project_id(name)));',
      policy_prefix || '_phase1_delete', bucket
    );
  end loop;
end $$;
