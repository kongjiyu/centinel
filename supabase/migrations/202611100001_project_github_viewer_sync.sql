-- Match immutable GitHub account IDs against authenticated linked identities.
-- Only project owners can grant access. Existing project roles are preserved.
create or replace function public.add_project_viewers_by_github_identity(p_project_id uuid, p_github_ids text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  added integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.projects where id = p_project_id and owner_id = auth.uid()
  ) then
    raise insufficient_privilege;
  end if;
  if cardinality(p_github_ids) > 10000 then
    raise exception 'Too many GitHub collaborators to sync.';
  end if;

  insert into public.project_members (project_id, user_id, role)
  select distinct p_project_id, i.user_id, 'viewer'
  from auth.identities i
  where i.provider = 'github' and i.provider_id = any(p_github_ids)
    and i.user_id <> auth.uid()
  on conflict (project_id, user_id) do nothing;

  get diagnostics added = row_count;
  return added;
end $$;

revoke all on function public.add_project_viewers_by_github_identity(uuid, text[]) from public, anon;
grant execute on function public.add_project_viewers_by_github_identity(uuid, text[]) to authenticated;
