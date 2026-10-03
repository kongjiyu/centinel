-- Centinel durable storage foundation.
-- Apply with the Supabase CLI or SQL editor after creating a project.
-- All application rows are project-scoped and protected by membership RLS.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  workspace_path text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  ) or exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = auth.uid()
  );
$$;

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github', 'google_drive', 'slack')),
  account_label text not null default '',
  account_id text not null default '',
  scopes text not null default '',
  token_reference text,
  expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'expired', 'error', 'disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

create table if not exists public.project_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  kind text not null check (kind in ('upload', 'local_repository', 'github_repository', 'google_drive', 'slack_channel')),
  name text not null,
  remote_id text,
  remote_url text,
  sync_status text not null default 'idle' check (sync_status in ('idle', 'syncing', 'ready', 'error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.project_sources(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'success', 'failure', 'cancelled')),
  imported_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.source_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.project_sources(id) on delete cascade,
  remote_id text,
  path text not null,
  name text not null,
  mime_type text,
  content_hash text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  revision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, path)
);

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  review_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'failure', 'blocked', 'cancelled')),
  config jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  remarks text not null default '',
  final_summary text not null default '',
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  status text not null default 'available',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (review_session_id)
);

create table if not exists public.review_traceability_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  status text not null default 'available',
  records jsonb not null default '[]'::jsonb,
  summary jsonb,
  created_at timestamptz not null default now(),
  unique (review_session_id)
);

create table if not exists public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  decision text not null check (decision in ('approved', 'changes_requested', 'commented')),
  comment text not null default '',
  reviewer text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.review_decision_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  decision_id uuid not null references public.review_decisions(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid references public.review_sessions(id) on delete set null,
  dynamic_session_id uuid,
  source text not null check (source in ('static', 'dynamic')),
  severity text not null,
  priority text,
  title text not null,
  description text not null,
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed', 'fixed', 'carryover')),
  category text not null default '',
  evidence_text text not null default '',
  recommendation text not null default '',
  confidence text not null default '',
  artifact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default '',
  priority text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  file_id uuid,
  symbol_id text,
  coverage_status text not null default 'unknown',
  confidence numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.test_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid references public.review_sessions(id) on delete set null,
  title text not null,
  description text not null default '',
  module text not null default '',
  status text not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dynamic_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  target_url text not null,
  goal text not null,
  mission_type text not null,
  browser_mode text not null default 'headed',
  max_steps integer not null default 20,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'failure', 'blocked', 'cancelled')),
  final_summary text not null default '',
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dynamic_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  dynamic_session_id uuid not null references public.dynamic_sessions(id) on delete cascade,
  step integer not null,
  action text not null,
  target text,
  result text,
  reasoning text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.dynamic_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  dynamic_session_id uuid not null references public.dynamic_sessions(id) on delete cascade,
  type text not null,
  summary text not null default '',
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.findings
  drop constraint if exists findings_dynamic_session_id_fkey;
alter table public.findings
  add constraint findings_dynamic_session_id_fkey
  foreign key (dynamic_session_id) references public.dynamic_sessions(id) on delete set null;

create table if not exists public.project_assessments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  policy_version text not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  policy_version text not null,
  generator_version text not null,
  snapshot jsonb not null,
  markdown_storage_path text,
  json_storage_path text,
  checksum text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  session_id uuid,
  scope text not null,
  provider text not null,
  model text not null,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.token_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  session_id uuid,
  scope text not null,
  call_kind text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists findings_project_created_idx on public.findings(project_id, created_at desc);
create index if not exists dynamic_evidence_session_idx on public.dynamic_evidence(dynamic_session_id, created_at asc);
create index if not exists source_items_source_idx on public.source_items(source_id, updated_at desc);

-- RLS: every project-scoped table is visible only to project members.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.integrations enable row level security;
alter table public.project_sources enable row level security;
alter table public.source_sync_runs enable row level security;
alter table public.source_items enable row level security;
alter table public.review_sessions enable row level security;
alter table public.review_source_snapshots enable row level security;
alter table public.review_traceability_snapshots enable row level security;
alter table public.review_decisions enable row level security;
alter table public.review_decision_attachments enable row level security;
alter table public.findings enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_mappings enable row level security;
alter table public.test_items enable row level security;
alter table public.dynamic_sessions enable row level security;
alter table public.dynamic_actions enable row level security;
alter table public.dynamic_evidence enable row level security;
alter table public.project_assessments enable row level security;
alter table public.report_exports enable row level security;
alter table public.model_audit_events enable row level security;
alter table public.token_usage enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists projects_member_read on public.projects;
create policy projects_member_read on public.projects for select using (owner_id = auth.uid() or public.is_project_member(id));
drop policy if exists projects_owner_write on public.projects;
create policy projects_owner_write on public.projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists members_member_read on public.project_members;
create policy members_member_read on public.project_members for select using (user_id = auth.uid() or public.is_project_member(project_id));
drop policy if exists members_owner_write on public.project_members;
create policy members_owner_write on public.project_members for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

-- Integrations are owner-scoped because they contain references to secrets.
drop policy if exists integrations_owner on public.integrations;
create policy integrations_owner on public.integrations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'project_sources', 'source_sync_runs', 'source_items', 'review_sessions',
    'review_source_snapshots', 'review_traceability_snapshots', 'review_decisions',
    'review_decision_attachments', 'findings', 'requirements', 'requirement_mappings',
    'test_items', 'dynamic_sessions', 'dynamic_actions', 'dynamic_evidence',
    'project_assessments', 'report_exports', 'model_audit_events', 'token_usage'
  ] loop
    execute format('drop policy if exists %I on public.%I;', table_name || '_member', table_name);
    execute format('create policy %I on public.%I for all using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));', table_name || '_member', table_name);
  end loop;
end $$;

-- Private buckets. The first path component must be the project UUID.
insert into storage.buckets (id, name, public)
values
  ('project-artifacts', 'project-artifacts', false),
  ('review-evidence', 'review-evidence', false),
  ('dynamic-evidence', 'dynamic-evidence', false),
  ('decision-attachments', 'decision-attachments', false),
  ('project-reports', 'project-reports', false)
on conflict (id) do update set public = excluded.public;

do $$
declare
  bucket text;
  policy_prefix text;
begin
  foreach bucket in array array['project-artifacts', 'review-evidence', 'dynamic-evidence', 'decision-attachments', 'project-reports'] loop
    policy_prefix := replace(bucket, '-', '_');

    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_read');
    execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.is_project_member(((storage.foldername(name))[1])::uuid));', policy_prefix || '_read', bucket);
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_write');
    execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_project_member(((storage.foldername(name))[1])::uuid));', policy_prefix || '_write', bucket);
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_update');
    execute format('create policy %I on storage.objects for update to authenticated using (bucket_id = %L and public.is_project_member(((storage.foldername(name))[1])::uuid)) with check (bucket_id = %L and public.is_project_member(((storage.foldername(name))[1])::uuid));', policy_prefix || '_update', bucket, bucket);
    execute format('drop policy if exists %I on storage.objects;', policy_prefix || '_delete');
    execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_project_member(((storage.foldername(name))[1])::uuid));', policy_prefix || '_delete', bucket);
  end loop;
end $$;
