-- Phase 3A decisions and private supportive evidence.
--
-- The sidecar calls submit_review_decision through the same bearer-authenticated
-- Supabase client used for all other project operations.  The function is
-- SECURITY INVOKER intentionally: RLS, auth.uid(), and Storage policies remain
-- the authorization boundary.  No service-role credential is required.

alter table public.review_decisions
  add column if not exists actor_id uuid references auth.users(id) on delete set null;
alter table public.review_decisions
  add column if not exists idempotency_key text;
create unique index if not exists review_decisions_project_idempotency_idx
  on public.review_decisions(project_id, idempotency_key)
  where idempotency_key is not null;

alter table public.review_decision_attachments
  add column if not exists review_session_id uuid references public.review_sessions(id) on delete cascade;
alter table public.review_decision_attachments
  add column if not exists byte_size bigint not null default 0;
alter table public.review_decision_attachments
  add column if not exists content_hash text not null default '';
update public.review_decision_attachments attachment
set review_session_id = decision.review_session_id
from public.review_decisions decision
where attachment.decision_id = decision.id
  and attachment.review_session_id is null;
create index if not exists review_decision_attachments_review_idx
  on public.review_decision_attachments(project_id, review_session_id, decision_id, created_at, id);
create unique index if not exists review_decision_attachments_storage_idx
  on public.review_decision_attachments(decision_id, storage_path);

alter table public.review_operations
  add column if not exists parent_review_id uuid references public.review_sessions(id) on delete cascade;
alter table public.review_operations
  add column if not exists decision_id uuid references public.review_decisions(id) on delete set null;
alter table public.review_operations
  drop constraint if exists review_operations_operation_check;
alter table public.review_operations
  add constraint review_operations_operation_check check (
    operation in ('start', 'cancel', 'retry', 'prepare_iteration', 'start_iteration',
                  'record_decision', 'request_changes')
  );

-- Re-state the member policies with an explicit authenticated subject. This
-- also makes the newly-added denormalized review_session_id useful to callers
-- without weakening project isolation.
alter table public.review_decisions enable row level security;
alter table public.review_decision_attachments enable row level security;
alter table public.review_operations enable row level security;
drop policy if exists review_decisions_member on public.review_decisions;
create policy review_decisions_member on public.review_decisions
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));
drop policy if exists review_decision_attachments_member on public.review_decision_attachments;
create policy review_decision_attachments_member on public.review_decision_attachments
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));
drop policy if exists review_operations_member on public.review_operations;
create policy review_operations_member on public.review_operations
  for all to authenticated
  using (auth.uid() is not null and public.is_project_member(project_id))
  with check (auth.uid() is not null and public.is_project_member(project_id));

-- The older migrations allowed arbitrary object names after the first project
-- folder. Replace those policies for this bucket with the exact
-- <project>/<review>/<decision>/<file> shape used by the command service.
do $$
declare
  policy_name text;
begin
  foreach policy_name in array array[
    'decision_attachments_read', 'decision_attachments_write',
    'decision_attachments_update', 'decision_attachments_delete',
    'decision_attachments_phase1_read', 'decision_attachments_phase1_write',
    'decision_attachments_phase1_update', 'decision_attachments_phase1_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects;', policy_name);
  end loop;
end $$;
drop policy if exists decision_attachments_phase3_read on storage.objects;
drop policy if exists decision_attachments_phase3_write on storage.objects;
drop policy if exists decision_attachments_phase3_update on storage.objects;
drop policy if exists decision_attachments_phase3_delete on storage.objects;
create policy decision_attachments_phase3_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'decision-attachments'
    and name ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$'
    and public.is_project_member(public.storage_project_id(name))
  );
create policy decision_attachments_phase3_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'decision-attachments'
    and name ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$'
    and public.is_project_member(public.storage_project_id(name))
  );
create policy decision_attachments_phase3_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'decision-attachments'
    and name ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$'
    and public.is_project_member(public.storage_project_id(name))
  )
  with check (
    bucket_id = 'decision-attachments'
    and name ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$'
    and public.is_project_member(public.storage_project_id(name))
  );
create policy decision_attachments_phase3_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'decision-attachments'
    and name ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$'
    and public.is_project_member(public.storage_project_id(name))
  );

