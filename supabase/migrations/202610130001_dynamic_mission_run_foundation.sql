-- Additive Dynamic foundation. Legacy SQLite sessions/evidence remain untouched.
-- Payloads are versioned application DTOs. Only guarded RPCs may mutate them.
create table if not exists public.dynamic_missions (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (id, project_id)
);
create table if not exists public.dynamic_mission_revisions (
  id uuid primary key,
  project_id uuid not null,
  mission_id uuid not null,
  revision integer not null check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (mission_id, project_id) references public.dynamic_missions(id, project_id) on delete cascade,
  unique (mission_id, revision),
  unique (id, project_id)
);
create table if not exists public.dynamic_runs (
  id uuid primary key,
  project_id uuid not null,
  mission_id uuid not null,
  revision_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  state text not null check (state in ('queued','running','completed','blocked','cancelled','interrupted')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (mission_id, project_id) references public.dynamic_missions(id, project_id) on delete cascade,
  foreign key (revision_id, project_id) references public.dynamic_mission_revisions(id, project_id),
  unique (project_id, idempotency_key)
);
create unique index if not exists dynamic_one_active_run_per_project
  on public.dynamic_runs(project_id) where state in ('queued','running');

alter table public.dynamic_missions enable row level security;
alter table public.dynamic_mission_revisions enable row level security;
alter table public.dynamic_runs enable row level security;
drop policy if exists dynamic_missions_read on public.dynamic_missions;
create policy dynamic_missions_read on public.dynamic_missions for select to authenticated using (public.is_project_member(project_id));
drop policy if exists dynamic_revisions_read on public.dynamic_mission_revisions;
create policy dynamic_revisions_read on public.dynamic_mission_revisions for select to authenticated using (public.is_project_member(project_id));
drop policy if exists dynamic_runs_read on public.dynamic_runs;
create policy dynamic_runs_read on public.dynamic_runs for select to authenticated using (public.is_project_member(project_id));
revoke all on public.dynamic_missions, public.dynamic_mission_revisions, public.dynamic_runs from anon, authenticated;
grant select on public.dynamic_missions, public.dynamic_mission_revisions, public.dynamic_runs to authenticated;

create or replace function public.save_dynamic_revision(p_project_id uuid, p_actor_id uuid, p_input jsonb, p_mission_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m uuid := coalesce(p_mission_id, gen_random_uuid());
  r uuid := gen_random_uuid();
  n integer;
  stamp timestamptz := now();
  result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if jsonb_typeof(p_input->'checks') <> 'array' or jsonb_array_length(p_input->'checks') < 1 then raise exception 'Checks required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));
  if p_mission_id is not null and not exists(select 1 from public.dynamic_missions where id = m and project_id = p_project_id) then raise no_data_found; end if;
  insert into public.dynamic_missions(id,project_id,payload,created_at)
    values(m,p_project_id,jsonb_build_object('id',m,'projectId',p_project_id,'currentRevisionId',r,'createdBy',p_actor_id,'createdAt',stamp),stamp)
    on conflict(id) do nothing;
  select coalesce(max(revision),0)+1 into n from public.dynamic_mission_revisions where mission_id = m;
  -- Select supported fields explicitly; caller cannot override server identity/version fields.
  result := jsonb_build_object('name',p_input->'name','goal',p_input->'goal','targetUrl',p_input->'targetUrl',
    'maxSteps',p_input->'maxSteps','checks',p_input->'checks','context',p_input->'context','contextAcknowledged',p_input->'contextAcknowledged',
    'id',r,'projectId',p_project_id,'missionId',m,'revision',n,'createdBy',p_actor_id,'createdAt',stamp);
  insert into public.dynamic_mission_revisions(id,project_id,mission_id,revision,payload,created_at) values(r,p_project_id,m,n,result,stamp);
  update public.dynamic_missions set payload = jsonb_set(payload,'{currentRevisionId}',to_jsonb(r)) where id = m;
  return result;
end $$;

create or replace function public.start_dynamic_run(p_project_id uuid, p_actor_id uuid, p_revision_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  revision_row public.dynamic_mission_revisions;
  existing public.dynamic_runs;
  run_id uuid := gen_random_uuid();
  stamp timestamptz := now();
  result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_key is null or length(btrim(p_key)) not between 1 and 128 then raise exception 'Idempotency key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));
  select * into revision_row from public.dynamic_mission_revisions where id = p_revision_id and project_id = p_project_id;
  if not found then raise no_data_found; end if;
  select * into existing from public.dynamic_runs where project_id = p_project_id and idempotency_key = p_key;
  if found then
    if existing.revision_id <> p_revision_id or existing.payload->>'createdBy' <> p_actor_id::text then raise exception 'Idempotency conflict'; end if;
    return jsonb_build_object('run',existing.payload,'reused',true);
  end if;
  result := jsonb_build_object('id',run_id,'projectId',p_project_id,'missionId',revision_row.mission_id,'revision',revision_row.payload,
    'idempotencyKey',p_key,'createdBy',p_actor_id,'createdAt',stamp,'updatedAt',stamp,
    'state','queued','verdict','not_tested','reason',null,'checks','[]'::jsonb,'evidence','[]'::jsonb,'legacySessionId',null);
  insert into public.dynamic_runs(id,project_id,mission_id,revision_id,idempotency_key,state,payload,created_at)
    values(run_id,p_project_id,revision_row.mission_id,p_revision_id,p_key,'queued',result,stamp);
  return jsonb_build_object('run',result,'reused',false);
end $$;

create or replace function public.transition_dynamic_run(p_project_id uuid, p_run_id uuid, p_expected text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_record public.dynamic_runs;
  next_state text := p_patch->>'state';
  result jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  if p_expected not in ('queued','running') or next_state is null or not
    (next_state in ('blocked','cancelled','interrupted') or (p_expected = 'queued' and next_state = 'running') or (p_expected = 'running' and next_state = 'completed')) then raise exception 'Invalid transition'; end if;
  select * into row_record from public.dynamic_runs where id = p_run_id and project_id = p_project_id for update;
  if not found or row_record.state <> p_expected then return null; end if;
  -- Members can cancel, but only the initiating actor can execute/finalize their Run.
  if next_state <> 'cancelled' and row_record.payload->>'createdBy' <> auth.uid()::text then raise insufficient_privilege; end if;
  if p_patch->>'verdict' is null or p_patch->>'verdict' not in ('passed','failed','uncertain','not_tested') then raise exception 'Invalid verdict'; end if;
  if next_state <> 'completed' and p_patch->>'verdict' <> 'not_tested' then raise exception 'Unverified outcome'; end if;
  result := row_record.payload || jsonb_build_object('state',next_state,'verdict',p_patch->'verdict','reason',p_patch->'reason',
    'checks',p_patch->'checks','evidence',p_patch->'evidence','legacySessionId',p_patch->'legacySessionId','updatedAt',now());
  update public.dynamic_runs set state = next_state, payload = result where id = p_run_id;
  return result;
end $$;

revoke all on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) from public;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text) from public;
revoke all on function public.transition_dynamic_run(uuid,uuid,text,jsonb) from public;
grant execute on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.transition_dynamic_run(uuid,uuid,text,jsonb) to authenticated;
