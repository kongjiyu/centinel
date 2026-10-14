begin;
create or replace function public._test_usability_finding_run(rev jsonb,key text,verdict text,ref text,anchor text,baseline uuid default null)
returns jsonb language plpgsql as $$
declare start jsonb;rid uuid;token uuid:=gen_random_uuid();row jsonb;a jsonb;cfg jsonb:=rev->'usability';
begin
 if baseline is null then start:=public.start_dynamic_run((rev->>'projectId')::uuid,auth.uid(),(rev->>'id')::uuid,key);else start:=public.start_dynamic_regression_run((rev->>'projectId')::uuid,auth.uid(),(rev->>'id')::uuid,key,baseline);end if;
 rid:=(start->'run'->>'id')::uuid;perform public.claim_dynamic_run((rev->>'projectId')::uuid,rid,'worker',token,'aaaaaaaa-cccc-4ccc-8ddd-eeeeeeeeeeee');
 row:=jsonb_build_object('ruleId','labels','persona',cfg->>'persona','kind','deterministic','verdict',verdict,'expected','Configured label source','observed','Synthetic SQL rule observation','controlRef',ref,'evidenceIds',jsonb_build_array('assessment','proof'));
 if anchor is not null then row:=row||jsonb_build_object('controlKey',anchor);end if;
 a:=jsonb_build_object('schemaVersion',1,'config',cfg,'keyboardActions',0,'assessedAt',clock_timestamp(),'limitations',jsonb_build_array('Synthetic SQL fixture, not browser acceptance'),'observations',jsonb_build_array(row));
 return public.transition_dynamic_run((rev->>'projectId')::uuid,rid,'running',jsonb_build_object('state','completed','verdict','passed','leaseToken',token,'checks',jsonb_build_array(jsonb_build_object('checkId','ready','criterionId','one','verdict','passed','reason','Fixture','observed','Ready','evidenceIds',jsonb_build_array('proof'))),'evidence',jsonb_build_array(jsonb_build_object('id','proof','kind','screenshot','sha256',repeat('a',64),'availability','local','capturedAt',clock_timestamp()),jsonb_build_object('id','assessment','kind','usability','sha256',repeat('b',64),'availability','local','capturedAt',clock_timestamp())),'usability',a));
