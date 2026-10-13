-- Manual preparation/cleanup ledger. Dirty-data locks never expire silently.
create table if not exists public.dynamic_environment_data (
 profile_id uuid primary key, project_id uuid not null, state text not null default 'unprepared' check(state in ('unprepared','ready','in_use','cleanup_required')),
 prepared_version integer, preparation jsonb, run_id uuid references public.dynamic_runs(id),
 foreign key(profile_id,project_id) references public.dynamic_environments(id,project_id) on delete cascade
);
create table if not exists public.dynamic_environment_events (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,
 profile_id uuid not null references public.dynamic_environments(id),run_id uuid references public.dynamic_runs(id),
 kind text not null check(kind in ('preparation','cleanup')),outcome text not null check(outcome in ('completed','failed')),
 note text not null,actor_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.dynamic_environment_data enable row level security;
alter table public.dynamic_environment_events enable row level security;
drop policy if exists dynamic_data_read on public.dynamic_environment_data;
create policy dynamic_data_read on public.dynamic_environment_data for select to authenticated using(public.is_project_member(project_id));
drop policy if exists dynamic_data_events_read on public.dynamic_environment_events;
create policy dynamic_data_events_read on public.dynamic_environment_events for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_environment_data,public.dynamic_environment_events from public,anon,authenticated;
grant select on public.dynamic_environment_data,public.dynamic_environment_events to authenticated;
create or replace function public.read_dynamic_environment_data(p_project_id uuid,p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data; profile public.dynamic_environments; result jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 if not found then raise no_data_found; end if;
 insert into public.dynamic_environment_data(profile_id,project_id) values(p_profile_id,p_project_id) on conflict do nothing;
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if row_data.state='in_use' and exists(select 1 from public.dynamic_runs where id=row_data.run_id and state not in ('queued','running')) then
  update public.dynamic_environment_data set state='cleanup_required' where profile_id=p_profile_id;row_data.state:='cleanup_required';
 end if;
 if row_data.state='ready' and row_data.prepared_version<>profile.version then
  update public.dynamic_environment_data set state='unprepared' where profile_id=p_profile_id;row_data.state:='unprepared';
 end if;
 result:=jsonb_build_object('profileId',p_profile_id,'state',row_data.state,'preparedVersion',row_data.prepared_version,'preparation',row_data.preparation,'runId',row_data.run_id,
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'runId',run_id,'kind',kind,'outcome',outcome,'note',note,'actorId',actor_id,'createdAt',created_at) order by created_at desc) from public.dynamic_environment_events where profile_id=p_profile_id),'[]'::jsonb));
 return result;
end $$;
create or replace function public.record_dynamic_environment_data(p_project_id uuid,p_profile_id uuid,p_kind text,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.dynamic_environment_data; profile public.dynamic_environments; prepared_snapshot jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 if p_kind not in ('preparation','cleanup') or p_outcome not in ('completed','failed') or p_note is null or length(btrim(p_note)) not between 3 and 2000 then raise exception 'Record a bounded preparation/cleanup note'; end if;
 perform public.read_dynamic_environment_data(p_project_id,p_profile_id);
 select * into profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 select * into row_data from public.dynamic_environment_data where profile_id=p_profile_id for update;
 if row_data.state='in_use' then raise exception 'Run is still active'; end if;
 if p_kind='preparation' and row_data.state='cleanup_required' then raise exception 'Complete cleanup before preparation'; end if;
 if p_kind='cleanup' and row_data.state<>'cleanup_required' then raise exception 'No completed run needs cleanup'; end if;
 insert into public.dynamic_environment_events(project_id,profile_id,run_id,kind,outcome,note,actor_id) values(p_project_id,p_profile_id,case when p_kind='cleanup' then row_data.run_id else null end,p_kind,p_outcome,btrim(p_note),auth.uid());
 if p_kind='preparation' then
  prepared_snapshot:=jsonb_build_object('note',btrim(p_note),'actorId',auth.uid(),'at',clock_timestamp(),'profileVersion',profile.version);
  update public.dynamic_environment_data set state=case when p_outcome='completed' then 'ready' else 'unprepared' end,prepared_version=profile.version,preparation=prepared_snapshot,run_id=null where profile_id=p_profile_id;
 elsif p_outcome='completed' then
  update public.dynamic_environment_data set state='unprepared',prepared_version=null,preparation=null,run_id=null where profile_id=p_profile_id;
 end if;
 return public.read_dynamic_environment_data(p_project_id,p_profile_id);
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;profile public.dynamic_environments;fresh_run_id uuid;data_state jsonb;snapshot jsonb;can_execute boolean;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 result:=public.start_dynamic_run(p_project_id,p_actor_id,p_revision_id,p_key);fresh_run_id:=(result->'run'->>'id')::uuid;
 if result->>'reused'='true' then
  if result->'run'->'environment'->>'id' is distinct from p_environment->>'id' then raise exception 'Idempotency environment conflict'; end if;
  return result;
 end if;
 select * into profile from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id for update;
 if not found or profile.version<>(p_environment->>'version')::integer then raise exception 'Environment changed; repeat preflight'; end if;
 data_state:=public.read_dynamic_environment_data(p_project_id,profile.id);
 can_execute:=jsonb_typeof(p_environment->'preflight')='array' and jsonb_array_length(p_environment->'preflight')>0 and not exists(select 1 from jsonb_array_elements(p_environment->'preflight') check_row where check_row->>'ready' is distinct from 'true');
 if can_execute then
  if data_state->>'state'<>'ready' then raise exception 'Prepare clean data before execution'; end if;
  update public.dynamic_environment_data set state='in_use',run_id=fresh_run_id where profile_id=profile.id;
 end if;
 snapshot:=profile.payload||jsonb_build_object('variableNames',p_environment->'variableNames','preflight',p_environment->'preflight','checkedAt',p_environment->'checkedAt','preparation',data_state->'preparation');
 result:=jsonb_set(result,'{run,environment}',snapshot);update public.dynamic_runs set payload=result->'run' where id=fresh_run_id;
 return result;
end $$;
revoke all on function public.read_dynamic_environment_data(uuid,uuid) from public;
revoke all on function public.record_dynamic_environment_data(uuid,uuid,text,text,text) from public;
grant execute on function public.read_dynamic_environment_data(uuid,uuid) to authenticated;
grant execute on function public.record_dynamic_environment_data(uuid,uuid,text,text,text) to authenticated;
