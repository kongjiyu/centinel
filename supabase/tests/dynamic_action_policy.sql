begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;rev jsonb;started jsonb;old_run jsonb;replay jsonb;bad jsonb;policy jsonb:='{"schemaVersion":1,"interactions":[{"selector":"#save","actions":["click"]},{"selector":"#name","actions":["type"]}],"allowCoordinates":false}';
begin
 env:=public.save_dynamic_environment(p,'{"name":"Action policy fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture"}'::jsonb||jsonb_build_object('actionPolicy',policy));
 if env->'actionPolicy' is distinct from policy then raise exception 'Policy not saved';end if;
 foreach bad in array array['null'::jsonb,'[]','{"schemaVersion":1,"interactions":[],"allowCoordinates":"yes"}','{"schemaVersion":1,"interactions":[{"selector":"#x","actions":["delete"]}],"allowCoordinates":false}','{"schemaVersion":1,"interactions":[{"selector":"#x","actions":["click","click"]}],"allowCoordinates":false}','{"schemaVersion":1,"interactions":[{"selector":"#x","actions":["click"]},{"selector":"#x","actions":["type"]}],"allowCoordinates":false}','{"schemaVersion":1,"interactions":[],"allowCoordinates":false,"pageGrant":true}'] loop
  begin perform public.save_dynamic_environment(p,env||jsonb_build_object('actionPolicy',bad),(env->>'id')::uuid);raise exception 'Invalid policy accepted';exception when raise_exception then if sqlerrm='Invalid policy accepted' then raise;end if;end;
 end loop;
 perform public.record_dynamic_environment_data(p,(env->>'id')::uuid,'preparation','completed','Clean fixture baseline');
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Frozen action policy","goal":"Observe controls","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Heading","kind":"visible_text","expected":"Sign in","required":true}]}');
 started:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'action-policy-run',env||'{"variableNames":[],"preflight":[{"name":"ready","ready":true}],"actionPolicy":{"schemaVersion":1,"interactions":[{"selector":"*","actions":["click"]}],"allowCoordinates":true}}');old_run:=started->'run';
 if old_run->'actionPolicy' is distinct from policy or old_run->'environment'->'actionPolicy' is distinct from policy or old_run->'executionVersions'->>'policy'<>'1' then raise exception 'Caller changed frozen authority or versions missing';end if;
 perform public.transition_dynamic_run(p,(old_run->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');
 env:=public.save_dynamic_environment(p,env||'{"actionPolicy":{"schemaVersion":1,"interactions":[],"allowCoordinates":false}}',(env->>'id')::uuid);
 replay:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'action-policy-run',env);
 if replay->'run'->'actionPolicy' is distinct from policy or replay->'run'->'executionVersions' is distinct from old_run->'executionVersions' then raise exception 'Replay rewrote frozen policy';end if;
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'no-environment-policy');
 if started->'run'->'actionPolicy'->'interactions'<>'[]'::jsonb or started->'run'->'actionPolicy'->>'allowCoordinates'<>'false' then raise exception 'No-environment grants not denied by default';end if;
 if has_function_privilege('authenticated','public.normalize_dynamic_action_policy(jsonb)','execute') or has_function_privilege('authenticated','public.save_dynamic_environment_without_action_policy(uuid,jsonb,uuid)','execute') or has_function_privilege('authenticated','public.start_dynamic_run_without_action_policy(uuid,uuid,uuid,text)','execute') or has_function_privilege('authenticated','public.start_dynamic_environment_run_without_action_policy(uuid,uuid,uuid,text,jsonb)','execute') then raise exception 'Private policy helpers exposed';end if;
 raise notice 'PASS: policy bounds, database authority, immutable replay, no-environment defaults, engine versions and private helpers';
end $$;
rollback;
