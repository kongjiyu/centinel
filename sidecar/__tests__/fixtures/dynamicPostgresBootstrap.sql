-- ISOLATED TEST DATABASE ONLY. Not a Supabase deployment migration.
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.projects(id uuid primary key, owner_id uuid not null);
create table public.project_members(project_id uuid, user_id uuid);
create function public.is_project_member(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from projects where id=p_id and owner_id=auth.uid()) or exists(select 1 from project_members where project_id=p_id and user_id=auth.uid())$$;
grant usage on schema public,auth to authenticated;
grant select on projects,project_members to authenticated;
insert into projects values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into projects values('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into project_members values('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
