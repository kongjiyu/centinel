-- Find the recent conversation turns in index order without scanning and
-- sorting unrelated audit events. Keep the existing RLS policies in effect.
create index if not exists audit_events_project_entity_event_recent_idx
  on public.audit_events (project_id, entity_type, event_type, created_at desc, id desc);
