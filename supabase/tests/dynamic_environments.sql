-- Disposable fixture database only. Requires all three Dynamic migrations.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare env jsonb; changed jsonb; revision jsonb; started jsonb; replay jsonb; project uuid:='11111111-1111-4111-8111-111111111111'; env_id uuid; run_id uuid;
begin
 env:=public.save_dynamic_environment(project,'{"name":"Local","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"test","requiredVariables":["TEST_PASSWORD"],"startupInstructions":"Start manually","targetVersion":"commit-one","values":{"TEST_PASSWORD":"MUST-NOT-PERSIST"}}'::jsonb);
 if env ? 'values' or env::text like '%MUST-NOT-PERSIST%' then raise exception 'Secret input persisted'; end if;
 env_id:=(env->>'id')::uuid;
 revision:=public.save_dynamic_revision(project,auth.uid(),'{"name":"Smoke","goal":"Check form","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"contextAcknowledged":false,"checks":[{"id":"one","criterionId":"one","description":"Heading","kind":"visible_text","expected":"Sign in","required":true}]}'::jsonb);
 started:=public.start_dynamic_environment_run(project,auth.uid(),(revision->>'id')::uuid,'env-sql-one',env||'{"variableNames":["TEST_PASSWORD"],"preflight":[],"checkedAt":"2026-10-13T00:00:00Z"}'::jsonb);
 run_id:=(started->'run'->>'id')::uuid;
 changed:=public.save_dynamic_environment(project,env||'{"targetVersion":"commit-two"}'::jsonb,env_id);
 if changed->>'version'<>'2' then raise exception 'No revision update'; end if;
 if (select payload->'environment'->>'targetVersion' from public.dynamic_runs where id=run_id)<>'commit-one' then raise exception 'Historical environment rewritten'; end if;
 replay:=public.start_dynamic_environment_run(project,auth.uid(),(revision->>'id')::uuid,'env-sql-one',env);
 if replay->>'reused'<>'true' or replay->'run'->'environment'->>'version'<>'1' then raise exception 'Replay lost original environment'; end if;
 perform public.transition_dynamic_run(project,run_id,'queued','{"state":"cancelled","verdict":"not_tested","reason":"SQL acceptance","checks":[],"evidence":[]}'::jsonb);
 begin
  perform public.start_dynamic_environment_run(project,auth.uid(),(revision->>'id')::uuid,'env-sql-stale',env);
  raise exception 'Stale environment accepted';
 exception when raise_exception then if sqlerrm='Stale environment accepted' then raise; end if;
 end;
 if exists(select 1 from public.dynamic_runs where idempotency_key='env-sql-stale') then raise exception 'Failed start leaked a queued run'; end if;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 if exists(select 1 from public.dynamic_environments where id=env_id) then raise exception 'Nonmember read environment'; end if;
 begin
  perform public.save_dynamic_environment(project,env,env_id);raise exception 'Nonmember mutated environment';
 exception when insufficient_privilege then null;
 end;
 raise notice 'PASS: environment RLS, field whitelist, immutable Run snapshot, replay and stale version rollback';
end $$;
rollback;
