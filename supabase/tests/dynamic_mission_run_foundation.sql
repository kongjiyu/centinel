-- Run only in an isolated test database with the fixture projects/roles from
-- the documented bootstrap. The transaction rolls back its own test records.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare
  project uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  rev jsonb;
  next_rev jsonb;
  started jsonb;
  replay jsonb;
  run_id uuid;
  final jsonb;
  n integer;
  patch jsonb := '{"state":"running","verdict":"not_tested","reason":null,"checks":[],"evidence":[],"legacySessionId":null}'::jsonb;
begin
  rev := public.save_dynamic_revision(project,actor,'{"name":"Test","goal":"Test","targetUrl":"http://localhost:3000","maxSteps":1,"checks":[{"id":"one","criterionId":"one","kind":"url","expected":"http://localhost:3000/","required":true}],"context":null,"contextAcknowledged":false}'::jsonb);
  started := public.start_dynamic_run(project,actor,(rev->>'id')::uuid,'sql-test-one');
  run_id := (started->'run'->>'id')::uuid;
  replay := public.start_dynamic_run(project,actor,(rev->>'id')::uuid,'sql-test-one');
  if replay->>'reused' <> 'true' or replay->'run'->>'id' <> run_id::text then raise exception 'Replay duplicated Run'; end if;
  perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
  select count(*) into n from public.dynamic_runs where id=run_id;
  if n <> 1 then raise exception 'Member cannot read shared Run'; end if;
  begin
    perform public.transition_dynamic_run(project,run_id,'queued',patch);
    raise exception 'Expected initiator-only claim denial';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin
    perform public.start_dynamic_run(project,actor,(rev->>'id')::uuid,'sql-test-other');
    raise exception 'Expected active-run denial';
  exception when unique_violation then null;
  end;
  final := public.transition_dynamic_run(project,run_id,'queued',patch);
  if final->>'state' <> 'running' then raise exception 'Claim failed'; end if;
  if public.transition_dynamic_run(project,run_id,'queued',patch) is not null then raise exception 'Duplicate claim accepted'; end if;
  final := public.transition_dynamic_run(project,run_id,'running',patch || '{"state":"cancelled"}'::jsonb);
  if final->>'state' <> 'cancelled' then raise exception 'Cancel failed'; end if;
  if public.transition_dynamic_run(project,run_id,'running',patch || '{"state":"completed","verdict":"passed"}'::jsonb) is not null then raise exception 'Late pass overwrote cancellation'; end if;
  next_rev := public.save_dynamic_revision(project,actor,rev || '{"goal":"Changed"}'::jsonb,(rev->>'missionId')::uuid);
  if (next_rev->>'revision')::integer <> 2 then raise exception 'Revision not incremented'; end if;
  select count(*) into n from public.dynamic_runs where id=run_id and payload->'revision'->>'goal'='Test';
  if n <> 1 then raise exception 'Historical snapshot mutated'; end if;
  begin
    perform public.start_dynamic_run(project,actor,(next_rev->>'id')::uuid,'sql-test-one');
    raise exception 'Expected idempotency conflict';
  exception when raise_exception then
    if sqlerrm <> 'Idempotency conflict' then raise; end if;
  end;
  begin
    update public.dynamic_mission_revisions set payload='{}'::jsonb where id=(rev->>'id')::uuid;
    raise exception 'Expected immutable revision denial';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  select count(*) into n from public.dynamic_runs where project_id=project;
  if n <> 0 then raise exception 'Non-member RLS leak'; end if;
  begin
    perform public.start_dynamic_run(project,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',(rev->>'id')::uuid,'forbidden');
    raise exception 'Expected cross-project denial';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin
    perform public.start_dynamic_run(project,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',(rev->>'id')::uuid,'spoofed');
    raise exception 'Expected actor spoof denial';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: revisions, idempotency, active lock, CAS, cancellation, history, immutable writes, RLS and actor binding';
end $$;
rollback;
