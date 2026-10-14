begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;id uuid;token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';outcome jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Null credential fence","goal":"Observe fixture","targetUrl":"http://localhost:3000/","maxSteps":1,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'null-worker-fence');id:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,id,'worker',token,'session');
 if public.heartbeat_dynamic_run(p,id,null,null) or public.heartbeat_dynamic_run(p,id,'worker',null) or public.heartbeat_dynamic_run(p,id,null,token) then raise exception 'Null credentials renewed lease';end if;
 if not public.heartbeat_dynamic_run(p,id,'worker',token) then raise exception 'Healthy heartbeat blocked';end if;
 outcome:=public.transition_dynamic_run(p,id,'running','{"state":"completed","verdict":"passed","checks":[],"evidence":[]}');if outcome is not null then raise exception 'Missing token completed leased Run';end if;
 outcome:=public.transition_dynamic_run(p,id,'running','{"state":"blocked","verdict":"not_tested","checks":[],"evidence":[],"leaseToken":null}');if outcome is not null then raise exception 'Null token changed leased Run';end if;
 outcome:=public.transition_dynamic_run(p,id,'running','{"state":"cancelled","verdict":"not_tested","checks":[],"evidence":[]}');if outcome->>'state'<>'cancelled' then raise exception 'Member cancellation changed';end if;
 if has_function_privilege('authenticated','public.heartbeat_dynamic_run_without_null_fence(uuid,uuid,text,uuid)','execute') or has_function_privilege('authenticated','public.transition_dynamic_run_without_null_fence(uuid,uuid,text,jsonb)','execute') then raise exception 'Private null bypass exposed';end if;
 raise notice 'PASS: null heartbeat/finalization refused, healthy renewal and member cancellation preserved';
end $$;
rollback;
