-- Add durable, restart-recoverable worker leases and safe retry progress for
-- connected-source imports. No credentials or provider response bodies are
-- stored here; the lease token is an opaque per-run compare-and-set value.

alter table public.source_sync_runs
  add column if not exists worker_lease_token uuid,
  add column if not exists worker_lease_expires_at timestamptz,
  add column if not exists retry_service text,
  add column if not exists retry_operation text,
  add column if not exists retry_attempt integer,
  add column if not exists retry_limit integer,
  add column if not exists retry_delay_ms integer,
  add column if not exists next_attempt_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'source_sync_runs_retry_attempt_check') then
    alter table public.source_sync_runs add constraint source_sync_runs_retry_attempt_check
      check (retry_attempt is null or retry_attempt between 2 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'source_sync_runs_retry_limit_check') then
    alter table public.source_sync_runs add constraint source_sync_runs_retry_limit_check
      check (retry_limit is null or retry_limit between 1 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'source_sync_runs_retry_delay_check') then
    alter table public.source_sync_runs add constraint source_sync_runs_retry_delay_check
      check (retry_delay_ms is null or retry_delay_ms between 0 and 60000);
  end if;
end $$;

create index if not exists source_sync_runs_lease_recovery_idx
  on public.source_sync_runs(status, worker_lease_expires_at)
  where status in ('queued', 'running', 'partial');

-- Serialize source-run creation so concurrent Sync/recovery requests reuse the
-- same active run. The lock is transaction-scoped and contains no user secret.
create or replace function public.queue_source_sync_run(
  p_project_id uuid,
  p_source_id uuid,
  p_idempotency_key text
)
returns setof public.source_sync_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing_run public.source_sync_runs%rowtype;
  new_run public.source_sync_runs%rowtype;
begin
  if auth.uid() is null or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return;
  end if;

  if not exists (
    select 1
    from public.project_sources as source
    join public.projects as project on project.id = source.project_id
    where source.id = p_source_id
      and source.project_id = p_project_id
      and (project.owner_id = auth.uid() or public.is_project_member(project.id))
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source_id::text, 1486325300));

  select * into existing_run
  from public.source_sync_runs
  where source_id = p_source_id and idempotency_key = p_idempotency_key
  limit 1;
  if found then
    return next existing_run;
    return;
  end if;

  select * into existing_run
  from public.source_sync_runs
  where source_id = p_source_id and status in ('queued', 'running', 'partial')
  order by created_at desc, id desc
  limit 1;
  if found then
    return next existing_run;
    return;
  end if;

  insert into public.source_sync_runs(project_id, source_id, idempotency_key, status)
  values (p_project_id, p_source_id, p_idempotency_key, 'queued')
  returning * into new_run;

  return next new_run;
end;
$$;

grant execute on function public.queue_source_sync_run(uuid, uuid, text) to authenticated;

-- This RPC runs with the caller's privileges. The table's existing
-- source_sync_runs_member RLS policy remains in force; the explicit project
-- membership predicate is defense in depth and keeps ownership checks clear.
create or replace function public.claim_source_sync_run(
  p_run_id uuid,
  p_claim_token uuid,
  p_lease_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  claimed_run_id uuid;
begin
  if auth.uid() is null or p_claim_token is null then
    return false;
  end if;

  update public.source_sync_runs as sync_run
  set worker_lease_token = p_claim_token,
      worker_lease_expires_at = clock_timestamp() + make_interval(
        secs => least(greatest(coalesce(p_lease_ttl_seconds, 120), 30), 900)
      )
  where sync_run.id = p_run_id
    and sync_run.status in ('queued', 'running', 'partial')
    and (
      sync_run.worker_lease_token = p_claim_token
      or sync_run.worker_lease_token is null
      or sync_run.worker_lease_expires_at is null
      or sync_run.worker_lease_expires_at <= clock_timestamp()
    )
    and exists (
      select 1
      from public.projects as project
      where project.id = sync_run.project_id
        and (project.owner_id = auth.uid() or public.is_project_member(project.id))
    )
  returning sync_run.id into claimed_run_id;

  return claimed_run_id is not null;
end;
$$;

grant execute on function public.claim_source_sync_run(uuid, uuid, integer) to authenticated;
