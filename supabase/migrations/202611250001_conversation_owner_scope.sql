-- Conversation rows can contain private transcripts. Keep the shared audit
-- policy for other event types and require matching record ownership here.
create policy audit_events_conversation_owner
  on public.audit_events
  as restrictive
  for all
  to authenticated
  using (
    entity_type is distinct from 'project_conversation'
    or (actor_id = (select auth.uid())
      and payload #>> '{request,ownerId}' = (select auth.uid())::text)
  )
  with check (
    entity_type is distinct from 'project_conversation'
    or (actor_id = (select auth.uid())
      and payload #>> '{request,ownerId}' = (select auth.uid())::text)
  );
