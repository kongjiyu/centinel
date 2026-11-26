begin;

insert into auth.users (id, email) values
  ('10101010-1010-4010-8010-101010101010', 'conversation-owner@example.test'),
  ('20202020-2020-4020-8020-202020202020', 'conversation-viewer@example.test');
insert into public.projects (id, owner_id, name) values
  ('30303030-3030-4030-8030-303030303030', '10101010-1010-4010-8010-101010101010', 'Conversation owner scope fixture');
insert into public.project_members (project_id, user_id, role) values
  ('30303030-3030-4030-8030-303030303030', '20202020-2020-4020-8020-202020202020', 'viewer');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10101010-1010-4010-8010-101010101010', true);
insert into public.audit_events (project_id, actor_id, event_type, entity_type, payload) values
  ('30303030-3030-4030-8030-303030303030', auth.uid(), 'project_conversation_request', 'project_conversation',
    jsonb_build_object('request', jsonb_build_object('ownerId', auth.uid(), 'state', 'accepted'))),
  ('30303030-3030-4030-8030-303030303030', auth.uid(), 'fixture_audit_event', 'fixture', '{}');

do $$
begin
  update public.audit_events set payload = jsonb_set(payload, '{request,state}', '"completed"')
    where project_id = '30303030-3030-4030-8030-303030303030' and entity_type = 'project_conversation';
  if not found then raise exception 'Owner could not update the transcript'; end if;
end $$;

select set_config('request.jwt.claim.sub', '20202020-2020-4020-8020-202020202020', true);
do $$
begin
  if (select count(*) from public.audit_events where project_id = '30303030-3030-4030-8030-303030303030') <> 1
    or not exists (select 1 from public.audit_events where project_id = '30303030-3030-4030-8030-303030303030'
      and entity_type = 'fixture') then
    raise exception 'Viewer must see only the shared audit event';
  end if;
end $$;

rollback;
