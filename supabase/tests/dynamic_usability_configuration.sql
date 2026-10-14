begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';base jsonb:='{"name":"Usability fixture","goal":"Observe Ready","targetUrl":"http://localhost:3000/","maxSteps":3,"context":null,"checks":[{"id":"ready","criterionId":"manual","description":"Ready","required":true,"kind":"visible_text","expected":"Ready"}]}';cfg jsonb:='{"schemaVersion":1,"persona":"first_time","rules":["labels","feedback"],"feedbackCheckIds":["ready"],"errorRecoveryCheckIds":[]}';rev jsonb;old jsonb;newrev jsonb;started jsonb;replay jsonb;bad jsonb;run_id uuid;
begin
 old:=public.save_dynamic_revision(p,auth.uid(),base);
 if old ? 'usability' then raise exception 'Historical-compatible revision gained configuration';end if;
 rev:=public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('usability',cfg));
 if rev->'usability' is distinct from cfg then raise exception 'Configuration not retained';end if;
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'usability-config');run_id:=(started->'run'->>'id')::uuid;
 if started->'run'->'revision'->'usability' is distinct from cfg or started->'run'->'executionVersions'->'usability' is distinct from '1'::jsonb then raise exception 'Run configuration/version not frozen';end if;
 newrev:=public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('usability',jsonb_set(cfg,'{persona}','"returning"')),(rev->>'missionId')::uuid);
 replay:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'usability-config');
 if replay->>'reused'<>'true' or replay->'run' is distinct from started->'run' then raise exception 'Replay rewrote original Run';end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array('null'::jsonb,cfg||'{"actorId":"spoofed"}',jsonb_set(cfg,'{persona}','"invented"'),jsonb_set(cfg,'{rules}','[]'),jsonb_set(cfg,'{rules}','["labels","labels"]'),jsonb_set(cfg,'{feedbackCheckIds}','[]'),jsonb_set(cfg,'{feedbackCheckIds}','["unknown"]'),jsonb_set(cfg,'{rules}','["error_recovery"]'))) loop
  begin perform public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('usability',bad));raise exception 'Invalid configuration accepted';exception when raise_exception then if sqlerrm='Invalid configuration accepted' then raise;end if;end;
 end loop;
 begin perform public.save_dynamic_revision(p,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',base||jsonb_build_object('usability',cfg));raise exception 'Spoofed actor accepted';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','public.validate_dynamic_usability(jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.save_dynamic_revision_without_usability(uuid,uuid,jsonb,uuid)','execute') or has_function_privilege('authenticated','public.start_dynamic_run_without_usability_version(uuid,uuid,uuid,text)','execute') then raise exception 'Private validation/wrapper bypass exposed';end if;
 perform public.transition_dynamic_run(p,run_id,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 begin perform public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('usability',cfg));raise exception 'Nonmember accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: frozen optional usability, immutable replay, invalid configs, actor/member guards and private helper boundaries';
end $$;
rollback;
