-- Persist the latest GitHub collaborator snapshot per Centinel project.
-- All reads and writes use the caller's Supabase bearer token and project RLS.

create table if not exists public.github_project_collaborators (
  project_id uuid not null references public.projects(id) on delete cascade,
  github_user_id bigint not null,
  login text not null,
  avatar_url text not null default '',
  html_url text not null default '',
  account_type text not null default 'User',
  permission text not null default 'unknown',
  synced_at timestamptz not null,
  primary key (project_id, github_user_id)
);

create index if not exists github_project_collaborators_project_login_idx
  on public.github_project_collaborators(project_id, login);

-- Keep the last successful sync even when GitHub returns zero collaborators.
create table if not exists public.github_project_collaborator_syncs (
  project_id uuid primary key references public.projects(id) on delete cascade,
  synced_at timestamptz not null
);

alter table public.github_project_collaborators enable row level security;
grant select, insert, update, delete on public.github_project_collaborators to authenticated;
alter table public.github_project_collaborator_syncs enable row level security;
grant select, insert, update on public.github_project_collaborator_syncs to authenticated;

drop policy if exists github_project_collaborators_member_read on public.github_project_collaborators;
create policy github_project_collaborators_member_read
  on public.github_project_collaborators for select to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id));

drop policy if exists github_project_collaborators_member_write on public.github_project_collaborators;
create policy github_project_collaborators_member_write
  on public.github_project_collaborators for all to authenticated
  using (
    auth.uid() is not null
    and public.is_project_member(project_id)
    and (
      exists (select 1 from public.projects p where p.id = github_project_collaborators.project_id and p.owner_id = auth.uid())
      or exists (select 1 from public.project_members pm where pm.project_id = github_project_collaborators.project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'member'))
    )
  )
  with check (
    auth.uid() is not null
    and public.is_project_member(project_id)
    and (
      exists (select 1 from public.projects p where p.id = github_project_collaborators.project_id and p.owner_id = auth.uid())
      or exists (select 1 from public.project_members pm where pm.project_id = github_project_collaborators.project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'member'))
    )
  );

drop policy if exists github_project_collaborator_syncs_member_read on public.github_project_collaborator_syncs;
create policy github_project_collaborator_syncs_member_read
  on public.github_project_collaborator_syncs for select to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id));

drop policy if exists github_project_collaborator_syncs_member_write on public.github_project_collaborator_syncs;
create policy github_project_collaborator_syncs_member_write
  on public.github_project_collaborator_syncs for all to authenticated
  using (
    auth.uid() is not null
    and public.is_project_member(project_id)
    and (
      exists (select 1 from public.projects p where p.id = github_project_collaborator_syncs.project_id and p.owner_id = auth.uid())
      or exists (select 1 from public.project_members pm where pm.project_id = github_project_collaborator_syncs.project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'member'))
    )
  )
  with check (
    auth.uid() is not null
    and public.is_project_member(project_id)
    and (
      exists (select 1 from public.projects p where p.id = github_project_collaborator_syncs.project_id and p.owner_id = auth.uid())
      or exists (select 1 from public.project_members pm where pm.project_id = github_project_collaborator_syncs.project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'member'))
    )
  );

-- Replace a single project's snapshot atomically. The RPC runs as the bearer
-- caller and its table writes remain protected by the table's RLS policies.
create or replace function public.replace_github_project_collaborators(
  p_project_id uuid,
  p_collaborators jsonb,
  p_synced_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  if not (
    exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'member'))
  ) then
    raise exception 'Project owner or member access is required to sync collaborators' using errcode = '42501';
  end if;

  if p_collaborators is null or jsonb_typeof(p_collaborators) <> 'array' or p_synced_at is null then
    raise exception 'Invalid GitHub collaborator snapshot' using errcode = '22023';
  end if;

  delete from public.github_project_collaborators
  where project_id = p_project_id;

  insert into public.github_project_collaborators (
    project_id, github_user_id, login, avatar_url, html_url, account_type, permission, synced_at
  )
  select
    p_project_id,
    collaborator.github_user_id,
    collaborator.login,
    coalesce(collaborator.avatar_url, ''),
    coalesce(collaborator.html_url, ''),
    coalesce(nullif(collaborator.account_type, ''), 'User'),
    coalesce(nullif(collaborator.permission, ''), 'unknown'),
    p_synced_at
  from jsonb_to_recordset(p_collaborators) as collaborator(
    github_user_id bigint,
    login text,
    avatar_url text,
    html_url text,
    account_type text,
    permission text
  );

  get diagnostics inserted_count = row_count;
  insert into public.github_project_collaborator_syncs (project_id, synced_at)
  values (p_project_id, p_synced_at)
  on conflict (project_id) do update set synced_at = excluded.synced_at;
  return inserted_count;
end;
$$;

revoke all on function public.replace_github_project_collaborators(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.replace_github_project_collaborators(uuid, jsonb, timestamptz) to authenticated;
