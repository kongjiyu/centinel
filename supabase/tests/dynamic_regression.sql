begin;
set local role authenticated;select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare p uuid:='11111111-1111-4111-8111-111111111111';rev jsonb;started jsonb;baseline jsonb;ret jsonb;replay jsonb;id uuid;token uuid:='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';original jsonb;
begin
 rev:=public.save_dynamic_revision(p,auth.uid(),'{"name":"Regression pin","goal":"Ready","targetUrl":"http://localhost:3000/","maxSteps":2,"context":null,"checks":[{"id":"one","criterionId":"one","description":"Ready","kind":"visible_text","expected":"Ready","required":true}]}');started:=public.start_dynamic_run(p,auth.uid(),(rev->>'id')::uuid,'reg-baseline');id:=(started->'run'->>'id')::uuid;perform public.claim_dynamic_run(p,id,'worker',token,'session');baseline:=public.transition_dynamic_run(p,id,'running',jsonb_build_object('state','completed','verdict','failed','leaseToken',token,'checks','[{"checkId":"one","criterionId":"one","verdict":"failed","evidenceIds":["proof"]}]'::jsonb,'evidence','[{"id":"proof","kind":"screenshot","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","availability":"local"}]'::jsonb));original:=baseline;
 ret:=public.start_dynamic_regression_run(p,auth.uid(),(rev->>'id')::uuid,'reg-retest',id);if ret->'run'->'regression'->>'runId'<>id::text or ret->'run'->'regression'->>'revisionId'<>rev->>'id' or ret->'run'->'regression'->'checks' is distinct from baseline->'checks' then raise exception 'Baseline not pinned';end if;
 replay:=public.start_dynamic_regression_run(p,auth.uid(),(rev->>'id')::uuid,'reg-retest',id);if replay->>'reused'<>'true' then raise exception 'Regression replay duplicated Run';end if;
 begin perform public.start_dynamic_regression_run(p,auth.uid(),(rev->>'id')::uuid,'reg-retest','22222222-2222-4222-8222-222222222222');raise exception 'Changed baseline replay accepted';exception when raise_exception then if sqlerrm='Changed baseline replay accepted' then raise;end if;end;
 select r.payload into baseline from public.dynamic_runs r where r.id=(original->>'id')::uuid;
 if baseline is distinct from original then raise exception 'Retest rewrote baseline';end if;
 raise notice 'PASS: frozen baseline, pinned revision, idempotent replay and preserved failure history';
end $$;
rollback;
