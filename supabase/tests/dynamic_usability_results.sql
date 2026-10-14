begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;rid uuid;token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';a jsonb;patch jsonb;result jsonb;bad jsonb;copy jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Usability results","goal":"Read Ready","targetUrl":"http://localhost:3000/","maxSteps":3,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","required":true,"kind":"visible_text","expected":"Ready"}],"usability":{"schemaVersion":1,"persona":"first_time","rules":["labels"],"feedbackCheckIds":[],"errorRecoveryCheckIds":[]}}');
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'usability-results');rid:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,rid,'worker',token,'aaaaaaaa-cccc-4ccc-8ddd-eeeeeeeeeeee');
 a:=jsonb_build_object('schemaVersion',1,'config',rev->'usability','keyboardActions',0,'assessedAt',clock_timestamp(),'limitations',jsonb_build_array('Synthetic rule fixture, not real-user research'),'observations','[{"ruleId":"labels","persona":"first_time","kind":"deterministic","verdict":"failed","expected":"Label","observed":"Missing configured label","controlRef":"u0","evidenceIds":["assessment","proof"]}]'::jsonb);
 patch:=jsonb_build_object('state','completed','verdict','passed','leaseToken',token,'checks','[{"checkId":"one","criterionId":"one","verdict":"passed","observed":"Ready","reason":"Visible","evidenceIds":["proof"]}]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('id','proof','kind','screenshot','sha256',repeat('a',64),'availability','local','capturedAt',clock_timestamp()),jsonb_build_object('id','assessment','kind','usability','sha256',repeat('b',64),'availability','local','capturedAt',clock_timestamp())),'usability',a);
 if public.transition_dynamic_run(p,rid,'running',patch||jsonb_build_object('leaseToken','11111111-2222-4333-8444-555555555555')) is not null then raise exception 'Wrong lease finalized assessment';end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array('null'::jsonb,a||'{"actorId":"spoofed"}',jsonb_set(a,'{config,persona}','"returning"'),jsonb_set(a,'{keyboardActions}','43'),jsonb_set(a,'{observations}','[]'),jsonb_set(a,'{observations,0,evidenceIds}','["invented"]'),jsonb_set(a,'{observations,0,controlRef}','"u40"'),jsonb_set(a,'{observations,0,kind}','"subjective"'))) loop
  begin perform public.transition_dynamic_run(p,rid,'running',patch||jsonb_build_object('usability',bad));raise exception 'Invalid assessment finalized';exception when raise_exception then if sqlerrm='Invalid assessment finalized' then raise;end if;end;
 end loop;
 if (select state from public.dynamic_runs where id=rid)<>'running' then raise exception 'Rejected result changed lifecycle';end if;
 result:=public.transition_dynamic_run(p,rid,'running',patch);
 if result->>'verdict'<>'passed' or result->'usability' is distinct from a then raise exception 'Functional verdict overwritten or assessment lost';end if;
 copy:=public.prepare_dynamic_evidence_copy(p,rid,'assessment',500);
 if copy->'copy'->>'kind'<>'usability' or copy->'copy'->>'mimeType'<>'application/json' then raise exception 'Usability proof sharing not supported';end if;
 if public.transition_dynamic_run(p,rid,'running',patch) is not null then raise exception 'Completed assessment rewritten';end if;
 if has_function_privilege('authenticated','public.transition_dynamic_run_without_usability(uuid,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public._prepare_dynamic_independent_copy_v1(uuid,uuid,text,integer)','execute') then raise exception 'Private finalizer/transport exposed';end if;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 if (select payload->'usability' from public.dynamic_runs where id=rid) is distinct from a then raise exception 'Member could not read retained assessment';end if;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 if exists(select 1 from public.dynamic_runs where id=rid) then raise exception 'Nonmember read assessment';end if;
 begin perform public.transition_dynamic_run(p,rid,'running',patch);raise exception 'Nonmember finalized';exception when insufficient_privilege then null;end;
 raise notice 'PASS: matching frozen rule config, retained proof, strict bounds, live lease, immutable terminal record and member boundaries';
end $$;
rollback;
