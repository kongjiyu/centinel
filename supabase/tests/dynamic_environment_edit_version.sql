begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;edited jsonb;current_profile jsonb;
begin
 env:=public.save_dynamic_environment(p,'{"name":"Versioned editor","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"Original","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"fixture"}');
 edited:=public.save_dynamic_download_permissions(p,(env->>'id')::uuid,(env->>'version')::integer,'[{"selector":"#download","url":"http://localhost:3000/file","mimeType":"text/plain","maxBytes":1024,"publicTestData":true}]');
 begin perform public.save_dynamic_environment(p,env||jsonb_build_object('_expectedVersion',env->'version','accountRole','Stale'),(env->>'id')::uuid);raise exception 'Stale editor accepted';exception when raise_exception then if sqlerrm='Stale editor accepted' then raise;end if;end;
 select payload into current_profile from public.dynamic_environments where id=(env->>'id')::uuid;
 if current_profile is distinct from edited then raise exception 'Stale edit changed current permissions';end if;
 current_profile:=public.save_dynamic_environment(p,edited||jsonb_build_object('_expectedVersion',edited->'version','accountRole','Current'),(env->>'id')::uuid);
 if current_profile->>'accountRole'<>'Current' or current_profile->'actionPolicy' is distinct from edited->'actionPolicy' then raise exception 'Versioned edit lost permissions';end if;
 perform public.save_dynamic_environment(p,current_profile,(env->>'id')::uuid);
 if has_function_privilege('authenticated','public.save_dynamic_environment_without_edit_version(uuid,jsonb,uuid)','execute') then raise exception 'Private edit helper exposed';end if;
 raise notice 'PASS: stale general edits rejected, current edits preserve permissions, legacy saves compatible';
end $$;
rollback;