create or replace function public.submit_review_decision(
  p_project_id uuid,
  p_review_id uuid,
  p_actor_id uuid,
  p_decision_id uuid,
  p_decision text,
  p_comment text,
  p_reviewer text,
  p_idempotency_key text,
  p_source_choice text,
  p_child_review_id uuid,
  p_child_idempotency_key text,
  p_attachment_metadata jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  parent_row public.review_sessions%rowtype;
  decision_row public.review_decisions%rowtype;
  child_row public.review_sessions%rowtype;
  operation_row public.review_operations%rowtype;
  attachment_row jsonb;
  operation_name text;
  feedback text := coalesce(p_comment, '');
  reviewer_name text := coalesce(p_reviewer, '');
  now_value timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'an authenticated user is required';
  end if;
  if p_actor_id is null or p_actor_id <> auth.uid() then
    raise exception 'decision actor must match the authenticated user';
  end if;
  if p_project_id is null or not public.is_project_member(p_project_id) then
    raise exception 'project membership is required';
  end if;
  if p_review_id is null or p_decision_id is null then
    raise exception 'project, review, and decision identifiers are required';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'commented') then
    raise exception 'invalid review decision';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required';
  end if;
  if length(p_idempotency_key) > 255 then
    raise exception 'idempotency key is too long';
  end if;

  operation_name := case when p_decision = 'changes_requested' then 'request_changes' else 'record_decision' end;
  if p_attachment_metadata is null then p_attachment_metadata := '[]'::jsonb; end if;
  if jsonb_typeof(p_attachment_metadata) <> 'array' then
    raise exception 'attachment metadata must be an array';
  end if;
  if jsonb_array_length(p_attachment_metadata) > 5 then
    raise exception 'too many decision attachments';
  end if;

  -- Fast idempotency recovery. The second identical lookup below is required
  -- after locking the parent because two authenticated callers can race here.
  select * into operation_row
  from public.review_operations
  where project_id = p_project_id
    and operation = operation_name
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if coalesce(operation_row.parent_review_id, operation_row.review_id) <> p_review_id then
      raise exception 'decision idempotency key belongs to another review';
    end if;
    if operation_row.decision_id is null then raise exception 'decision operation is incomplete'; end if;
    select * into decision_row from public.review_decisions where id = operation_row.decision_id;
    if not found then raise exception 'decision operation has no decision'; end if;
    if operation_name = 'request_changes' then
      select * into child_row from public.review_sessions where id = operation_row.review_id;
    end if;
    return jsonb_build_object(
      'operation', jsonb_build_object(
        'operation', operation_row.operation,
        'idempotencyKey', operation_row.idempotency_key,
        'projectId', operation_row.project_id,
        'reviewId', operation_row.review_id,
        'parentReviewId', operation_row.parent_review_id,
        'decisionId', operation_row.decision_id,
        'createdAt', operation_row.created_at
      ),
      'decision', jsonb_build_object(
        'id', decision_row.id,
        'projectId', decision_row.project_id,
        'reviewId', decision_row.review_session_id,
        'decision', decision_row.decision,
        'comment', decision_row.comment,
        'reviewer', decision_row.reviewer,
        'createdAt', decision_row.created_at,
        'attachments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'projectId', a.project_id, 'reviewId', a.review_session_id,
          'decisionId', a.decision_id, 'fileName', a.file_name, 'mimeType', a.mime_type,
          'byteSize', a.byte_size, 'contentHash', a.content_hash,
          'storagePath', a.storage_path, 'createdAt', a.created_at
        ) order by a.created_at, a.id) from public.review_decision_attachments a where a.decision_id = decision_row.id), '[]'::jsonb)
      ),
      'parent', (select jsonb_build_object('id', p.id, 'projectId', p.project_id, 'status', p.status, 'revision', p.revision)
                 from public.review_sessions p where p.id = p_review_id),
      'preparedChild', case when operation_name = 'request_changes' then to_jsonb(child_row) else null end
    );
  end if;

  select * into parent_row
  from public.review_sessions
  where id = p_review_id and project_id = p_project_id
  for update;
  if not found then raise exception 'review not found'; end if;

  -- Re-check the operation after the parent lock to make concurrent retries
  -- return the committed result instead of attempting a second child.
  select * into operation_row
  from public.review_operations
  where project_id = p_project_id
    and operation = operation_name
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if coalesce(operation_row.parent_review_id, operation_row.review_id) <> p_review_id then
      raise exception 'decision idempotency key belongs to another review';
    end if;
    if operation_row.decision_id is null then raise exception 'decision operation is incomplete'; end if;
    select * into decision_row from public.review_decisions where id = operation_row.decision_id;
    if not found then raise exception 'decision operation has no decision'; end if;
    if operation_name = 'request_changes' then select * into child_row from public.review_sessions where id = operation_row.review_id; end if;
    return jsonb_build_object(
      'operation', jsonb_build_object('operation', operation_row.operation, 'idempotencyKey', operation_row.idempotency_key, 'projectId', operation_row.project_id, 'reviewId', operation_row.review_id, 'parentReviewId', operation_row.parent_review_id, 'decisionId', operation_row.decision_id, 'createdAt', operation_row.created_at),
      'decision', jsonb_build_object('id', decision_row.id, 'projectId', decision_row.project_id, 'reviewId', decision_row.review_session_id, 'decision', decision_row.decision, 'comment', decision_row.comment, 'reviewer', decision_row.reviewer, 'createdAt', decision_row.created_at, 'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'projectId', a.project_id, 'reviewId', a.review_session_id, 'decisionId', a.decision_id, 'fileName', a.file_name, 'mimeType', a.mime_type, 'byteSize', a.byte_size, 'contentHash', a.content_hash, 'storagePath', a.storage_path, 'createdAt', a.created_at) order by a.created_at, a.id) from public.review_decision_attachments a where a.decision_id = decision_row.id), '[]'::jsonb)),
      'parent', (select jsonb_build_object('id', p.id, 'projectId', p.project_id, 'status', p.status, 'revision', p.revision) from public.review_sessions p where p.id = p_review_id),
      'preparedChild', case when operation_name = 'request_changes' then to_jsonb(child_row) else null end
    );
  end if;

  -- A second idempotency index protects callers that lost the operation row
  -- after a previous deployment. Reuse its decision instead of duplicating it.
  select * into decision_row
  from public.review_decisions
  where project_id = p_project_id and idempotency_key = p_idempotency_key;
  if found then
    raise exception 'decision idempotency key already exists without operation';
  end if;

  if p_decision = 'commented' then
    if parent_row.status in ('queued', 'running') then raise exception 'feedback can only be added after review reasoning has stopped'; end if;
  elsif parent_row.status not in ('pending_approval', 'completed', 'success', 'changes_requested') then
    raise exception 'approval decisions can only be recorded on a completed review';
  end if;

  if p_decision = 'changes_requested' then
    if p_source_choice not in ('reuse', 'refresh') then raise exception 'source reuse or refresh must be selected'; end if;
    if p_child_review_id is null or p_child_idempotency_key is null then raise exception 'prepared child identifiers are required'; end if;
    if p_source_choice = 'reuse' and parent_row.source_manifest_id is null then raise exception 'the parent review has no frozen source manifest to reuse'; end if;
  elsif p_child_review_id is not null or p_child_idempotency_key is not null then
    raise exception 'prepared child values are only valid for Request Changes';
  end if;

  insert into public.review_decisions (
    id, project_id, review_session_id, actor_id, decision, comment, reviewer,
    idempotency_key, created_at
  ) values (
    p_decision_id, p_project_id, p_review_id, p_actor_id, p_decision,
    feedback, reviewer_name, p_idempotency_key, now_value
  ) returning * into decision_row;

  for attachment_row in select value from jsonb_array_elements(p_attachment_metadata) loop
    if coalesce(attachment_row->>'id', '') = '' then raise exception 'attachment id is required'; end if;
    if coalesce(attachment_row->>'file_name', '') = '' or length(attachment_row->>'file_name') > 255 or (attachment_row->>'file_name') ~ '[\\/]'
      then raise exception 'attachment file name is invalid'; end if;
    if coalesce(attachment_row->>'mime_type', '') not in ('text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp')
      then raise exception 'attachment MIME type is not allowed'; end if;
    if coalesce(attachment_row->>'storage_path', '') <> (p_project_id::text || '/' || p_review_id::text || '/' || p_decision_id::text || '/' || split_part(attachment_row->>'storage_path', '/', 4)) then
      raise exception 'attachment storage path is outside the decision prefix';
    end if;
    if (attachment_row->>'storage_path') !~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/[0-9a-fA-F-]+/[^/]+$' then raise exception 'attachment storage path is invalid'; end if;
    if (attachment_row->>'storage_path') ~ '(^|/)\.\.(/|$)' then raise exception 'attachment storage path is invalid'; end if;
    if coalesce((attachment_row->>'byte_size')::bigint, 0) <= 0 or (attachment_row->>'byte_size')::bigint > 8388608 then raise exception 'attachment size is invalid'; end if;
    insert into public.review_decision_attachments (
      id, project_id, review_session_id, decision_id, storage_path, file_name,
      mime_type, byte_size, content_hash, created_at
    ) values (
      (attachment_row->>'id')::uuid, p_project_id, p_review_id, p_decision_id,
      attachment_row->>'storage_path', attachment_row->>'file_name',
      attachment_row->>'mime_type', (attachment_row->>'byte_size')::bigint,
      coalesce(attachment_row->>'content_hash', ''), now_value
    );
  end loop;

  if p_decision <> 'commented' then
    update public.review_sessions
    set status = p_decision,
        revision = coalesce(parent_row.revision, 0) + 1,
        updated_at = now_value
    where id = parent_row.id
    returning * into parent_row;
  end if;

  if p_decision = 'changes_requested' then
    insert into public.review_sessions (
      id, project_id, name, review_type, status, config, progress, remarks,
      final_summary, failure_reason, parent_review_id, idempotency_key,
      source_manifest_id, scope, lineage, iteration, revision, created_at, updated_at
    ) values (
      p_child_review_id, parent_row.project_id, parent_row.name || ' (Revision)',
      parent_row.review_type, 'prepared', parent_row.config, '{}'::jsonb,
      parent_row.remarks, '', '', parent_row.id, p_child_idempotency_key,
      case when p_source_choice = 'reuse' then parent_row.source_manifest_id else null end,
      parent_row.scope,
      jsonb_build_object('parentReviewId', parent_row.id, 'lineageRootId', coalesce(parent_row.lineage->>'lineageRootId', parent_row.id::text), 'reusedSourceManifest', p_source_choice = 'reuse'),
      jsonb_build_object('parentReviewId', parent_row.id, 'decisionId', decision_row.id, 'feedback', feedback, 'reviewer', reviewer_name, 'createdBy', p_actor_id, 'sourceChoice', p_source_choice, 'sourceManifestId', case when p_source_choice = 'reuse' then parent_row.source_manifest_id else null end, 'preparedAt', now_value),
      0, now_value, now_value
    ) returning * into child_row;

    insert into public.review_iterations (
      project_id, parent_review_id, child_review_id, decision_id, feedback,
      reviewer, created_by, source_choice, source_manifest_id, metadata, created_at
    ) values (
      p_project_id, parent_row.id, child_row.id, decision_row.id, feedback,
      reviewer_name, p_actor_id, p_source_choice,
      case when p_source_choice = 'reuse' then parent_row.source_manifest_id else null end,
      jsonb_build_object('preparedAt', now_value), now_value
    );
  end if;

  insert into public.review_operations (
    project_id, operation, idempotency_key, review_id, parent_review_id,
    decision_id, created_at
  ) values (
    p_project_id, operation_name, p_idempotency_key,
    case when p_decision = 'changes_requested' then child_row.id else parent_row.id end,
    case when p_decision = 'changes_requested' then parent_row.id else null end,
    decision_row.id, now_value
  ) returning * into operation_row;

  return jsonb_build_object(
    'operation', jsonb_build_object('operation', operation_row.operation, 'idempotencyKey', operation_row.idempotency_key, 'projectId', operation_row.project_id, 'reviewId', operation_row.review_id, 'parentReviewId', operation_row.parent_review_id, 'decisionId', operation_row.decision_id, 'createdAt', operation_row.created_at),
    'decision', jsonb_build_object('id', decision_row.id, 'projectId', decision_row.project_id, 'reviewId', decision_row.review_session_id, 'decision', decision_row.decision, 'comment', decision_row.comment, 'reviewer', decision_row.reviewer, 'createdAt', decision_row.created_at, 'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'projectId', a.project_id, 'reviewId', a.review_session_id, 'decisionId', a.decision_id, 'fileName', a.file_name, 'mimeType', a.mime_type, 'byteSize', a.byte_size, 'contentHash', a.content_hash, 'storagePath', a.storage_path, 'createdAt', a.created_at) order by a.created_at, a.id) from public.review_decision_attachments a where a.decision_id = decision_row.id), '[]'::jsonb)),
    'parent', jsonb_build_object('id', parent_row.id, 'projectId', parent_row.project_id, 'status', parent_row.status, 'revision', parent_row.revision),
    'preparedChild', case when p_decision = 'changes_requested' then to_jsonb(child_row) else null end
  );
end;
$function$;

grant execute on function public.submit_review_decision(
  uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, jsonb
) to authenticated;
