-- Phase 3 runtime durability: worker leases and resumable checkpoints.
-- These functions execute in the caller's authenticated/RLS context; they do
-- not use a service-role key and cannot claim a review outside membership.

create table if not exists public.review_worker_leases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null unique references public.review_sessions(id) on delete cascade,
  worker_id text not null,
  lease_token text not null,
  attempt integer not null default 1 check (attempt > 0),
  acquired_at timestamptz not null,
  heartbeat_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The original model configuration table stored format/fallback details in
-- metadata. Keep that shape compatible while exposing explicit encrypted
-- columns for new clients.
alter table public.model_configurations add column if not exists api_format text;
alter table public.model_configurations add column if not exists fallback_api_format text;
alter table public.model_configurations add column if not exists fallback_base_url text;
alter table public.model_configurations add column if not exists fallback_secret_ciphertext text;

create table if not exists public.review_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_session_id uuid not null unique references public.review_sessions(id) on delete cascade,
  worker_id text not null,
  lease_token text not null,
  stage text not null,
  completed_stages jsonb not null default '[]'::jsonb,
  cursor jsonb,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists review_worker_leases_expiry_idx
  on public.review_worker_leases(expires_at);

alter table public.review_worker_leases enable row level security;
alter table public.review_checkpoints enable row level security;

drop policy if exists review_worker_leases_member on public.review_worker_leases;
create policy review_worker_leases_member on public.review_worker_leases
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));

drop policy if exists review_checkpoints_member on public.review_checkpoints;
create policy review_checkpoints_member on public.review_checkpoints
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));

create or replace function public.claim_review_lease(
  p_review_id uuid,
  p_project_id uuid,
  p_worker_id text,
  p_lease_token text,
  p_now timestamptz,
  p_expires_at timestamptz
)
returns setof public.review_worker_leases
language plpgsql
as $$
begin
  if auth.uid() is null
     or not public.is_project_member(p_project_id)
     or not exists (select 1 from public.review_sessions where id = p_review_id and project_id = p_project_id)
  then
    return;
  end if;
  return query
    insert into public.review_worker_leases (
      project_id, review_session_id, worker_id, lease_token, attempt,
      acquired_at, heartbeat_at, expires_at, updated_at
    ) values (
      p_project_id, p_review_id, p_worker_id, p_lease_token, 1,
      p_now, p_now, p_expires_at, p_now
    )
    on conflict (review_session_id) do update set
      project_id = excluded.project_id,
      worker_id = excluded.worker_id,
      lease_token = excluded.lease_token,
      attempt = public.review_worker_leases.attempt + 1,
      heartbeat_at = excluded.heartbeat_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
    where public.review_worker_leases.expires_at <= p_now
       or (public.review_worker_leases.worker_id = p_worker_id
           and public.review_worker_leases.lease_token = p_lease_token)
    returning *;
end;
$$;

create or replace function public.renew_review_lease(
  p_review_id uuid,
  p_worker_id text,
  p_lease_token text,
  p_now timestamptz,
  p_expires_at timestamptz
)
returns setof public.review_worker_leases
language plpgsql
as $$
begin
  if auth.uid() is null then return; end if;
  return query
    update public.review_worker_leases
    set heartbeat_at = p_now, expires_at = p_expires_at, updated_at = p_now
    where review_session_id = p_review_id
      and worker_id = p_worker_id
      and lease_token = p_lease_token
      and expires_at > p_now
    returning *;
end;
$$;

create or replace function public.release_review_lease(
  p_review_id uuid,
  p_worker_id text,
  p_lease_token text,
  p_now timestamptz
)
returns boolean
language plpgsql
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then return false; end if;
  delete from public.review_worker_leases
   where review_session_id = p_review_id
     and worker_id = p_worker_id
     and lease_token = p_lease_token;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
