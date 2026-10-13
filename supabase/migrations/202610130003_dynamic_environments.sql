-- Shared profiles contain names/references only; values remain encrypted locally.
create table if not exists public.dynamic_environments (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 payload jsonb not null, version integer not null default 1, updated_at timestamptz not null default now(), unique(id,project_id)
);
alter table public.dynamic_environments enable row level security;
drop policy if exists dynamic_environments_read on public.dynamic_environments;
create policy dynamic_environments_read on public.dynamic_environments for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_environments from public,anon,authenticated;
grant select on public.dynamic_environments to authenticated;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare env_id uuid:=coalesce(p_id,gen_random_uuid()); current_version integer; result jsonb; stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select version into current_version from public.dynamic_environments where id=env_id and project_id=p_project_id;
 if p_id is not null and not found then raise no_data_found; end if;
 current_version:=coalesce(current_version,0)+1;
 result:=jsonb_build_object('id',env_id,'projectId',p_project_id,'version',current_version,'updatedBy',auth.uid(),'updatedAt',stamp,
 'name',p_input->'name','targetUrl',p_input->'targetUrl','allowedOrigins',p_input->'allowedOrigins','viewport',p_input->'viewport',
 'accountRole',p_input->'accountRole','requiredVariables',p_input->'requiredVariables','startupInstructions',p_input->'startupInstructions','targetVersion',p_input->'targetVersion');
 if jsonb_typeof(result->'requiredVariables')<>'array' or jsonb_typeof(result->'allowedOrigins')<>'array' or length(result->>'name') not between 1 and 120 then raise exception 'Invalid environment'; end if;
 insert into public.dynamic_environments(id,project_id,payload,version,updated_at) values(env_id,p_project_id,result,current_version,stamp)
 on conflict(id) do update set payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at;
 return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; profile public.dynamic_environments; run_id uuid;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
 result:=public.start_dynamic_run(p_project_id,p_actor_id,p_revision_id,p_key);
 run_id:=(result->'run'->>'id')::uuid;
 if result->>'reused'='true' then
  if result->'run'->'environment'->>'id' is distinct from p_environment->>'id' then raise exception 'Idempotency environment conflict'; end if;
  return result;
 end if;
 select * into profile from public.dynamic_environments where id=(p_environment->>'id')::uuid and project_id=p_project_id for share;
 if not found or profile.version<>(p_environment->>'version')::integer then raise exception 'Environment changed; repeat preflight'; end if;
 -- Freeze database-owned profile metadata, append sanitized preflight only.
 result:=jsonb_set(result,'{run,environment}',profile.payload||jsonb_build_object('variableNames',p_environment->'variableNames','preflight',p_environment->'preflight','checkedAt',p_environment->'checkedAt'));
 update public.dynamic_runs set payload=result->'run' where id=run_id;
 return result;
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public;
revoke all on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;
grant execute on function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
