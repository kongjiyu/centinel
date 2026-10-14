-- ISOLATED UPGRADE FIXTURE ONLY: run before the resource migration.
create table public.resource_upgrade_before(profile_id uuid primary key,payload jsonb,events jsonb);
grant select,insert on public.resource_upgrade_before to authenticated;
set role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';env jsonb;env_id uuid;rev jsonb;run jsonb;input jsonb;i integer;
begin
 input:='{"name":"Existing ready fixture","targetUrl":"http://localhost:3000/","allowedOrigins":["http://localhost:3000"],"viewport":{"width":1280,"height":720},"accountRole":"QA","requiredVariables":[],"startupInstructions":"Manual","targetVersion":"before-resource-migration"}';
 for i in 1..2 loop
  env:=public.save_dynamic_environment(p,input||jsonb_build_object('name',case when i=1 then 'Existing ready fixture' else 'Existing dirty fixture' end));env_id:=(env->>'id')::uuid;
  perform public.record_dynamic_environment_data(p,env_id,'preparation','completed','Existing baseline and ledger must be preserved');
  if i=2 then
   rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Old cancelled run","goal":"Observe form","targetUrl":"http://localhost:3000","maxSteps":1,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Form","kind":"visible_text","expected":"Ready","required":true}]}');
   run:=public.start_dynamic_environment_run(p,auth.uid(),(rev->>'id')::uuid,'old-upgrade-run',env||'{"preflight":[{"name":"fixture","ready":true}],"variableNames":[]}');
   perform public.transition_dynamic_run(p,(run->'run'->>'id')::uuid,'queued','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');perform public.read_dynamic_environment_data(p,env_id);
  end if;
  insert into public.resource_upgrade_before select env_id,to_jsonb(d),(select jsonb_agg(to_jsonb(e) order by e.id) from public.dynamic_environment_events e where e.profile_id=env_id) from public.dynamic_environment_data d where d.profile_id=env_id;
 end loop;
end $$;
reset role;
