begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;rev jsonb;started jsonb;old_run jsonb;replay jsonb;bad jsonb;downloads jsonb:='[{"selector":"#download","url":"http://localhost:3000/file","maxBytes":1024,"mimeType":"text/plain","publicTestData":true}]';
begin
 env:=public.save_dynamic_environment(p,'{"name":"Download permission fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"fixture","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture"}');
 env:=public.save_dynamic_download_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,downloads);
 if env->'actionPolicy'->'downloads' is distinct from downloads or env->>'accountRole'<>'fixture' then raise exception 'Download patch lost unrelated fields';end if;
 begin perform public.save_dynamic_download_permissions(p,(env->>'id')::uuid,1,'[]');raise exception 'Stale download edit accepted';exception when raise_exception then if sqlerrm='Stale download edit accepted' then raise;end if;end;
 foreach bad in array array['null'::jsonb,downloads||downloads,jsonb_set(downloads,'{0,maxBytes}','1048577'),jsonb_set(downloads,'{0,maxBytes}','1.5'),jsonb_set(downloads,'{0,path}','"/private/file"'),jsonb_set(downloads,'{0,publicTestData}','false'),jsonb_set(downloads,'{0,url}','"http://outside.test/file"')] loop
  begin perform public.save_dynamic_download_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,bad);raise exception 'Invalid download accepted';exception when raise_exception then if sqlerrm='Invalid download accepted' then raise;end if;end;
 end loop;
 perform public.record_dynamic_environment_data(p,(env->>'id')::uuid,'preparation','completed','Public synthetic download baseline');
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Frozen downloads","goal":"Download fixture","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Download state","kind":"download_sha256","url":"http://localhost:3000/file","expected":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","required":true}]}');
 started:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'download-permission-run',env||'{"variableNames":[],"preflight":[{"name":"ready","ready":true}],"actionPolicy":{"schemaVersion":1,"interactions":[],"allowCoordinates":false,"downloads":[]}}');old_run:=started->'run';
 if old_run->'actionPolicy'->'downloads' is distinct from downloads or old_run->'executionVersions'->>'files'<>'2' then raise exception 'Caller changed frozen download permissions';end if;
 perform public.transition_dynamic_run(p,(old_run->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');
 env:=public.save_dynamic_download_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,'[]');
 replay:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'download-permission-run',env);
 if replay->'run'->'actionPolicy' is distinct from old_run->'actionPolicy' or replay->'run'->'executionVersions' is distinct from old_run->'executionVersions' then raise exception 'Replay changed frozen download history';end if;
 raise notice 'PASS: download metadata validated, atomic versioned edits, frozen DB grants and historical replay';
end $$;
rollback;
