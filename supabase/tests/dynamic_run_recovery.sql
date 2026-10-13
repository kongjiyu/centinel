-- Isolated test database only; fixture bootstrap + both Dynamic migrations.
begin;
create temporary table recovery_test(revision_id uuid, run_id uuid);
grant all on recovery_test to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare rev jsonb; started jsonb; result jsonb; local_run_id uuid; project uuid := '11111111-1111-4111-8111-111111111111';
begin
  rev := public.save_dynamic_revision(project,auth.uid(),'{"name":"Recovery test","goal":"Verify page","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"contextAcknowledged":false,"checks":[{"id":"one","criterionId":"one","description":"URL","kind":"url","expected":"http://localhost:3000/","required":true}]}'::jsonb);
  started := public.start_dynamic_run(project,auth.uid(),(rev->>'id')::uuid,'sql-recovery-one'); local_run_id := (started->'run'->>'id')::uuid;
  insert into recovery_test values((rev->>'id')::uuid,local_run_id);
  result := public.claim_dynamic_run(project,local_run_id,'worker-one','11111111-2222-4333-8444-555555555555','local-partial-session');
  if result->>'state' <> 'running' or result->'lease'->>'workerId' <> 'worker-one' then raise exception 'Claim failed'; end if;
  if public.claim_dynamic_run(project,local_run_id,'worker-two','22222222-2222-4333-8444-555555555555',null) is not null then raise exception 'Duplicate claim accepted'; end if;
  if not public.heartbeat_dynamic_run(project,local_run_id,'worker-one','11111111-2222-4333-8444-555555555555') then raise exception 'Heartbeat failed'; end if;
  if public.heartbeat_dynamic_run(project,local_run_id,'worker-two','22222222-2222-4333-8444-555555555555') then raise exception 'Wrong worker borrowed lease'; end if;
  if jsonb_array_length(public.recover_dynamic_runs(project)) <> 0 then raise exception 'Healthy worker interrupted'; end if;
  if public.transition_dynamic_run(project,local_run_id,'running','{"state":"completed","verdict":"passed","checks":[],"evidence":[],"legacySessionId":"local-partial-session"}'::jsonb) is not null then raise exception 'Unfenced completion accepted'; end if;
  begin
    perform lease_token from public.dynamic_run_leases where dynamic_run_leases.run_id=local_run_id;
    raise exception 'Private fencing token exposed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
  if jsonb_array_length(public.recover_dynamic_runs(project)) <> 0 then raise exception 'Second member interrupted a healthy worker'; end if;
end $$;
reset role;
update public.dynamic_run_leases set expires_at=clock_timestamp()-interval '1 second' where run_id=(select run_id from recovery_test);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare result jsonb; project uuid := '11111111-1111-4111-8111-111111111111'; r uuid := (select run_id from recovery_test);
begin
  if public.heartbeat_dynamic_run(project,r,'worker-one','11111111-2222-4333-8444-555555555555') then raise exception 'Expired lease revived'; end if;
  if public.transition_dynamic_run(project,r,'running','{"state":"completed","verdict":"passed","checks":[],"evidence":[],"leaseToken":"11111111-2222-4333-8444-555555555555"}'::jsonb) is not null then raise exception 'Expired worker finalized'; end if;
  result := public.recover_dynamic_runs(project);
  if jsonb_array_length(result) <> 1 or result->0->>'state' <> 'interrupted' or result->0->>'verdict' <> 'not_tested' or result->0->>'legacySessionId' <> 'local-partial-session' then raise exception 'Interrupted recovery lost history'; end if;
  if jsonb_array_length(public.recover_dynamic_runs(project)) <> 0 then raise exception 'Recovery not idempotent'; end if;
  result := public.start_dynamic_run(project,auth.uid(),(select revision_id from recovery_test),'sql-recovery-one');
  if result->'run'->>'state' <> 'interrupted' or result->>'reused' <> 'true' then raise exception 'Replay restarted work'; end if;
  result := public.start_dynamic_run(project,auth.uid(),(select revision_id from recovery_test),'sql-recovery-queued');
  update recovery_test set run_id=(result->'run'->>'id')::uuid;
end $$;
reset role;
update public.dynamic_runs set created_at=clock_timestamp()-interval '91 seconds' where id=(select run_id from recovery_test);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare project uuid := '11111111-1111-4111-8111-111111111111'; r uuid := (select run_id from recovery_test); result jsonb;
begin
  if public.claim_dynamic_run(project,r,'late-worker','11111111-2222-4333-8444-555555555555',null) is not null then raise exception 'Stale queue claimed'; end if;
  result := public.recover_dynamic_runs(project);
  if jsonb_array_length(result) <> 1 or result->0->>'state' <> 'interrupted' then raise exception 'Stale queue not recovered'; end if;
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  begin
    perform public.recover_dynamic_runs(project);
    raise exception 'Non-member recovered another project';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: leases, heartbeats, worker fencing, member/non-member recovery, expired and abandoned work, immutable history';
end $$;
rollback;
