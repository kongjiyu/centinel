-- Isolated fixture database only; no application data is retained.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;replay jsonb;
begin
 if has_function_privilege('authenticated','public.start_dynamic_run_without_visual_protocol(uuid,uuid,uuid,text)','execute') or has_function_privilege('authenticated','public.start_dynamic_environment_run_without_visual_protocol(uuid,uuid,uuid,text,jsonb)','execute') then raise exception 'Private starter exposed';end if;
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Visual protocol","goal":"Ready","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'visual-protocol');
 if started->'run'->'executionVersions'->>'visual' is distinct from '1' then raise exception 'Fresh Run lacks visual protocol';end if;
 replay:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'visual-protocol');
 if replay->>'reused'<>'true' or replay->'run' is distinct from started->'run' then raise exception 'Replay changed frozen Run';end if;
 raise notice 'PASS: visual protocol frozen on creation, replay immutable, private starters revoked';
end $$;
rollback;
