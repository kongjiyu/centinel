begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;run_id uuid;token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';snapshot jsonb:='{"schemaVersion":1,"mode":"exploratory","objectives":[{"criterionId":"objective","checkIds":["one"],"verdict":"not_tested"}],"states":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"http://localhost:3000/","title":"Fixture","visits":1,"omittedControls":false,"controls":[{"ref":"e0","role":"button","name":"Open","selector":"#open"}]}],"actions":[],"unvisitedControls":[{"stateId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ref":"e0"}],"unresolvedControls":[],"unresolvedTargetActions":0,"limits":{"maxStates":51,"maxActions":25},"truncated":false,"exhaustive":false,"limitations":["Sampled main document only"]}';readback jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"mode":"exploratory","name":"Explore","goal":"Explore selected objective","targetUrl":"http://localhost:3000/","maxSteps":3,"context":null,"checks":[{"id":"one","criterionId":"objective","description":"Ready","required":true,"kind":"visible_text","expected":"Ready"}]}');if rev->>'mode'<>'exploratory' then raise exception 'Mode not retained';end if;
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'explore-checkpoint');run_id:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,run_id,'explore-worker',token,'session');
 if public.checkpoint_dynamic_exploration(p,run_id,null,token,snapshot) or public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',null,snapshot) then raise exception 'Null worker credentials accepted';end if;
 if public.checkpoint_dynamic_exploration(p,run_id,'wrong-worker',token,snapshot) then raise exception 'Wrong worker accepted';end if;
 if public.checkpoint_dynamic_exploration(p,run_id,'explore-worker','11111111-2222-4333-8444-555555555555',snapshot) then raise exception 'Wrong token accepted';end if;
 if not public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,snapshot) then raise exception 'Valid checkpoint rejected';end if;
 select payload into readback from public.dynamic_runs where id=run_id;if readback->'exploration' is distinct from snapshot or readback->>'state'<>'running' or readback->>'verdict'<>'not_tested' then raise exception 'Checkpoint changed outcome or omitted scope';end if;
 begin perform public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,jsonb_set(snapshot,'{objectives,0,verdict}','"passed"'));raise exception 'Visit forged a pass';exception when raise_exception then if sqlerrm='Visit forged a pass' then raise;end if;end;
 begin perform public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,jsonb_set(snapshot,'{exhaustive}','true'));raise exception 'Exhaustive claim accepted';exception when raise_exception then if sqlerrm='Exhaustive claim accepted' then raise;end if;end;
 perform public.transition_dynamic_run(p,run_id,'running',jsonb_build_object('state','cancelled','verdict','not_tested','checks','[]'::jsonb,'evidence','[]'::jsonb));if public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,snapshot) then raise exception 'Cancelled Run changed';end if;
 raise notice 'PASS: explicit mode, fenced exploratory checkpoints, no invented pass/exhaustive claims and cancellation preservation';
end $$;
rollback;

begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;run_id uuid;token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';scope jsonb:='{"schemaVersion":1,"mode":"exploratory","objectives":[{"criterionId":"objective","checkIds":["one"],"verdict":"not_tested"}],"states":[],"actions":[],"unvisitedControls":[],"unresolvedControls":[],"unresolvedTargetActions":0,"limits":{"maxStates":51,"maxActions":25},"truncated":false,"exhaustive":false,"limitations":["Sampled scope only"]}';final jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"mode":"exploratory","name":"Verify explore","goal":"Read ready","targetUrl":"http://localhost:3000/","maxSteps":3,"context":null,"checks":[{"id":"one","criterionId":"objective","description":"Ready","required":true,"kind":"visible_text","expected":"Ready"}]}');started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'explore-final');run_id:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,run_id,'explore-worker',token,'session');perform public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,scope);
 final:=public.transition_dynamic_run(p,run_id,'running',jsonb_build_object('state','completed','verdict','failed','leaseToken',token,'checks','[{"checkId":"one","criterionId":"objective","verdict":"failed","observed":"Absent","reason":"Independent","evidenceIds":["proof"],"checkedAt":"2026-10-14T00:00:00Z"}]'::jsonb,'evidence','[{"id":"proof","kind":"screenshot","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","availability":"local","capturedAt":"2026-10-14T00:00:00Z"}]'::jsonb,'exploration',jsonb_set(scope,'{objectives,0,verdict}','"passed"')));
 if final->'exploration'->'objectives'->0->>'verdict'<>'failed' then raise exception 'Planner/caller replaced independent result';end if;
 if public.checkpoint_dynamic_exploration(p,run_id,'explore-worker',token,scope) then raise exception 'Completed objective rewritten';end if;
 if has_function_privilege('authenticated','public.transition_dynamic_run_without_exploration_outcomes(uuid,uuid,text,jsonb)','execute') then raise exception 'Private finalizer exposed';end if;
 raise notice 'PASS: final objective derives from retained failed check, ignores caller pass and stays immutable';
end $$;
rollback;
