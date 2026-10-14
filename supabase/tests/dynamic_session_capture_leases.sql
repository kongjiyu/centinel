begin;
create temporary table session_capture_test(profile_id uuid,capture_id uuid);grant all on session_capture_test to authenticated;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;profile uuid;claim_id uuid:='11111111-3333-4333-8333-111111111111';token uuid:='11111111-4444-4444-8444-111111111111';rev jsonb;result jsonb;
begin
 env:=public.save_dynamic_environment(p,'{"name":"Capture fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"QA","requiredVariables":[],"startupInstructions":"Sign in manually","targetVersion":"fixture","sessionReference":"qa-session","sessionReadySelector":"[data-authenticated]"}');profile:=(env->>'id')::uuid;
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"No concurrent browser","goal":"Observe form","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Form","kind":"visible_text","expected":"Ready","required":true}]}'::jsonb);
 perform public.acquire_dynamic_session_capture(p,profile,claim_id,token,'worker-one');
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'preparing' then raise exception 'Capture did not reserve data';end if;
 if not public.heartbeat_dynamic_session_capture(p,claim_id,token) then raise exception 'No capture heartbeat';end if;
 begin perform public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'during-capture');raise exception 'Browser overlapped sign-in';exception when raise_exception then if sqlerrm='Browser overlapped sign-in' then raise;end if;end;
 begin perform public.start_dynamic_hook(p,profile,'setup','during-capture','{}');raise exception 'Hook overlapped sign-in';exception when raise_exception then if sqlerrm='Hook overlapped sign-in' then raise;end if;end;
 begin perform public.record_dynamic_environment_data(p,profile,'preparation','completed','Should be blocked');raise exception 'Manual preparation overlapped sign-in';exception when raise_exception then if sqlerrm='Manual preparation overlapped sign-in' then raise;end if;end;
 begin perform sc.token from public.dynamic_session_captures sc where sc.id=claim_id;raise exception 'Capture token readable';exception when insufficient_privilege then null;end;
 if has_function_privilege(current_user,'public.start_dynamic_run_without_session_guard(uuid,uuid,uuid,text)','execute') then raise exception 'Session guard bypass exposed';end if;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);if public.finish_dynamic_session_capture(p,claim_id,token,true) is not null then raise exception 'Other member finalized capture';end if;perform public.request_cancel_dynamic_session_capture(p,claim_id);
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 if public.heartbeat_dynamic_session_capture(p,claim_id,token) then raise exception 'Cancelled capture renewed';end if;
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'preparing' then raise exception 'Cancel released before browser stop';end if;
 result:=public.finish_dynamic_session_capture(p,claim_id,token,true);if result->>'state'<>'cancelled' or public.read_dynamic_environment_data(p,profile)->>'state'<>'cleanup_required' then raise exception 'Cancelled capture unlocked clean data';end if;
 perform public.record_dynamic_environment_data(p,profile,'cleanup','completed','Browser stopped and fixture cleanup verified');
 claim_id:='11111111-5555-4555-8555-111111111111';perform public.acquire_dynamic_session_capture(p,profile,claim_id,token,'worker-one');result:=public.finish_dynamic_session_capture(p,claim_id,token,true);
 if result->>'state'<>'completed' or public.read_dynamic_environment_data(p,profile)->>'state'<>'unprepared' then raise exception 'Session capture pretended data readiness';end if;
 claim_id:='11111111-6666-4666-8666-111111111111';perform public.acquire_dynamic_session_capture(p,profile,claim_id,token,'worker-one');insert into session_capture_test values(profile,claim_id);
end $$;
reset role;update public.dynamic_session_captures set expires_at=clock_timestamp()-interval '1 second' where id=(select capture_id from session_capture_test);
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$declare p uuid:='11111111-1111-4111-8111-111111111111';claim_id uuid:=(select capture_id from session_capture_test);profile uuid:=(select profile_id from session_capture_test);begin
 if public.finish_dynamic_session_capture(p,claim_id,'11111111-4444-4444-8444-111111111111',true) is not null then raise exception 'Expired capture finalized';end if;
 if public.read_dynamic_environment_data(p,profile)->>'state'<>'cleanup_required' then raise exception 'Expired capture did not retain dirty lock';end if;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);if exists(select 1 from public.dynamic_session_captures where project_id=p) then raise exception 'Nonmember read capture';end if;
 raise notice 'PASS: capture exclusion, private token, member fencing, cancellation acknowledgement, expiry and baseline readiness';end $$;
rollback;
