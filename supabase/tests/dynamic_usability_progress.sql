begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;ret jsonb;rid uuid;run_token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';artifact jsonb;input jsonb;aid uuid;transfer jsonb;original jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Stopped artifact","goal":"Read","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"usability":{"schemaVersion":1,"persona":"first_time","rules":["labels"],"feedbackCheckIds":[],"errorRecoveryCheckIds":[]},"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');ret:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'shared-partial');rid:=(ret->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,rid,'worker',run_token,'partial');original:=public.transition_dynamic_run(p,rid,'running',jsonb_build_object('state','cancelled','verdict','not_tested','leaseToken',run_token));
 input:=jsonb_build_object('slot','usability','kind','partial_usability','sha256',repeat('a',64),'sourceSha256',repeat('b',64),'bytes',100,'mimeType','application/json','sourceManifestId',null,'permissionUrl',null,'privacyVersion',1,'criterionProof',false);
 artifact:=public.register_dynamic_run_artifact(p,rid,input);aid:=(artifact->>'id')::uuid;
 if artifact->'criterionProof'<>'false'::jsonb or artifact->>'registeredBy'<>auth.uid()::text then raise exception 'Diagnostic identity or non-proof role missing';end if;
 if public.register_dynamic_run_artifact(p,rid,input) is distinct from artifact then raise exception 'Registration replay changed history';end if;
 begin perform public.register_dynamic_run_artifact(p,rid,input||jsonb_build_object('sha256',repeat('c',64)));raise exception 'Changed derivative accepted';exception when raise_exception then if sqlerrm='Changed derivative accepted' then raise;end if;end;
 begin perform public.register_dynamic_run_artifact(p,rid,input||'{"criterionProof":true}');raise exception 'Diagnostic promoted to criterion proof';exception when raise_exception then if sqlerrm='Diagnostic promoted to criterion proof' then raise;end if;end;
 transfer:=public.prepare_dynamic_evidence_copy(p,rid,aid::text,100);if transfer->'copy'->>'kind'<>'partial_usability' or transfer->'copy'->'criterionProof'<>'false'::jsonb or transfer->'copy'->>'sourceSha256'<>repeat('b',64) then raise exception 'Derivative provenance lost in shared copy';end if;
 perform public.finish_dynamic_evidence_copy(p,(transfer->'copy'->>'id')::uuid,(transfer->>'token')::uuid,'available');
 if (select payload from public.dynamic_runs where id=rid) is distinct from original then raise exception 'Artifact rewrote cancelled outcome';end if;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 if not exists(select 1 from public.dynamic_run_artifacts where id=aid) then raise exception 'Member cannot inspect registered artifact';end if;
 begin perform public.register_dynamic_run_artifact(p,rid,input);raise exception 'Other account published producer artifact';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);

 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 if exists(select 1 from public.dynamic_run_artifacts where id=aid) then raise exception 'Nonmember usability metadata';end if;
 begin perform public.prepare_dynamic_evidence_copy(p,rid,aid::text,100);raise exception 'Nonmember usability transfer';exception when insufficient_privilege then null;end;
 raise notice 'PASS: fixed non-criterion usability diagnostic, immutable copy, producer/member guards and cancelled outcome preservation';
end $$;
rollback;
