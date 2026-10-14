begin;
create temporary table hook_test(profile_id uuid,operation_id uuid,revision_id uuid);grant all on hook_test to authenticated;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;op jsonb;rev jsonb;hook_id uuid;profile uuid;token uuid:='11111111-3333-4333-8333-111111111111';
begin
 env:=public.save_dynamic_environment(p,'{"name":"Hook fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture"}'::jsonb);profile:=(env->>'id')::uuid;
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"No concurrent browser","goal":"Observe form","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Form","kind":"visible_text","expected":"Sign in","required":true}]}'::jsonb);
 op:=public.start_dynamic_hook(p,profile,'setup','hook-one','{"program":"pnpm","script":"setup","fingerprint":"fixture","gitCommit":null}'::jsonb);hook_id:=(op->'operation'->>'id')::uuid;insert into hook_test values(profile,hook_id,(rev->>'id')::uuid);
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'preparing' then raise exception 'No preparation lock';end if;
 begin perform public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'browser-during-hook');raise exception 'Browser ran concurrently';exception when raise_exception then if sqlerrm='Browser ran concurrently' then raise;end if;end;
 if public.start_dynamic_hook(p,profile,'setup','hook-one','{}'::jsonb)->>'reused'<>'true' then raise exception 'Hook replay restarted';end if;
 op:=public.claim_dynamic_hook(p,hook_id,'worker-one',token);if op->>'state'<>'running' then raise exception 'Claim failed';end if;
 if not public.heartbeat_dynamic_hook(p,hook_id,'worker-one',token) then raise exception 'No heartbeat';end if;
 if public.heartbeat_dynamic_hook(p,hook_id,'worker-other',token) then raise exception 'Borrowed worker';end if;
 begin perform lease_token from public.dynamic_hook_operations where dynamic_hook_operations.id=hook_id;raise exception 'Token readable';exception when insufficient_privilege then null;end;
 op:=public.finish_dynamic_hook(p,hook_id,token,'completed','{"outcome":"passed","exitCode":0,"signal":null,"output":"redacted output","durationMs":10,"truncated":false}'::jsonb);
 if op->>'verdict'<>'passed' or public.read_dynamic_environment_data(p,profile)->>'state'<>'ready' then raise exception 'Setup outcome did not prepare';end if;
 -- Cancellation requires cleanup and a late worker cannot turn it into a pass.
 op:=public.start_dynamic_hook(p,profile,'setup','hook-two','{"program":"pnpm","script":"setup"}'::jsonb);hook_id:=(op->'operation'->>'id')::uuid;perform public.claim_dynamic_hook(p,hook_id,'worker-one',token);perform public.cancel_dynamic_hook(p,hook_id);
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'preparing' then raise exception 'Cancellation released before termination acknowledgement';end if;
 if public.heartbeat_dynamic_hook(p,hook_id,'worker-one',token) then raise exception 'Cancelled worker renewed';end if;
 begin perform public.start_dynamic_hook(p,profile,'cleanup','too-early','{}'::jsonb);raise exception 'Cleanup overlapped stopping command';exception when raise_exception then if sqlerrm='Cleanup overlapped stopping command' then raise;end if;end;
 op:=public.finish_dynamic_hook(p,hook_id,token,'completed','{"outcome":"passed","exitCode":0}'::jsonb);
 if op->>'state'<>'cancelled' or op->>'verdict'<>'not_tested' then raise exception 'Cancelled hook turned into pass';end if;
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'cleanup_required' then raise exception 'Cancelled operation unlocked';end if;
 op:=public.start_dynamic_hook(p,profile,'cleanup','hook-cleanup-fail','{"program":"pnpm","script":"cleanup"}'::jsonb);hook_id:=(op->'operation'->>'id')::uuid;perform public.claim_dynamic_hook(p,hook_id,'worker-one',token);perform public.finish_dynamic_hook(p,hook_id,token,'completed','{"outcome":"failed","exitCode":3}'::jsonb);
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'cleanup_required' then raise exception 'Failed cleanup unlocked';end if;
 op:=public.start_dynamic_hook(p,profile,'cleanup','hook-cleanup-expired','{"program":"pnpm","script":"cleanup"}'::jsonb);hook_id:=(op->'operation'->>'id')::uuid;perform public.claim_dynamic_hook(p,hook_id,'worker-one',token);update hook_test set operation_id=hook_id;
end $$;
reset role;update public.dynamic_hook_operations set expires_at=clock_timestamp()-interval '1 second' where id=(select operation_id from hook_test);
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';profile uuid:=(select profile_id from hook_test);hook_id uuid:=(select operation_id from hook_test);op jsonb;token uuid:='11111111-3333-4333-8333-111111111111';
begin
 if public.finish_dynamic_hook(p,hook_id,token,'completed','{"outcome":"passed","exitCode":0}'::jsonb) is not null then raise exception 'Expired hook finalized';end if;
 if jsonb_array_length(public.recover_dynamic_hooks(p))<>1 then raise exception 'No expired recovery';end if;
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'cleanup_required' then raise exception 'Recovery unlocked dirty data';end if;
 if jsonb_array_length(public.recover_dynamic_hooks(p))<>0 then raise exception 'Repeated recovery mutated';end if;
 op:=public.start_dynamic_hook(p,profile,'cleanup','hook-cleanup-success','{"program":"pnpm","script":"cleanup"}'::jsonb);hook_id:=(op->'operation'->>'id')::uuid;perform public.claim_dynamic_hook(p,hook_id,'worker-one',token);perform public.finish_dynamic_hook(p,hook_id,token,'completed','{"outcome":"passed","exitCode":0}'::jsonb);
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'unprepared' then raise exception 'Successful cleanup did not reset';end if;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);if exists(select 1 from public.dynamic_hook_operations where project_id=p) then raise exception 'Nonmember read hook';end if;
 begin perform public.cancel_dynamic_hook(p,hook_id);raise exception 'Nonmember cancelled hook';exception when insufficient_privilege then null;end;
 raise notice 'PASS: hook locks, browser coordination, claim/heartbeat, replay, cancel/failure/recovery, fencing, cleanup and RLS';
end $$;
rollback;
