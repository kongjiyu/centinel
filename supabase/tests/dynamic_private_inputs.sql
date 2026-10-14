begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;rev jsonb;started jsonb;replay jsonb;grants jsonb:='[{"selector":"#password","variable":"BROWSER_PASSWORD","origin":"http://localhost:3000"}]';bad jsonb;
begin
 env:=public.save_dynamic_environment(p,'{"name":"Private input fixture","targetUrl":"http://localhost:3000/signin","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":["BROWSER_PASSWORD"],"startupInstructions":"Manual","targetVersion":"fixture"}');env:=public.save_dynamic_private_inputs(p,(env->>'id')::uuid,(env->>'version')::integer,grants);
 if env->'actionPolicy'->'privateInputs' is distinct from grants then raise exception 'Private references not stored';end if;
 foreach bad in array array[grants||grants,jsonb_set(grants,'{0,value}','"private-value"'),jsonb_set(grants,'{0,variable}','"UNDECLARED"'),jsonb_set(grants,'{0,origin}','"http://outside.test"')] loop
  begin perform public.save_dynamic_private_inputs(p,(env->>'id')::uuid,(env->>'version')::integer,bad);raise exception 'Invalid private grant accepted';exception when raise_exception then if sqlerrm='Invalid private grant accepted' then raise;end if;end;
 end loop;
 perform public.record_dynamic_environment_data(p,(env->>'id')::uuid,'preparation','completed','Private references configured; values available only locally');
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Private login","goal":"Sign in","targetUrl":"http://localhost:3000/signin","maxSteps":4,"context":null,"checks":[{"id":"one","criterionId":"one","kind":"url","expected":"http://localhost:3000/","required":true}]}');
 started:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'private-input-run',env||'{"variableNames":["BROWSER_PASSWORD"],"preflight":[{"name":"ready","ready":true}]}');if started->'run'->'actionPolicy'->'privateInputs' is distinct from grants or started->'run'->'executionVersions'->>'privateInputs'<>'1' then raise exception 'Private references not frozen';end if;
 replay:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'private-input-run',env);if replay->'run' is distinct from started->'run' then raise exception 'Replay changed frozen references';end if;
 raise notice 'PASS: bounded references, approved origins/names, immutable Run metadata and replay';
end $$;
rollback;
