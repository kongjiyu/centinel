begin;
create function pg_temp.add_capture_grant(p_run uuid) returns void language sql security definer set search_path=public as $$update public.dynamic_runs set payload=payload||jsonb_build_object('actionPolicy',jsonb_build_object('schemaVersion',1,'interactions','[]'::jsonb,'allowCoordinates',false,'downloads','[{"selector":"#download","url":"http://localhost:3000/file","maxBytes":1024,"mimeType":"text/plain","publicTestData":true}]'::jsonb)) where id=p_run$$;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;ret jsonb;rid uuid;run_token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';artifact jsonb;input jsonb;aid uuid;transfer jsonb;original jsonb;capture jsonb;ev jsonb;checks jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Stopped artifact","goal":"Read","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');ret:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'shared-partial');rid:=(ret->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,rid,'worker',run_token,'partial');original:=public.transition_dynamic_run(p,rid,'running',jsonb_build_object('state','cancelled','verdict','not_tested','leaseToken',run_token));
 input:=jsonb_build_object('slot','trace','kind','partial_trace','sha256',repeat('a',64),'sourceSha256',repeat('b',64),'bytes',100,'mimeType','application/json','sourceManifestId',null,'permissionUrl',null,'privacyVersion',1,'criterionProof',false);
 artifact:=public.register_dynamic_run_artifact(p,rid,input);aid:=(artifact->>'id')::uuid;
 if artifact->'criterionProof'<>'false'::jsonb or artifact->>'registeredBy'<>auth.uid()::text then raise exception 'Diagnostic identity or non-proof role missing';end if;
 if public.register_dynamic_run_artifact(p,rid,input) is distinct from artifact then raise exception 'Registration replay changed history';end if;
 begin perform public.register_dynamic_run_artifact(p,rid,input||jsonb_build_object('sha256',repeat('c',64)));raise exception 'Changed derivative accepted';exception when raise_exception then if sqlerrm='Changed derivative accepted' then raise;end if;end;
 begin perform public.register_dynamic_run_artifact(p,rid,input||'{"criterionProof":true}');raise exception 'Diagnostic promoted to criterion proof';exception when raise_exception then if sqlerrm='Diagnostic promoted to criterion proof' then raise;end if;end;
 transfer:=public.prepare_dynamic_evidence_copy(p,rid,aid::text,100);if transfer->'copy'->>'kind'<>'partial_trace' or transfer->'copy'->'criterionProof'<>'false'::jsonb or transfer->'copy'->>'sourceSha256'<>repeat('b',64) then raise exception 'Derivative provenance lost in shared copy';end if;
 perform public.finish_dynamic_evidence_copy(p,(transfer->'copy'->>'id')::uuid,(transfer->>'token')::uuid,'available');
 if (select payload from public.dynamic_runs where id=rid) is distinct from original then raise exception 'Artifact rewrote cancelled outcome';end if;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 if not exists(select 1 from public.dynamic_run_artifacts where id=aid) then raise exception 'Member cannot inspect registered artifact';end if;
 begin perform public.register_dynamic_run_artifact(p,rid,input);raise exception 'Other account published producer artifact';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Captured artifact","goal":"Download","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"file","criterionId":"file","description":"File hash","kind":"download_sha256","url":"http://localhost:3000/file","expected":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","required":true}]}');
 ret:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'shared-capture');rid:=(ret->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,rid,'worker',run_token,'captured');
 ev:=jsonb_build_array(jsonb_build_object('id','manifest','kind','file_manifest','sha256',repeat('b',64),'capturedAt',now(),'availability','local'));checks:=jsonb_build_array(jsonb_build_object('checkId','file','criterionId','file','verdict','passed','observed','Captured SHA-256: '||repeat('a',64),'evidenceIds',jsonb_build_array('manifest')));
 original:=public.transition_dynamic_run(p,rid,'running',jsonb_build_object('state','completed','verdict','passed','leaseToken',run_token,'checks',checks,'evidence',ev));
 -- Fixture-only authoritative frozen grant: set while still admin outside runtime
 -- via a temporary guarded helper below; no application table writes are granted.
 capture:=jsonb_build_object('slot','download-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','kind','download','sha256',repeat('a',64),'sourceSha256',repeat('a',64),'bytes',0,'mimeType','text/plain','sourceManifestId','manifest','permissionUrl','http://localhost:3000/file','privacyVersion',1,'criterionProof',false);
 begin perform public.register_dynamic_run_artifact(p,rid,capture);raise exception 'Capture without public grant accepted';exception when raise_exception then if sqlerrm='Capture without public grant accepted' then raise;end if;end;
 perform pg_temp.add_capture_grant(rid);
 artifact:=public.register_dynamic_run_artifact(p,rid,capture);aid:=(artifact->>'id')::uuid;transfer:=public.prepare_dynamic_evidence_copy(p,rid,aid::text,0);
 if transfer->'copy'->>'bytes'<>'0' or transfer->>'objectPath' not like '%.bin' then raise exception 'Empty captured output or opaque path lost';end if;
 begin perform public.register_dynamic_run_artifact(p,rid,capture||jsonb_build_object('slot','download-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','mimeType','text/html'));raise exception 'Unapproved capture MIME accepted';exception when raise_exception then if sqlerrm='Unapproved capture MIME accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 if exists(select 1 from public.dynamic_run_artifacts where id=aid) then raise exception 'Non-member artifact metadata';end if;
 begin perform public.prepare_dynamic_evidence_copy(p,rid,aid::text,0);raise exception 'Non-member artifact transfer';exception when insufficient_privilege then null;end;
 raise notice 'PASS: immutable diagnostic derivative, non-criterion role, producer/member isolation, preserved outcome, frozen capture approval and zero bytes';
end $$;
rollback;
