-- Fenced terminal observations remain separate from the functional check verdict.
do $$begin
 if to_regprocedure('public.transition_dynamic_run_without_usability(uuid,uuid,text,jsonb)') is null then alter function public.transition_dynamic_run(uuid,uuid,text,jsonb) rename to transition_dynamic_run_without_usability;end if;
end $$;
revoke all on function public.transition_dynamic_run_without_usability(uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.transition_dynamic_run(p_project_id uuid,p_run_id uuid,p_expected text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;a jsonb;cfg jsonb;row jsonb;ref jsonb;proof_id text;keys text[]:='{}';observation_key text;rule jsonb;
begin
 -- Existing transition holds the row lock and checks actor, live lease and state.
 result:=public.transition_dynamic_run_without_usability(p_project_id,p_run_id,p_expected,p_patch);
 if result is null then return null;end if;
 if result->>'state'<>'completed' then
  if p_patch ? 'usability' then raise exception 'Only terminal verification can retain usability results';end if;return result;
 end if;
 cfg:=result->'revision'->'usability';a:=p_patch->'usability';
 if cfg is null then if a is not null then raise exception 'Unselected usability results';end if;return result;end if;
 if jsonb_typeof(a) is distinct from 'object' or a->'schemaVersion' is distinct from '1'::jsonb or a->'config' is distinct from cfg or octet_length(a::text)>400000 then raise exception 'Frozen bounded usability assessment required';end if;
 if exists(select 1 from jsonb_object_keys(a) k where k not in ('schemaVersion','config','observations','limitations','keyboardActions','assessedAt')) then raise exception 'Unsupported assessment field';end if;
 if jsonb_typeof(a->'observations') is distinct from 'array' or jsonb_typeof(a->'limitations') is distinct from 'array' or jsonb_typeof(a->'keyboardActions') is distinct from 'number' or jsonb_typeof(a->'assessedAt') is distinct from 'string' then raise exception 'Assessment fields required';end if;
 if jsonb_array_length(a->'observations')>160 or jsonb_array_length(a->'limitations') not between 1 and 10 or (a->>'keyboardActions')::numeric not between 0 and 42 or (a->>'keyboardActions')::numeric<>trunc((a->>'keyboardActions')::numeric) or length(a->>'assessedAt')>50 then raise exception 'Assessment bounds exceeded';end if;
 if not isfinite((a->>'assessedAt')::timestamptz) then raise exception 'Finite assessment timestamp required';end if;
 if jsonb_typeof(result->'evidence') is distinct from 'array' then raise exception 'Assessment evidence required';end if;
 if (select count(*) from jsonb_array_elements(result->'evidence') e where e->>'kind'='usability')<>1 then raise exception 'Unique assessment proof required';end if;
 select e->>'id' into proof_id from jsonb_array_elements(result->'evidence') e where e->>'kind'='usability' and e->>'sha256'~'^[a-f0-9]{64}$';
 if proof_id is null then raise exception 'Assessment checksum required';end if;
 for row in select value from jsonb_array_elements(a->'observations') loop
  if jsonb_typeof(row) is distinct from 'object' then raise exception 'Observation object required';end if;
  if exists(select 1 from jsonb_object_keys(row) k where k not in ('ruleId','persona','kind','verdict','expected','observed','controlRef','checkId','evidenceIds')) or not coalesce((cfg->'rules') ? (row->>'ruleId'),false) or row->'persona' is distinct from cfg->'persona' or row->>'kind' is distinct from 'deterministic' or coalesce(row->>'verdict','') not in ('passed','failed','uncertain','not_tested') then raise exception 'Observation must match selected rule/persona';end if;
  if not coalesce(public.dynamic_context_text(row->'expected',2000),false) or not coalesce(public.dynamic_context_text(row->'observed',2000),false) then raise exception 'Bounded observation text required';end if;
  if row ? 'controlRef' and (jsonb_typeof(row->'controlRef') is distinct from 'string' or row->>'controlRef'!~'^u([0-9]|[1-3][0-9])$') then raise exception 'Invalid sampled control';end if;
  if row ? 'checkId' and (jsonb_typeof(row->'checkId') is distinct from 'string' or not coalesce((case row->>'ruleId' when 'feedback' then cfg->'feedbackCheckIds' when 'error_recovery' then cfg->'errorRecoveryCheckIds' else '[]'::jsonb end) ? (row->>'checkId'),false)) then raise exception 'Invalid criterion reference';end if;
  observation_key:=jsonb_build_array(row->>'ruleId',row->>'controlRef',row->>'checkId')::text;if observation_key=any(keys) then raise exception 'Duplicate rule observation';end if;keys:=array_append(keys,observation_key);
  if jsonb_typeof(row->'evidenceIds') is distinct from 'array' then raise exception 'Observation proof references required';end if;
  if not (row->'evidenceIds') ? proof_id or jsonb_array_length(row->'evidenceIds')>20 or (select count(distinct value) from jsonb_array_elements(row->'evidenceIds'))<>jsonb_array_length(row->'evidenceIds') then raise exception 'Unique assessment evidence required';end if;
  for ref in select value from jsonb_array_elements(row->'evidenceIds') loop
   if jsonb_typeof(ref) is distinct from 'string' or (select count(*) from jsonb_array_elements(result->'evidence') e where e->'id'=ref and e->>'sha256'~'^[a-f0-9]{64}$')<>1 then raise exception 'Dangling or ambiguous assessment evidence';end if;
  end loop;
 end loop;
 for rule in select value from jsonb_array_elements(cfg->'rules') loop
  if not exists(select 1 from jsonb_array_elements(a->'observations') o where o->'ruleId'=rule) then raise exception 'Selected rule result missing';end if;
 end loop;
 for row in select value from jsonb_array_elements(a->'limitations') loop if not coalesce(public.dynamic_context_text(row,2000),false) then raise exception 'Assessment limitations required';end if;end loop;
 result:=result||jsonb_build_object('usability',a);
 update public.dynamic_runs set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.transition_dynamic_run(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.transition_dynamic_run(uuid,uuid,text,jsonb) to authenticated;

-- Extend existing immutable-copy transport to the fixed usability JSON slot.
create or replace function public._prepare_dynamic_independent_copy_v1(p_project_id uuid,p_run_id uuid,p_evidence_id text,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;ref jsonb;c public.dynamic_evidence_copies%rowtype;l public.dynamic_evidence_copy_leases%rowtype;stamp timestamptz:=clock_timestamp();expiry timestamptz;mime text;oid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_bytes is null or p_bytes not between 1 and 4194304 or p_evidence_id is null or length(p_evidence_id) not between 1 and 200 then raise exception 'Bounded recorded evidence required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'state' is distinct from 'completed' or jsonb_typeof(r->'evidence') is distinct from 'array' then raise exception 'Completed independent evidence required';end if;
 if (select count(*) from jsonb_array_elements(r->'evidence') e where e->>'id'=p_evidence_id)<>1 then raise exception 'Unique recorded evidence required';end if;
 select e into ref from jsonb_array_elements(r->'evidence') e where e->>'id'=p_evidence_id;
 if ref->>'sha256' is null or ref->>'sha256' !~ '^[a-f0-9]{64}$' or ref->>'kind' is null or ref->>'kind' not in ('screenshot','checks','file_manifest','usability') then raise exception 'Recorded checksum and evidence kind required';end if;
 mime:=case when ref->>'kind'='screenshot' then 'image/png' else 'application/json' end;
 begin expiry:=coalesce((ref->>'capturedAt')::timestamptz,(r->>'createdAt')::timestamptz)+interval '7 days';exception when others then raise exception 'Recorded capture date required';end;
 if expiry is null then raise exception 'Recorded capture date required';end if;
 select * into c from public.dynamic_evidence_copies where run_id=p_run_id and evidence_id=p_evidence_id for update;
 if c.id is null then
  c.id:=oid;c.project_id:=p_project_id;c.run_id:=p_run_id;c.evidence_id:=p_evidence_id;c.expires_at:=expiry;c.state:='pending';c.created_at:=stamp;c.updated_at:=stamp;
  c.object_path:=p_project_id::text||'/dynamic-v1/'||p_run_id::text||'/'||oid::text||'/'||(ref->>'sha256')||case when mime='image/png' then '.png' else '.json' end;
  c.payload:=jsonb_build_object('id',oid,'projectId',p_project_id,'runId',p_run_id,'evidenceId',p_evidence_id,'kind',ref->>'kind','sha256',ref->>'sha256','bytes',p_bytes,'mimeType',mime,'executorId',r->>'createdBy','syncedBy',null,'deletedBy',null,'createdAt',stamp);
  insert into public.dynamic_evidence_copies(id,project_id,run_id,evidence_id,object_path,state,expires_at,payload,created_at,updated_at) values(c.id,p_project_id,p_run_id,p_evidence_id,c.object_path,c.state,c.expires_at,c.payload,stamp,stamp);
 end if;
 if c.project_id<>p_project_id or c.payload->>'sha256'<>ref->>'sha256' or (c.payload->>'bytes')::integer<>p_bytes then raise exception 'Immutable evidence descriptor changed';end if;
 if c.state='deleted' or c.expires_at<=stamp then return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',null);end if;
 if c.state='available' then return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',null);end if;
 if c.state='deleting' then raise exception 'Finish recorded deletion first';end if;
 select * into l from public.dynamic_evidence_copy_leases where copy_id=c.id for update;
 if l.copy_id is not null and l.expires_at>stamp and l.owner_id<>auth.uid() then raise exception 'Evidence transfer still owned by another account';end if;
 if l.copy_id is null or l.expires_at<=stamp then l.token:=gen_random_uuid();end if;
 insert into public.dynamic_evidence_copy_leases(copy_id,owner_id,token,expires_at) values(c.id,auth.uid(),l.token,stamp+interval '2 minutes') on conflict(copy_id) do update set owner_id=excluded.owner_id,token=excluded.token,expires_at=excluded.expires_at;
 update public.dynamic_evidence_copies set state='pending',updated_at=stamp where id=c.id returning * into c;
 return jsonb_build_object('copy',public._dynamic_evidence_copy_json(c),'objectPath',c.object_path,'token',l.token);
end $$;

revoke all on function public._prepare_dynamic_independent_copy_v1(uuid,uuid,text,integer) from public,anon,authenticated;