end $$;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';body jsonb:='{"name":"Usability lineage","goal":"Ready","targetUrl":"http://localhost:3000/lineage","maxSteps":3,"context":null,"checks":[{"id":"ready","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}],"usability":{"schemaVersion":1,"persona":"first_time","rules":["labels"],"feedbackCheckIds":[],"errorRecoveryCheckIds":[]}}';rev jsonb;run jsonb;first uuid;fid uuid;found jsonb;changed jsonb;again jsonb;passed jsonb;wrong jsonb;anon jsonb;anon_fid uuid;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),body);run:=public._test_usability_finding_run(rev,'us-lineage-first','failed','u0',repeat('a',64));first:=(run->>'id')::uuid;
 found:=public.collect_dynamic_findings(p,first);if jsonb_array_length(found)<>1 or found->0->>'source'<>'dynamic_usability' or found->0->>'verification'<>'unreviewed' or found->0->'severity'<>'null'::jsonb then raise exception 'Usability candidate or neutral triage missing';end if;fid:=(found->0->>'id')::uuid;
 if public.collect_dynamic_findings(p,first) is distinct from found then raise exception 'Replay changed candidate';end if;
 changed:=public._test_usability_finding_run(rev,'us-lineage-reordered','failed','u1',repeat('a',64));again:=public.collect_dynamic_findings(p,(changed->>'id')::uuid);if again->0->>'id'<>fid::text or again->0->>'observationCount'<>'2' then raise exception 'Stable identity did not survive DOM reference reordering';end if;
 found:=public.review_dynamic_finding(p,fid,'{"version":2,"decision":"confirmed","note":"Synthetic fixture confirmation","severity":"low","priority":"low","confidence":"high"}');
 begin perform public.review_dynamic_finding(p,fid,'{"version":2,"decision":"rejected","note":"Stale request"}');raise exception 'Stale decision accepted';exception when raise_exception then if sqlerrm='Stale decision accepted' then raise;end if;end;
 wrong:=public._test_usability_finding_run(rev,'us-lineage-wrong','passed','u0',repeat('b',64),first);
 begin perform public.record_dynamic_remediation(p,fid,jsonb_build_object('version',3,'status','resolved','note','Position alone is insufficient','regressionRunId',wrong->>'id'));raise exception 'Different control at same position resolved issue';exception when raise_exception then if sqlerrm='Different control at same position resolved issue' then raise;end if;end;
 passed:=public._test_usability_finding_run(rev,'us-lineage-pass','passed','u1',repeat('a',64),first);
 if public.collect_dynamic_findings(p,(passed->>'id')::uuid)<>'[]'::jsonb then raise exception 'Passed rule generated candidate';end if;
 if (select payload->>'remediation' from public.dynamic_findings where id=fid)<>'open' then raise exception 'Rule pass automatically resolved issue';end if;
 found:=public.record_dynamic_remediation(p,fid,jsonb_build_object('version',3,'status','resolved','note','Inspected matching passed rule proof','regressionRunId',passed->>'id'));
 changed:=public._test_usability_finding_run(rev,'us-lineage-recur','failed','u0',repeat('a',64),first);again:=public.collect_dynamic_findings(p,(changed->>'id')::uuid);
 if again->0->>'id'<>fid::text or again->0->>'remediation'<>'open' or again->0->>'verification'<>'needs_investigation' or again->0->>'observationCount'<>'3' then raise exception 'Rule recurrence not reopened';end if;
 if (select payload from public.dynamic_runs where id=first) is distinct from run then raise exception 'Baseline was rewritten';end if;
 anon:=public._test_usability_finding_run(rev,'us-lineage-anon','failed','u0',null);found:=public.collect_dynamic_findings(p,(anon->>'id')::uuid);anon_fid:=(found->0->>'id')::uuid;perform public.review_dynamic_finding(p,anon_fid,'{"version":1,"decision":"confirmed","note":"Unanchored fixture investigation","severity":"low","priority":"low","confidence":"low"}');
 passed:=public._test_usability_finding_run(rev,'us-lineage-anon-pass','passed','u0',null,(anon->>'id')::uuid);
 begin perform public.record_dynamic_remediation(p,anon_fid,jsonb_build_object('version',2,'status','resolved','note','No positional verification','regressionRunId',passed->>'id'));raise exception 'Unanchored rule falsely resolved';exception when raise_exception then if sqlerrm='Unanchored rule falsely resolved' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);if jsonb_array_length(public.read_dynamic_finding(p,fid)->'observations')<>3 then raise exception 'Member cannot read usability history';end if;
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 begin perform public.collect_dynamic_findings(p,first);raise exception 'Nonmember collected';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.dynamic_findings where id=fid) then raise exception 'Nonmember read';end if;
 if has_function_privilege('authenticated','public.collect_dynamic_functional_findings(uuid,uuid)','execute') then raise exception 'Functional collector bypass exposed';end if;
 raise notice 'PASS: rule candidates, neutral triage, stable reorder correlation, stale review, matching pinned resolution, recurrence, no positional resolution and member boundaries';
end $$;
rollback;

begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';key text:='usability:'||encode(sha256(convert_to(jsonb_build_array('labels','first_time','stable_control',repeat('a',64))::text,'UTF8')),'hex');rev jsonb;started jsonb;rid uuid;token uuid:=gen_random_uuid();a jsonb;result jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),jsonb_build_object('name','Source namespace collision','goal','Ready','targetUrl','http://localhost:3000/lineage','maxSteps',3,'context',null,'checks',jsonb_build_array(jsonb_build_object('id',key,'criterionId','one','description','Functional fixture','kind','visible_text','expected','Ready','required',true)),'usability','{"schemaVersion":1,"persona":"first_time","rules":["labels"],"feedbackCheckIds":[],"errorRecoveryCheckIds":[]}'::jsonb));
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'us-namespace');rid:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,rid,'worker',token,'namespace-session');
 a:=jsonb_build_object('schemaVersion',1,'config',rev->'usability','keyboardActions',0,'assessedAt',clock_timestamp(),'limitations',jsonb_build_array('Synthetic namespace fixture'),'observations',jsonb_build_array(jsonb_build_object('ruleId','labels','persona','first_time','kind','deterministic','verdict','failed','expected','Label','observed','Missing','controlRef','u0','controlKey',repeat('a',64),'evidenceIds',jsonb_build_array('assessment','proof'))));
 perform public.transition_dynamic_run(p,rid,'running',jsonb_build_object('state','completed','verdict','failed','leaseToken',token,'checks',jsonb_build_array(jsonb_build_object('checkId',key,'criterionId','one','verdict','failed','observed','Absent','reason','Fixture','evidenceIds',jsonb_build_array('proof'))),'evidence',jsonb_build_array(jsonb_build_object('id','proof','kind','screenshot','sha256',repeat('a',64),'availability','local','capturedAt',clock_timestamp()),jsonb_build_object('id','assessment','kind','usability','sha256',repeat('b',64),'availability','local','capturedAt',clock_timestamp())),'usability',a));
 result:=public.collect_dynamic_findings(p,rid);
 if jsonb_array_length(result)<>2 or (select count(*) from public.dynamic_finding_observations where run_id=rid and check_id=key)<>2 or (select count(distinct source) from public.dynamic_finding_observations where run_id=rid)<>2 then raise exception 'Caller check ID collided with usability observation namespace';end if;
 raise notice 'PASS: functional and usability sources remain distinct even with identical check identifiers';
end $$;
rollback;
