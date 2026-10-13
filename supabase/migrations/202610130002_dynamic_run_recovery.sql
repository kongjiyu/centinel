-- Durable, database-clock leases for Dynamic browser workers.
-- Recovery records interruption only; it never replays a browser submission.
create table if not exists public.dynamic_run_leases (
  run_id uuid primary key references public.dynamic_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  worker_id text not null,
  lease_token uuid not null,
  heartbeat_at timestamptz not null,
  expires_at timestamptz not null
);
alter table public.dynamic_run_leases enable row level security;
drop policy if exists dynamic_leases_read on public.dynamic_run_leases;
create policy dynamic_leases_read on public.dynamic_run_leases for select to authenticated using (public.is_project_member(project_id));
revoke all on public.dynamic_run_leases from public, anon, authenticated;
grant select (run_id,project_id,worker_id,heartbeat_at,expires_at) on public.dynamic_run_leases to authenticated;

create or replace function public.claim_dynamic_run(p_project_id uuid,p_run_id uuid,p_worker_id text,p_token uuid,p_session_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs; stamp timestamptz := clock_timestamp(); deadline timestamptz; result jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_token is null or p_worker_id is null or length(p_worker_id) not between 1 and 128 then raise exception 'Worker identity required'; end if;
  select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
  stamp := clock_timestamp();
  if not found or r.state <> 'queued' or r.created_at + interval '90 seconds' <= stamp then return null; end if;
  if r.payload->>'createdBy' <> auth.uid()::text then raise insufficient_privilege; end if;
  deadline := stamp + interval '60 seconds';
  insert into public.dynamic_run_leases(run_id,project_id,worker_id,lease_token,heartbeat_at,expires_at) values(p_run_id,p_project_id,p_worker_id,p_token,stamp,deadline);
  result := r.payload || jsonb_build_object('state','running','legacySessionId',p_session_id,'updatedAt',stamp,
    'lease',jsonb_build_object('workerId',p_worker_id,'heartbeatAt',stamp,'expiresAt',deadline));
  update public.dynamic_runs set state='running',payload=result where id=p_run_id;
  return result;
end $$;

create or replace function public.heartbeat_dynamic_run(p_project_id uuid,p_run_id uuid,p_worker_id text,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs; l public.dynamic_run_leases; stamp timestamptz := clock_timestamp(); deadline timestamptz;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
  stamp := clock_timestamp();
  if not found or r.state <> 'running' then return false; end if;
  if r.payload->>'createdBy' <> auth.uid()::text then raise insufficient_privilege; end if;
  select * into l from public.dynamic_run_leases where run_id=p_run_id;
  if not found or l.worker_id <> p_worker_id or l.lease_token <> p_token or l.expires_at <= stamp then return false; end if;
  deadline := stamp + interval '60 seconds';
  update public.dynamic_run_leases set heartbeat_at=stamp,expires_at=deadline where run_id=p_run_id;
  update public.dynamic_runs set payload=jsonb_set(payload,'{lease}',jsonb_build_object('workerId',p_worker_id,'heartbeatAt',stamp,'expiresAt',deadline)) where id=p_run_id;
  return true;
end $$;

create or replace function public.recover_dynamic_runs(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs; l public.dynamic_run_leases; stamp timestamptz := clock_timestamp(); stale boolean; recovered jsonb := '[]'::jsonb; result jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  for r in select * from public.dynamic_runs where project_id=p_project_id and state in ('queued','running') for update skip locked loop
    select * into l from public.dynamic_run_leases where run_id=r.id;
    if r.state='queued' then stale := r.created_at + interval '90 seconds' <= stamp;
    elsif found then stale := l.expires_at <= stamp;
    else stale := (r.payload->>'updatedAt')::timestamptz + interval '6 minutes' <= stamp;
    end if;
    if stale then
      result := r.payload || jsonb_build_object('state','interrupted','verdict','not_tested','updatedAt',stamp,
        'reason','Execution stopped responding. Inspect partial evidence and start a new run when the test environment is ready.',
        'recoveredBy',auth.uid());
      update public.dynamic_runs set state='interrupted',payload=result where id=r.id;
      delete from public.dynamic_run_leases where run_id=r.id;
      recovered := recovered || jsonb_build_array(result);
    end if;
  end loop;
  return recovered;
end $$;

-- Backward-compatible signature; only leased running workers require the
-- private fencing token for finalization. Cancellation remains member-scoped.
create or replace function public.transition_dynamic_run(p_project_id uuid,p_run_id uuid,p_expected text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs; l public.dynamic_run_leases; next_state text := p_patch->>'state'; result jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_expected not in ('queued','running') or next_state is null or not
    (next_state in ('blocked','cancelled','interrupted') or (p_expected='queued' and next_state='running') or (p_expected='running' and next_state='completed')) then raise exception 'Invalid transition'; end if;
  select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
  if not found or r.state <> p_expected then return null; end if;
  if next_state <> 'cancelled' and r.payload->>'createdBy' <> auth.uid()::text then raise insufficient_privilege; end if;
  select * into l from public.dynamic_run_leases where run_id=p_run_id;
  if found and next_state <> 'cancelled' and
    (l.expires_at <= clock_timestamp() or l.lease_token::text is distinct from p_patch->>'leaseToken') then return null; end if;
  if p_patch->>'verdict' is null or p_patch->>'verdict' not in ('passed','failed','uncertain','not_tested') then raise exception 'Invalid verdict'; end if;
  if next_state <> 'completed' and p_patch->>'verdict' <> 'not_tested' then raise exception 'Unverified outcome'; end if;
  result := r.payload || jsonb_build_object('state',next_state,'verdict',p_patch->'verdict','reason',p_patch->'reason',
    'checks',p_patch->'checks','evidence',p_patch->'evidence','legacySessionId',p_patch->'legacySessionId','updatedAt',clock_timestamp());
  update public.dynamic_runs set state=next_state,payload=result where id=p_run_id;
  if next_state not in ('queued','running') then delete from public.dynamic_run_leases where run_id=p_run_id; end if;
  return result;
end $$;
revoke all on function public.claim_dynamic_run(uuid,uuid,text,uuid,text) from public;
revoke all on function public.heartbeat_dynamic_run(uuid,uuid,text,uuid) from public;
revoke all on function public.recover_dynamic_runs(uuid) from public;
grant execute on function public.claim_dynamic_run(uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.heartbeat_dynamic_run(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.recover_dynamic_runs(uuid) to authenticated;
