-- Project member management by email (PRD SHR-02, DYN-15, acceptance scenario 13).
-- Additive: existing project_members rows, RLS policies and GitHub collaborator
-- synchronisation are unchanged. auth.users is read only inside these
-- security-definer functions and only the matching member e-mail is returned.

create or replace function public.list_project_members(p_project_id uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege; end if;
  return query
    select p.owner_id, u.email::text, 'owner'::text, p.created_at
      from public.projects p join auth.users u on u.id = p.owner_id
     where p.id = p_project_id
    union all
    select pm.user_id, u.email::text, pm.role, pm.created_at
      from public.project_members pm join auth.users u on u.id = pm.user_id
      join public.projects p on p.id = pm.project_id
     where pm.project_id = p_project_id and pm.user_id <> p.owner_id
    order by 4, 2;
end $$;

create or replace function public.add_project_member_by_email(p_project_id uuid, p_email text, p_role text default 'member')
returns table(user_id uuid, email text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare target_id uuid; target_email text;
begin
  if auth.uid() is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()) then
    raise insufficient_privilege using message = 'Only the project owner can add members.';
  end if;
  if coalesce(p_role, '') not in ('member', 'viewer') then raise exception 'Choose member or viewer access.'; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 320 then raise exception 'Enter a valid e-mail address.'; end if;
  select u.id, u.email into target_id, target_email from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if target_id is null then raise exception 'No Centinel account uses this e-mail address. Ask them to sign up first.'; end if;
  if exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = target_id) then raise exception 'This person already owns the project.'; end if;
  insert into public.project_members as pm (project_id, user_id, role) values (p_project_id, target_id, p_role)
    on conflict on constraint project_members_pkey do update set role = excluded.role;
  return query select pm.user_id, target_email, pm.role, pm.created_at from public.project_members pm where pm.project_id = p_project_id and pm.user_id = target_id;
end $$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()) then
    raise insufficient_privilege using message = 'Only the project owner can remove members.';
  end if;
  if exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_user_id) then raise exception 'The project owner cannot be removed.'; end if;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
end $$;

revoke all on function public.list_project_members(uuid), public.add_project_member_by_email(uuid, text, text), public.remove_project_member(uuid, uuid) from public, anon;
grant execute on function public.list_project_members(uuid), public.add_project_member_by_email(uuid, text, text), public.remove_project_member(uuid, uuid) to authenticated;
