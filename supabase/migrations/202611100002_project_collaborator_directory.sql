-- Pending access binds to the stable GitHub identity, never a public email or login.
create table public.project_pending_github_viewers (
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  github_id text not null check (github_id ~ '^[1-9][0-9]{0,15}$'),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (project_id, github_id)
);
create index project_pending_github_viewers_identity_idx on public.project_pending_github_viewers(github_id);
alter table public.project_pending_github_viewers enable row level security;
revoke all on public.project_pending_github_viewers from public, anon, authenticated;

create function public.search_project_collaborator_identities(p_project_id uuid, p_email text, p_github_ids text[])
returns table(centinel_id uuid, github_id text, state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()
  ) then raise insufficient_privilege; end if;
  if cardinality(p_github_ids) > 20 or length(p_email) > 320 then raise invalid_parameter_value; end if;

  return query
    select u.id, i.provider_id,
      case when u.id = auth.uid() or pm.user_id is not null then 'joined' else 'available' end
    from auth.users u
    left join auth.identities i on i.user_id = u.id and i.provider = 'github' and i.provider_id = any(p_github_ids)
    left join public.project_members pm on pm.project_id = p_project_id and pm.user_id = u.id
    where p_email is not null and lower(u.email) = lower(p_email) and u.email_confirmed_at is not null
      and u.deleted_at is null;

  return query
    select null::uuid, ids.id,
      case when i.user_id = auth.uid() or pm.user_id is not null then 'joined'
           when pending.github_id is not null then 'pending'
           else 'available' end
    from (select distinct unnest(p_github_ids) as id) ids
    left join auth.identities i on i.provider = 'github' and i.provider_id = ids.id
    left join public.project_members pm on pm.project_id = p_project_id and pm.user_id = i.user_id
    left join public.project_pending_github_viewers pending
      on pending.project_id = p_project_id and pending.github_id = ids.id and pending.owner_id = auth.uid() and pending.expires_at > now();
end $$;

create function public.add_project_collaborator_viewer(p_project_id uuid, p_centinel_id uuid, p_github_id text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
begin
  perform 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() for share;
  if not found then raise insufficient_privilege; end if;
  if (p_centinel_id is null) = (p_github_id is null)
    or (p_github_id is not null and p_github_id !~ '^[1-9][0-9]{0,15}$') then
    raise invalid_parameter_value;
  end if;

  if p_centinel_id is not null then
    select u.id into target_id from auth.users u
      where u.id = p_centinel_id and u.email_confirmed_at is not null and u.deleted_at is null;
    if target_id is null then raise no_data_found; end if;
  else
    select i.user_id into target_id from auth.identities i
      join auth.users u on u.id = i.user_id and u.deleted_at is null
      where i.provider = 'github' and i.provider_id = p_github_id for share of i;
    if target_id is null then
      insert into public.project_pending_github_viewers (project_id, owner_id, github_id)
        values (p_project_id, auth.uid(), p_github_id)
        on conflict (project_id, github_id) do update set owner_id = excluded.owner_id, expires_at = excluded.expires_at
          where project_pending_github_viewers.owner_id <> excluded.owner_id or project_pending_github_viewers.expires_at <= now();
      return 'pending';
    end if;
    delete from public.project_pending_github_viewers pending
      where pending.project_id = p_project_id and pending.github_id = p_github_id;
  end if;

  if target_id <> auth.uid() then
    insert into public.project_members (project_id, user_id, role)
      values (p_project_id, target_id, 'viewer') on conflict (project_id, user_id) do nothing;
  end if;
  return 'joined';
end $$;

create function public.claim_project_github_viewer_access()
returns void
language sql security definer set search_path = '' as $$
  with eligible_projects as (
    select p.id, p.owner_id, pending.github_id
    from public.project_pending_github_viewers pending
    join public.projects p on p.id = pending.project_id and p.owner_id = pending.owner_id
    join auth.identities i on i.provider = 'github' and i.provider_id = pending.github_id and i.user_id = auth.uid()
    where pending.expires_at > now()
    for share of p, i
  ), claimed as (
    delete from public.project_pending_github_viewers pending
      using eligible_projects p
      where pending.project_id = p.id and pending.github_id = p.github_id and pending.owner_id = p.owner_id and pending.expires_at > now()
      returning pending.project_id, pending.owner_id
  )
  insert into public.project_members (project_id, user_id, role)
    select distinct project_id, auth.uid(), 'viewer' from claimed where owner_id <> auth.uid()
    on conflict (project_id, user_id) do nothing;
$$;

create function public.cancel_project_github_viewer(p_project_id uuid, p_github_id text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() for update;
  if not found then raise insufficient_privilege; end if;
  delete from public.project_pending_github_viewers pending
    where pending.project_id = p_project_id and pending.github_id = p_github_id and pending.owner_id = auth.uid();
  return found;
end $$;

-- Revoke both current access and any older grant for the member's linked identity.
create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() for update;
  if not found then raise insufficient_privilege using message = 'Only the project owner can remove members.'; end if;
  if p_user_id = auth.uid() then raise exception 'The project owner cannot be removed.'; end if;
  delete from public.project_pending_github_viewers pending using auth.identities i
    where pending.project_id = p_project_id and pending.github_id = i.provider_id
      and i.provider = 'github' and i.user_id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
end $$;

revoke all on function public.search_project_collaborator_identities(uuid, text, text[]),
  public.add_project_collaborator_viewer(uuid, uuid, text), public.claim_project_github_viewer_access(),
  public.cancel_project_github_viewer(uuid, text) from public, anon;
grant execute on function public.search_project_collaborator_identities(uuid, text, text[]),
  public.add_project_collaborator_viewer(uuid, uuid, text), public.claim_project_github_viewer_access(),
  public.cancel_project_github_viewer(uuid, text) to authenticated;
