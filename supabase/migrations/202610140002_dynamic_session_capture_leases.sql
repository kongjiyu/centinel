-- Manual browser authentication participates in the project execution lock.
create table if not exists public.dynamic_session_captures(
 id uuid primary key,project_id uuid not null references public.projects(id),profile_id uuid not null references public.dynamic_environments(id),actor_id uuid not null,
 state text not null check(state in ('open','completed','cancelled','interrupted')),created_at timestamptz not null,expires_at timestamptz not null,
 token uuid not null,worker_id text not null,cancel_requested boolean not null default false
);
create unique index if not exists dynamic_one_session_capture_per_project on public.dynamic_session_captures(project_id) where state='open';
alter table public.dynamic_session_captures enable row level security;
drop policy if exists dynamic_session_capture_read on public.dynamic_session_captures;
create policy dynamic_session_capture_read on public.dynamic_session_captures for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_session_captures from public,anon,authenticated;
grant select(id,project_id,profile_id,actor_id,state,created_at,expires_at,cancel_requested) on public.dynamic_session_captures to authenticated;
create or replace function public.recover_dynamic_session_captures(p_project_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare item public.dynamic_session_captures;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 for item in select * from public.dynamic_session_captures where project_id=p_project_id and state='open' and expires_at<=clock_timestamp() for update loop
  update public.dynamic_session_captures set state='interrupted' where id=item.id;
  update public.dynamic_environment_data set state='cleanup_required',prepared_version=null,preparation=null where profile_id=item.profile_id;
 end loop;
end $$;
create or replace function public.require_no_dynamic_session_capture(p_project_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.recover_dynamic_session_captures(p_project_id);
 if exists(select 1 from public.dynamic_session_captures where project_id=p_project_id and state='open') then raise exception 'Finish or close the sign-in capture before project execution';end if;
end $$;
create or replace function public.acquire_dynamic_session_capture(p_project_id uuid,p_profile_id uuid,p_id uuid,p_token uuid,p_worker text)
returns boolean language plpgsql security definer set search_path=public as $$
declare item public.dynamic_session_captures;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_id is null or p_token is null or p_worker is null or length(p_worker) not between 1 and 128 then raise exception 'Bounded capture claim required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));perform public.require_no_dynamic_session_capture(p_project_id);perform public.recover_dynamic_hooks(p_project_id);perform public.recover_dynamic_runs(p_project_id);
 if not exists(select 1 from public.dynamic_environments where id=p_profile_id and project_id=p_project_id) then raise no_data_found;end if;
 if exists(select 1 from public.dynamic_runs where project_id=p_project_id and state in ('queued','running')) or exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and state in ('queued','running')) then raise exception 'Project work is active';end if;
 if public.read_dynamic_environment_data(p_project_id,p_profile_id)->>'state'='cleanup_required' then raise exception 'Clean the environment before signing in';end if;
 insert into public.dynamic_session_captures(id,project_id,profile_id,actor_id,state,created_at,expires_at,token,worker_id) values(p_id,p_project_id,p_profile_id,auth.uid(),'open',clock_timestamp(),clock_timestamp()+interval '60 seconds',p_token,p_worker);
 update public.dynamic_environment_data set state='preparing',prepared_version=null,preparation=null where profile_id=p_profile_id;
 return true;
end $$;
create or replace function public.heartbeat_dynamic_session_capture(p_project_id uuid,p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare item public.dynamic_session_captures;stamp timestamptz;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into item from public.dynamic_session_captures where id=p_id and project_id=p_project_id for update;stamp:=clock_timestamp();
 if not found or item.actor_id<>auth.uid() or item.token is distinct from p_token or item.state<>'open' or item.cancel_requested or item.expires_at<=stamp or item.created_at+interval '320 seconds'<=stamp then return false;end if;
 update public.dynamic_session_captures set expires_at=least(stamp+interval '60 seconds',created_at+interval '320 seconds') where id=p_id;return true;
end $$;
create or replace function public.finish_dynamic_session_capture(p_project_id uuid,p_id uuid,p_token uuid,p_success boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.dynamic_session_captures;stamp timestamptz;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));select * into item from public.dynamic_session_captures where id=p_id and project_id=p_project_id for update;stamp:=clock_timestamp();
 if not found or item.actor_id<>auth.uid() or item.token is distinct from p_token or item.state<>'open' or item.expires_at<=stamp then return null;end if;
 if item.cancel_requested then p_success:=false;end if;
 update public.dynamic_session_captures set state=case when p_success then 'completed' else 'cancelled' end where id=p_id;
 update public.dynamic_environment_data set state=case when p_success then 'unprepared' else 'cleanup_required' end,prepared_version=null,preparation=null where profile_id=item.profile_id;
 return jsonb_build_object('state',case when p_success then 'completed' else 'cancelled' end);
end $$;
create or replace function public.request_cancel_dynamic_session_capture(p_project_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));update public.dynamic_session_captures set cancel_requested=true where id=p_id and project_id=p_project_id and state='open';
end $$;
revoke all on function public.recover_dynamic_session_captures(uuid),public.require_no_dynamic_session_capture(uuid),public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text),public.heartbeat_dynamic_session_capture(uuid,uuid,uuid),public.finish_dynamic_session_capture(uuid,uuid,uuid,boolean),public.request_cancel_dynamic_session_capture(uuid,uuid) from public;
grant execute on function public.recover_dynamic_session_captures(uuid),public.acquire_dynamic_session_capture(uuid,uuid,uuid,uuid,text),public.heartbeat_dynamic_session_capture(uuid,uuid,uuid),public.finish_dynamic_session_capture(uuid,uuid,uuid,boolean),public.request_cancel_dynamic_session_capture(uuid,uuid) to authenticated;
-- Wrap existing atomic operations; authenticated callers cannot bypass the guards.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_session_guard(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_session_guard;end if;
 if to_regprocedure('public.start_dynamic_hook_without_session_guard(uuid,uuid,text,text,jsonb)') is null then alter function public.start_dynamic_hook(uuid,uuid,text,text,jsonb) rename to start_dynamic_hook_without_session_guard;end if;
 if to_regprocedure('public.save_dynamic_environment_without_session_guard(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_session_guard;end if;
 if to_regprocedure('public.read_dynamic_environment_data_without_session_recovery(uuid,uuid)') is null then alter function public.read_dynamic_environment_data(uuid,uuid) rename to read_dynamic_environment_data_without_session_recovery;end if;
 if to_regprocedure('public.record_dynamic_environment_data_without_session_guard(uuid,uuid,text,text,text)') is null then alter function public.record_dynamic_environment_data(uuid,uuid,text,text,text) rename to record_dynamic_environment_data_without_session_guard;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_session_guard(uuid,jsonb,uuid),public.read_dynamic_environment_data_without_session_recovery(uuid,uuid),public.start_dynamic_run_without_session_guard(uuid,uuid,uuid,text),public.start_dynamic_hook_without_session_guard(uuid,uuid,text,text,jsonb),public.record_dynamic_environment_data_without_session_guard(uuid,uuid,text,text,text) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$begin if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));if not exists(select 1 from public.dynamic_runs where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_session_capture(p_project_id);end if;return public.start_dynamic_run_without_session_guard(p_project_id,p_actor_id,p_revision_id,p_key);end $$;
create or replace function public.start_dynamic_hook(p_project_id uuid,p_profile_id uuid,p_kind text,p_key text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$begin if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));if not exists(select 1 from public.dynamic_hook_operations where project_id=p_project_id and idempotency_key=p_key) then perform public.require_no_dynamic_session_capture(p_project_id);end if;return public.start_dynamic_hook_without_session_guard(p_project_id,p_profile_id,p_kind,p_key,p_command);end $$;
create or replace function public.record_dynamic_environment_data(p_project_id uuid,p_profile_id uuid,p_kind text,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$begin perform public.require_no_dynamic_session_capture(p_project_id);return public.record_dynamic_environment_data_without_session_guard(p_project_id,p_profile_id,p_kind,p_outcome,p_note);end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_hook(uuid,uuid,text,text,jsonb),public.record_dynamic_environment_data(uuid,uuid,text,text,text) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_hook(uuid,uuid,text,text,jsonb),public.record_dynamic_environment_data(uuid,uuid,text,text,text) to authenticated;

create or replace function public.read_dynamic_environment_data(p_project_id uuid,p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$begin perform public.recover_dynamic_session_captures(p_project_id);return public.read_dynamic_environment_data_without_session_recovery(p_project_id,p_profile_id);end $$;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$begin perform public.require_no_dynamic_session_capture(p_project_id);return public.save_dynamic_environment_without_session_guard(p_project_id,p_input,p_id);end $$;
revoke all on function public.read_dynamic_environment_data(uuid,uuid),public.save_dynamic_environment(uuid,jsonb,uuid) from public;
grant execute on function public.read_dynamic_environment_data(uuid,uuid),public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;
