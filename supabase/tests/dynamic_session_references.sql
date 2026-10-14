begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';profile jsonb;revision jsonb;run jsonb;env_id uuid;
begin
 profile:=public.save_dynamic_environment(p,'{"name":"Session fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"QA","requiredVariables":[],"startupInstructions":"Manual sign-in","targetVersion":"fixture","sessionReference":"qa-session","sessionReadySelector":"[data-authenticated]","storageState":{"cookies":[{"value":"must-not-share"}]}}');env_id:=(profile->>'id')::uuid;
 if profile->>'sessionReference'<>'qa-session' or profile?'storageState' then raise exception 'Reference-only profile contract failed';end if;
 revision:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Authenticated fixture","goal":"Observe signed-in state","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Heading","kind":"visible_text","expected":"Ready","required":true}]}'::jsonb);
 perform public.record_dynamic_environment_data(p,env_id,'preparation','completed','Fixture baseline verified');
 run:=public.start_dynamic_environment_run(p,auth.uid(),(revision->>'id')::uuid,'session-snapshot',profile||jsonb_build_object('variableNames','[]'::jsonb,'preflight','[{"name":"fixture","ready":true}]'::jsonb,'sessionSnapshot','{"reference":"qa-session","version":"11111111-2222-4222-8222-111111111111","expiresAt":"2026-12-01T00:00:00Z","rawToken":"must-not-share"}'::jsonb||jsonb_build_object('expiresAt',clock_timestamp()+interval '1 hour')));
 if run->'run'->'environment'->'sessionSnapshot'?'rawToken' or run->'run'->'environment'->'sessionSnapshot'->>'version'<>'11111111-2222-4222-8222-111111111111' then raise exception 'Session snapshot whitelist failed';end if;
 profile:=public.save_dynamic_environment(p,profile||'{"sessionReference":"replacement-session"}',env_id);
 if (select payload->'environment'->>'sessionReference' from public.dynamic_runs where id=(run->'run'->>'id')::uuid)<>'qa-session' then raise exception 'Reference edit changed earlier Run';end if;
 raise notice 'PASS: reference-only metadata, immutable session snapshot and raw-value whitelist';
end $$;
rollback;
