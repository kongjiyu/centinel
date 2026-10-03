-- Phase 2 static grounding, evidence sufficiency, and Review iteration.
-- Additive by design: historical requirements, standards, findings, and
-- Review rows remain readable and are not rewritten.

alter table public.review_sessions
  drop constraint if exists review_sessions_status_check;
alter table public.review_sessions
  add constraint review_sessions_status_check check (
    status in ('prepared', 'queued', 'running', 'success', 'failure', 'blocked', 'cancelled',
               'failed', 'pending_approval', 'completed', 'approved', 'changes_requested')
  );
alter table public.review_sessions
  add column if not exists iteration jsonb not null default '{}'::jsonb;

alter table public.review_operations
  drop constraint if exists review_operations_operation_check;
alter table public.review_operations
  add constraint review_operations_operation_check check (
    operation in ('start', 'cancel', 'retry', 'prepare_iteration', 'start_iteration')
  );

create table if not exists public.requirement_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('requirement', 'acceptance_criterion')),
  title text not null,
  statement text not null,
  source_locator jsonb not null default '{}'::jsonb,
  source_version text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  fingerprint text not null,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed', 'rejected')),
  confirmed_requirement_id uuid,
  confirmed_by uuid references auth.users(id) on delete set null,
  rejected_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, fingerprint)
);

alter table public.requirements add column if not exists candidate_id uuid references public.requirement_candidates(id) on delete set null;
alter table public.requirements add column if not exists source_locator jsonb not null default '{}'::jsonb;
alter table public.requirements add column if not exists source_version text;
alter table public.requirements add column if not exists confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1));
create unique index if not exists requirements_candidate_id_idx
  on public.requirements(candidate_id) where candidate_id is not null;
alter table public.requirement_candidates
  drop constraint if exists requirement_candidates_confirmed_requirement_id_fkey;
alter table public.requirement_candidates
  add constraint requirement_candidates_confirmed_requirement_id_fkey
  foreign key (confirmed_requirement_id) references public.requirements(id) on delete set null;
create index if not exists requirement_candidates_project_status_created_idx
  on public.requirement_candidates(project_id, status, created_at desc);

create or replace function public.confirm_requirement_candidate(p_candidate_id uuid, p_actor_id uuid)
returns public.requirements
language plpgsql
security invoker
set search_path = public
as $$
declare
  candidate_row public.requirement_candidates%rowtype;
  requirement_row public.requirements%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_actor_id then
    raise exception 'requirement confirmation actor must match the authenticated user';
  end if;
  select * into candidate_row
  from public.requirement_candidates
  where id = p_candidate_id
  for update;
  if not found then raise exception 'requirement candidate not found'; end if;
  if candidate_row.status = 'rejected' then raise exception 'rejected requirement candidate cannot be confirmed'; end if;
  if candidate_row.status = 'confirmed' then
    select * into requirement_row from public.requirements where candidate_id = candidate_row.id;
    if found then return requirement_row; end if;
  end if;

  insert into public.requirements (
    project_id, candidate_id, title, description, category, priority,
    source_locator, source_version, confidence
  ) values (
    candidate_row.project_id, candidate_row.id, candidate_row.title, candidate_row.statement,
    candidate_row.kind, 'medium', candidate_row.source_locator, candidate_row.source_version,
    candidate_row.confidence
  )
  on conflict (candidate_id) where candidate_id is not null do update set
    title = excluded.title,
    description = excluded.description,
    category = excluded.category,
    source_locator = excluded.source_locator,
    source_version = excluded.source_version,
    confidence = excluded.confidence,
    updated_at = now()
  returning * into requirement_row;

  update public.requirement_candidates
  set status = 'confirmed', confirmed_requirement_id = requirement_row.id,
      confirmed_by = p_actor_id, confirmed_at = now(), updated_at = now()
  where id = candidate_row.id;
  return requirement_row;
end;
$$;
grant execute on function public.confirm_requirement_candidate(uuid, uuid) to authenticated;

create table if not exists public.project_standard_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  standard_id uuid not null references public.project_standards(id) on delete cascade,
  stable_key text not null,
  title text not null,
  statement text not null,
  category text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  recommendation text not null default '',
  source_artifact_id text not null,
  source_locator jsonb not null default '{}'::jsonb,
  source_version text not null,
  standard_version text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (standard_id, stable_key, standard_version, source_version)
);
create index if not exists project_standard_rules_project_standard_idx
  on public.project_standard_rules(project_id, standard_id, enabled);

alter table public.findings add column if not exists standard_rule_id uuid references public.project_standard_rules(id) on delete set null;
alter table public.findings add column if not exists rule_id text;
alter table public.findings add column if not exists stable_finding_id text;
alter table public.findings add column if not exists source_identity text;
alter table public.findings add column if not exists source_version text;
alter table public.findings add column if not exists source_locator jsonb not null default '{}'::jsonb;

create table if not exists public.review_evidence_assessments (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  readiness text not null check (readiness in ('ready', 'ready_with_warnings', 'blocked')),
  assessment jsonb not null,
  created_at timestamptz not null default now(),
  unique (review_session_id)
);

create table if not exists public.review_iterations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_review_id uuid not null references public.review_sessions(id) on delete cascade,
  child_review_id uuid not null unique references public.review_sessions(id) on delete cascade,
  decision_id uuid not null references public.review_decisions(id) on delete restrict,
  feedback text not null,
  reviewer text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  source_choice text not null check (source_choice in ('reuse', 'refresh')),
  source_manifest_id uuid references public.review_source_snapshots(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.review_correlation_snapshots (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_review_id uuid not null references public.review_sessions(id) on delete cascade,
  child_review_id uuid not null unique references public.review_sessions(id) on delete cascade,
  counts jsonb not null default '{}'::jsonb,
  ambiguities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.review_finding_correlations (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_review_id uuid not null references public.review_sessions(id) on delete cascade,
  child_review_id uuid not null references public.review_sessions(id) on delete cascade,
  parent_finding_id uuid references public.findings(id) on delete set null,
  child_finding_id uuid references public.findings(id) on delete set null,
  classification text not null check (classification in ('new', 'recurring', 'carried_over', 'resolved', 'regressed')),
  method text not null check (method in ('stable_id', 'fingerprint', 'heuristic', 'unmatched')),
  score numeric not null check (score >= 0 and score <= 1),
  stable_fingerprint text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists review_finding_correlations_child_class_idx
  on public.review_finding_correlations(child_review_id, classification);

alter table public.requirement_candidates enable row level security;
alter table public.project_standard_rules enable row level security;
alter table public.review_evidence_assessments enable row level security;
alter table public.review_iterations enable row level security;
alter table public.review_correlation_snapshots enable row level security;
alter table public.review_finding_correlations enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'requirement_candidates', 'project_standard_rules', 'review_evidence_assessments',
    'review_iterations', 'review_correlation_snapshots', 'review_finding_correlations'
  ] loop
    execute format('drop policy if exists %I on public.%I;', table_name || '_member', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() is not null and public.is_project_member(project_id)) with check (auth.uid() is not null and public.is_project_member(project_id));',
      table_name || '_member', table_name
    );
  end loop;
end $$;
