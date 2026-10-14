begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;old_run jsonb;replay jsonb;bad jsonb;base jsonb:='{"name":"Form checks","goal":"Check synthetic form","targetUrl":"http://localhost:3000","maxSteps":3,"context":null,"contextAcknowledged":false}';checks jsonb:='[{"id":"value","criterionId":"form","description":"Empty field","required":true,"kind":"field_value","selector":"#name","expected":"","extra":"drop"},{"id":"checked","criterionId":"form","description":"Checked","required":true,"kind":"field_checked","selector":"#agree","expected":false},{"id":"enabled","criterionId":"form","description":"Enabled","required":true,"kind":"field_enabled","selector":"#save","expected":true},{"id":"valid","criterionId":"form","description":"Valid","required":true,"kind":"field_valid","selector":"#name","expected":false},{"id":"selected","criterionId":"form","description":"Options","required":true,"kind":"selected_values","selector":"#options","expected":["", "a"]}]';
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('checks',checks));
 if rev->'checks'->0 ? 'extra' or rev->'checks'->0->>'expected'<>'' or rev->'checks'->1->'expected'<>'false'::jsonb then raise exception 'Check fields not sanitized or typed';end if;
 foreach bad in array array['{"kind":"field_checked","expected":"false"}'::jsonb,'{"kind":"field_value","expected":false}','{"kind":"selected_values","expected":["a","a"]}','{"kind":"field_valid","selector":"","expected":true}','{"kind":"unknown","expected":true}','{"kind":"field_enabled","expected":null}'] loop
  begin perform public.save_dynamic_revision(p,auth.uid(),base||jsonb_build_object('checks',jsonb_build_array((checks->0)||bad)));raise exception 'Invalid form check accepted';exception when raise_exception then if sqlerrm='Invalid form check accepted' then raise;end if;end;
 end loop;
 started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'form-version');old_run:=started->'run';
 if old_run->'executionVersions'->>'observer'<>'2' or old_run->'executionVersions'->>'checker'<>'2' or old_run->'executionVersions'->>'policy'<>'2' then raise exception 'New engine versions absent';end if;
 perform public.transition_dynamic_run(p,(old_run->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');replay:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'form-version');
 if replay->'run'->'executionVersions' is distinct from old_run->'executionVersions' or replay->'run'->'revision'->'checks' is distinct from old_run->'revision'->'checks' then raise exception 'Replay changed frozen form contract';end if;
 if has_function_privilege('authenticated','public.normalize_dynamic_check_definitions(jsonb)','execute') or has_function_privilege('authenticated','public.save_dynamic_revision_without_form_checks(uuid,uuid,jsonb,uuid)','execute') or has_function_privilege('authenticated','public.start_dynamic_run_without_form_checker_version(uuid,uuid,uuid,text)','execute') then raise exception 'Private form helpers exposed';end if;
 raise notice 'PASS: typed/empty form values, sanitized fields, rejected bad definitions, engine versions and immutable replay';
end $$;
rollback;
