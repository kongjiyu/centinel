create table if not exists public.evidence_contradiction_dispositions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  contradiction_id text not null,
  decision text not null check (decision in ('authoritative_left', 'authoritative_right', 'not_conflict')),
  rationale text not null check (length(trim(rationale)) >= 8),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, contradiction_id)
);

create index if not exists evidence_contradiction_dispositions_review_idx
  on public.evidence_contradiction_dispositions(review_session_id);

alter table public.evidence_contradiction_dispositions enable row level security;
drop policy if exists evidence_contradiction_dispositions_member on public.evidence_contradiction_dispositions;
create policy evidence_contradiction_dispositions_member on public.evidence_contradiction_dispositions
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and actor_id = auth.uid() and public.is_project_member(project_id));
