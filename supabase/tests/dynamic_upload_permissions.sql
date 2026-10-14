begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;rev jsonb;started jsonb;old_run jsonb;replay jsonb;bad jsonb;uploads jsonb:='[{"selector":"#upload","id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":4,"mimeType":"text/plain"}]';
begin
 env:=public.save_dynamic_environment(p,'{"name":"Upload permission fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture"}');
 env:=public.save_dynamic_upload_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,uploads);
 if env->'actionPolicy'->'uploads' is distinct from uploads or env->>'accountRole'<>'fixture' then raise exception 'Upload patch lost unrelated fields';end if;
 begin perform public.save_dynamic_upload_permissions(p,(env->>'id')::uuid,1,'[]');raise exception 'Stale upload edit accepted';exception when raise_exception then if sqlerrm='Stale upload edit accepted' then raise;end if;end;
 foreach bad in array array['null'::jsonb,uploads||uploads,jsonb_set(uploads,'{0,bytes}','1048577'),jsonb_set(uploads,'{0,bytes}','1.5'),jsonb_set(uploads,'{0,path}','"/private/file"'),jsonb_set(uploads,'{0,id}','null')] loop
  begin perform public.save_dynamic_upload_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,bad);raise exception 'Invalid upload accepted';exception when raise_exception then if sqlerrm='Invalid upload accepted' then raise;end if;end;
 end loop;
 perform public.record_dynamic_environment_data(p,(env->>'id')::uuid,'preparation','completed','Public synthetic upload baseline');
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Frozen uploads","goal":"Upload fixture","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Upload state","kind":"visible_text","expected":"Uploaded","required":true}]}');
 started:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'upload-permission-run',env||'{"variableNames":[],"preflight":[{"name":"ready","ready":true}],"actionPolicy":{"schemaVersion":1,"interactions":[],"allowCoordinates":false,"uploads":[]}}');old_run:=started->'run';
 if old_run->'actionPolicy'->'uploads' is distinct from uploads or old_run->'executionVersions'->>'files'<>'1' then raise exception 'Caller changed frozen upload permissions';end if;
 perform public.transition_dynamic_run(p,(old_run->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');
 env:=public.save_dynamic_upload_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,'[]');
 replay:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'upload-permission-run',env);
 if replay->'run'->'actionPolicy' is distinct from old_run->'actionPolicy' or replay->'run'->'executionVersions' is distinct from old_run->'executionVersions' then raise exception 'Replay changed frozen upload history';end if;
 raise notice 'PASS: upload metadata validated, atomic versioned edits, frozen DB grants and historical replay';
end $$;
rollback;
