begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;rev jsonb;started jsonb;old_run jsonb;replay jsonb;bad jsonb;
begin
 env:=public.save_dynamic_environment(p,'{"name":"Budget fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture","budgets":{"runtimeMs":20000,"maxSteps":4,"maxModelCalls":2,"maxConsoleBytes":2048}}');
 if env->'budgets'->>'maxObservationChars'<>'32000' then raise exception 'Compatible defaults absent';end if;
 foreach bad in array array['{"runtimeMs":0}'::jsonb,'{"runtimeMs":300001}','{"maxSteps":1.5}','{"maxModelCalls":"2"}','{"maxConsoleBytes":null}','{"unknown":1}','[]','null'] loop
  begin perform public.save_dynamic_environment(p,env||jsonb_build_object('budgets',bad),(env->>'id')::uuid);raise exception 'Invalid budget accepted';exception when raise_exception then if sqlerrm='Invalid budget accepted' then raise;end if;end;
 end loop;
 perform public.record_dynamic_environment_data(p,(env->>'id')::uuid,'preparation','completed','Clean read-only baseline');
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Budget snapshot","goal":"Read heading","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Heading","kind":"visible_text","expected":"Sign in","required":true}]}');
 started:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'budget-run',env||'{"variableNames":[],"preflight":[{"name":"ready","ready":true}],"budgets":{"runtimeMs":300000}}');
 old_run:=started->'run';
 if old_run->'executionBudget'->>'runtimeMs'<>'20000' or old_run->'executionBudget'->>'maxSteps'<>'2' or old_run->'environment'->'budgets'->>'maxSteps'<>'4' then raise exception 'Caller replaced durable limits or step min missing';end if;
 perform public.transition_dynamic_run(p,(old_run->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');
 env:=public.save_dynamic_environment(p,env||'{"budgets":{"runtimeMs":30000,"maxSteps":1,"maxModelCalls":1}}',(env->>'id')::uuid);
 replay:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'budget-run',env);
 if replay->'run'->'executionBudget' is distinct from old_run->'executionBudget' then raise exception 'Profile edit altered Run budgets';end if;
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'default-budget-run');
 if started->'run'->'executionBudget'->>'runtimeMs'<>'300000' or started->'run'->'executionBudget'->>'maxSteps'<>'2' then raise exception 'URL-only defaults not frozen';end if;
 if has_function_privilege('authenticated','public.normalize_dynamic_execution_budget(jsonb)','execute') or has_function_privilege('authenticated','public.start_dynamic_environment_run_without_budget_snapshot(uuid,uuid,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.save_dynamic_environment_without_budget_validation(uuid,jsonb,uuid)','execute') then raise exception 'Private budget helpers exposed';end if;
 raise notice 'PASS: bounds, SQL-owned defaults, immutable snapshots, stricter steps, replay and private helpers';
end $$;
rollback;
