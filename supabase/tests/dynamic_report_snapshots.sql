begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;ret jsonb;rid uuid;report_id uuid:=gen_random_uuid();snapshot jsonb;other jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Report capture","goal":"Read","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');ret:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'report-snapshot');rid:=(ret->'run'->>'id')::uuid;
 begin perform public.capture_dynamic_report(p,rid,report_id);raise exception 'Active Run captured';exception when raise_exception then if sqlerrm='Active Run captured' then raise;end if;end;
 perform public.transition_dynamic_run(p,rid,'queued','{"state":"cancelled","verdict":"not_tested"}');
 snapshot:=public.capture_dynamic_report(p,rid,report_id);
 if snapshot->'run'->>'state'<>'cancelled' or snapshot->'run'->>'verdict'<>'not_tested' or snapshot->'metadata'->>'actorId'<>auth.uid()::text or snapshot->'metadata'->>'schemaVersion'<>'centinel-dynamic-report-v1' then raise exception 'Wrong snapshot outcome';end if;
 if snapshot->'run' ? 'lease' or snapshot->'run' ? 'idempotencyKey' or snapshot->'run' ? 'legacySessionId' then raise exception 'Runtime internals leaked';end if;
 if public.capture_dynamic_report(p,rid,report_id) is distinct from snapshot then raise exception 'Capture replay changed bytes';end if;
 other:=public.capture_dynamic_report(p,rid,gen_random_uuid());if other->'metadata'->>'reportId'=snapshot->'metadata'->>'reportId' then raise exception 'New version replaced old';end if;
 begin update public.dynamic_report_snapshots set payload='{}' where dynamic_report_snapshots.id=report_id;raise exception 'Direct mutation accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 if (select payload from public.dynamic_report_snapshots where dynamic_report_snapshots.id=report_id) is distinct from snapshot then raise exception 'Member cannot read frozen result';end if;
 begin perform public.capture_dynamic_report(p,rid,report_id);raise exception 'Other actor reused capture nonce';exception when insufficient_privilege then null;end;
 perform public.capture_dynamic_report(p,rid,gen_random_uuid());
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 if exists(select 1 from public.dynamic_report_snapshots where dynamic_report_snapshots.id=report_id) then raise exception 'Nonmember metadata leaked';end if;
 begin perform public.capture_dynamic_report(p,rid,gen_random_uuid());raise exception 'Nonmember captured report';exception when insufficient_privilege then null;end;
 raise notice 'PASS: stopped-only capture, immutable replay/history, member reading and nonmember isolation';
end $$;
reset role;
delete from public.project_members where project_id='11111111-1111-4111-8111-111111111111' and user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
do $$ begin
 if exists(select 1 from public.dynamic_report_snapshots where project_id='11111111-1111-4111-8111-111111111111') then raise exception 'Revoked member retained report access';end if;
 begin perform public.capture_dynamic_report('11111111-1111-4111-8111-111111111111',gen_random_uuid(),gen_random_uuid());raise exception 'Revoked member captured report';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare safe jsonb;begin
 safe:=public._dynamic_report_safe('{"inputTokens":null,"maxAccountedTokens":40,"token":"seeded-secret","password":"secret","objectPath":"private/path","note":"File /Users/synthetic/private/file.txt"}');
 if safe ? 'password' or safe ? 'token' or safe ? 'objectPath' or safe->>'note' like '%/Users/%' or safe->>'maxAccountedTokens'<>'40' or not(safe ? 'inputTokens') then raise exception 'Export privacy or usage semantics failed';end if;
end $$;
rollback;
