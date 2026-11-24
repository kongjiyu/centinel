-- Keep Review trace and recovery reads within their entity, in journal order.
create index if not exists audit_events_project_entity_journal_idx
  on public.audit_events (project_id, entity_type, entity_id, created_at, id);

-- Source-index jobs update the timestamp in the journal payload in place.
create index if not exists audit_events_source_index_latest_idx
  on public.audit_events (project_id, entity_type, event_type, (payload ->> 'ownerId'), (payload ->> 'updatedAt') desc, id desc);
