-- Run as the dashboard SQL editor role. All fixture writes are rolled back.
-- Uses an existing auth user without printing their identity or touching their projects.
begin;
create temporary table repository_index_test_fixture as
select id as user_id, gen_random_uuid() as project_id, gen_random_uuid() as artifact_id,
       gen_random_uuid() as outsider_id, repeat('a', 64) as fingerprint
from auth.users order by created_at limit 1;
do $$ begin
  if (select count(*) from repository_index_test_fixture) <> 1 then raise exception 'An existing authenticated user is required'; end if;
end $$;
grant select on repository_index_test_fixture to authenticated;
insert into public.projects(id, owner_id, name)
select project_id, user_id, 'ROLLBACK repository index retention fixture' from repository_index_test_fixture;
insert into public.artifacts(id, project_id, path, name)
select artifact_id, project_id, 'retention-fixture.ts', 'retention-fixture.ts' from repository_index_test_fixture;
insert into storage.objects(bucket_id, name, user_metadata)
select 'project-artifacts', project_id::text || '/_repository-index/open-codebase-index-0.38.1/' || fingerprint || '.json.gz',
       jsonb_build_object('schemaVersion', 1, 'fingerprint', fingerprint, 'artifactIds', jsonb_build_array(artifact_id::text))
from repository_index_test_fixture;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from repository_index_test_fixture), true);
select set_config('storage.operation', 'storage.object.get_authenticated', true);
do $$ begin
  if not storage.allow_any_operation(array['object.get_authenticated']) then raise exception 'Operation test setup failed'; end if;
  if public.repository_index_storage_ready() <> 1 then raise exception 'Readiness RPC failed'; end if;
  if (select count(*) from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%') <> 1
    then raise exception 'Live member download was denied'; end if;
end $$;
select set_config('storage.operation', 'storage.object.sign', true);
do $$ begin
  if exists (select 1 from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%')
    then raise exception 'Signed URL access was allowed'; end if;
end $$;
select set_config('storage.operation', 'storage.object.get_authenticated', true);
select set_config('request.jwt.claim.sub', (select outsider_id::text from repository_index_test_fixture), true);
do $$ begin
  if exists (select 1 from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%')
    then raise exception 'Nonmember download was allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select user_id::text from repository_index_test_fixture), true);
-- Only the disposable artifact created above is deleted; rollback restores everything.
delete from public.artifacts where id = (select artifact_id from repository_index_test_fixture);
do $$ begin
  if not exists (select 1 from public.storage_deletion_objects obj join repository_index_test_fixture f
    on obj.target_id = f.artifact_id and obj.path like f.project_id::text || '/_repository-index/%')
    then raise exception 'Artifact deletion did not queue index cleanup'; end if;
end $$;
set local role authenticated;
select set_config('storage.operation', 'storage.object.get_authenticated', true);
do $$ begin
  if exists (select 1 from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%')
    then raise exception 'Cleanup owner could download a deleted-source index'; end if;
end $$;
select set_config('storage.operation', 'storage.object.sign', true);
do $$ begin
  if exists (select 1 from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%')
    then raise exception 'Cleanup owner could sign a deleted-source index'; end if;
end $$;
select set_config('storage.operation', 'storage.object.delete_many', true);
do $$ begin
  if (select count(*) from storage.objects obj join repository_index_test_fixture f on obj.name like f.project_id::text || '/_repository-index/%') <> 1
    then raise exception 'Cleanup manifest could not select a queued object for deletion'; end if;
end $$;
reset role;
rollback;
notify pgrst, 'reload schema';
select 'PASS: live member read, outsider denial, signing denial, retention trigger, deleted-source download/signing denial, cleanup selection, authenticated readiness RPC; all fixture writes rolled back' as result;
