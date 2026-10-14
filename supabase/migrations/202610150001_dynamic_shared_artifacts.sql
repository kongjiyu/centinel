-- Producer-registered diagnostic derivatives and public approved captures.
-- These never become independent criterion evidence or rewrite Run outcomes.
create table if not exists public.dynamic_run_artifacts(
 id uuid primary key,project_id uuid not null references public.projects(id) on delete cascade,
 run_id uuid not null references public.dynamic_runs(id) on delete cascade,slot text not null,
 payload jsonb not null,created_at timestamptz not null default now(),unique(run_id,slot)
);
alter table public.dynamic_run_artifacts enable row level security;
drop policy if exists dynamic_run_artifacts_read on public.dynamic_run_artifacts;
create policy dynamic_run_artifacts_read on public.dynamic_run_artifacts for select to authenticated using(public.is_project_member(project_id));
revoke all on public.dynamic_run_artifacts from public,anon,authenticated;
grant select on public.dynamic_run_artifacts to authenticated;

create or replace function public.register_dynamic_run_artifact(p_project_id uuid,p_run_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;old jsonb;result jsonb;aid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();kind text;artifact_slot text;bytes integer;mime text;manifest jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Artifact object required';end if;
 if exists(select 1 from jsonb_object_keys(p_input) key where key not in ('slot','kind','sha256','sourceSha256','bytes','mimeType','sourceManifestId','permissionUrl','privacyVersion','criterionProof')) then raise exception 'Unsupported artifact field';end if;
 kind:=p_input->>'kind';artifact_slot:=p_input->>'slot';mime:=p_input->>'mimeType';
 if kind is null or kind not in ('partial_trace','partial_network','partial_console','partial_budget','partial_observation','partial_manifest','download') or artifact_slot is null or length(artifact_slot) not between 1 and 100 or p_input->>'sha256' is null or p_input->>'sha256' !~ '^[a-f0-9]{64}$' or p_input->>'sourceSha256' is null or p_input->>'sourceSha256' !~ '^[a-f0-9]{64}$' or p_input->'privacyVersion' is distinct from '1'::jsonb or p_input->'criterionProof' is distinct from 'false'::jsonb or jsonb_typeof(p_input->'bytes') is distinct from 'number' then raise exception 'Bounded non-criterion artifact required';end if;
 begin bytes:=(p_input->>'bytes')::integer;exception when others then raise exception 'Bounded artifact bytes required';end;
 if bytes not between 0 and 4194304 or mime is null or length(mime)>100 or mime !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' then raise exception 'Bounded MIME and size required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'createdBy'<>auth.uid()::text then raise insufficient_privilege;end if;
 if kind='download' then
  if r->>'state' is distinct from 'completed' or bytes>1048576 or artifact_slot !~ '^download-[a-f0-9-]{36}$' or p_input->>'sourceSha256'<>p_input->>'sha256' or p_input->>'permissionUrl' is null then raise exception 'Completed bounded capture required';end if;
  select e into manifest from jsonb_array_elements(r->'evidence') e where e->>'id'=p_input->>'sourceManifestId' and e->>'kind'='file_manifest';
  if manifest is null then raise exception 'Immutable file manifest required';end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(r->'actionPolicy'->'downloads','[]')) g where g->>'url'=p_input->>'permissionUrl' and g->>'mimeType'=mime and g->'publicTestData'='true'::jsonb and bytes<=(g->>'maxBytes')::integer) then raise exception 'Frozen public-test-data permission required';end if;
  if not exists(select 1 from jsonb_array_elements(r->'checks') c join lateral jsonb_array_elements(r->'revision'->'checks') d on d->>'id'=c->>'checkId' and d->>'criterionId'=c->>'criterionId' where d->>'kind'='download_sha256' and d->>'url'=p_input->>'permissionUrl' and c->>'observed'='Captured SHA-256: '||(p_input->>'sha256') and c->>'verdict' in ('passed','failed') and c->'evidenceIds' ? (manifest->>'id')) then raise exception 'Matching independently observed capture required';end if;
 else
  if bytes=0 or r->>'state' is null or r->>'state' not in ('blocked','cancelled','interrupted') or mime<>'application/json' or p_input->>'sourceManifestId' is not null or p_input->>'permissionUrl' is not null then raise exception 'Stopped diagnostic artifact required';end if;
  if (kind='partial_manifest' and artifact_slot<>'manifest') or (kind='partial_trace' and artifact_slot<>'trace') or (kind='partial_network' and artifact_slot<>'network') or (kind='partial_console' and artifact_slot<>'console') or (kind='partial_budget' and artifact_slot<>'budget') or (kind='partial_observation' and artifact_slot !~ '^step-[0-9]{3}-(before|after)$') then raise exception 'Fixed diagnostic slot required';end if;
 end if;
 select payload into old from public.dynamic_run_artifacts where project_id=p_project_id and run_id=p_run_id and dynamic_run_artifacts.slot=artifact_slot;
 if old is not null then
  if old->>'sha256'<>p_input->>'sha256' or old->>'sourceSha256'<>p_input->>'sourceSha256' or (old->>'bytes')::integer<>bytes or old->>'mimeType'<>mime or old->>'kind'<>kind or old->'sourceManifestId' is distinct from p_input->'sourceManifestId' or old->'permissionUrl' is distinct from p_input->'permissionUrl' then raise exception 'Registered artifact changed';end if;
  return old;
 end if;
 if (select count(*) from public.dynamic_run_artifacts where run_id=p_run_id)>=64 then raise exception 'Run artifact count exceeded';end if;
 result:=p_input||jsonb_build_object('id',aid,'projectId',p_project_id,'runId',p_run_id,'capturedAt',r->>'updatedAt','registeredBy',auth.uid(),'createdAt',stamp,'criterionProof',false);
 insert into public.dynamic_run_artifacts(id,project_id,run_id,slot,payload,created_at) values(aid,p_project_id,p_run_id,artifact_slot,result,stamp);
 return result;
end $$;
revoke all on function public.register_dynamic_run_artifact(uuid,uuid,jsonb) from public,anon;
grant execute on function public.register_dynamic_run_artifact(uuid,uuid,jsonb) to authenticated;

-- Preserve the v1 independent-proof validator and its public signature.
do $$begin if to_regprocedure('public._prepare_dynamic_independent_copy_v1(uuid,uuid,text,integer)') is null then alter function public.prepare_dynamic_evidence_copy(uuid,uuid,text,integer) rename to _prepare_dynamic_independent_copy_v1;end if;end $$;
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
 if ref->>'sha256' is null or ref->>'sha256' !~ '^[a-f0-9]{64}$' or ref->>'kind' is null or ref->>'kind' not in ('screenshot','checks','file_manifest') then raise exception 'Recorded checksum and evidence kind required';end if;
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

create or replace function public.prepare_dynamic_evidence_copy(p_project_id uuid,p_run_id uuid,p_evidence_id text,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;ref jsonb;c public.dynamic_evidence_copies%rowtype;l public.dynamic_evidence_copy_leases%rowtype;stamp timestamptz:=clock_timestamp();expiry timestamptz;mime text;oid uuid:=gen_random_uuid();
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_bytes is null or p_bytes not between 0 and 4194304 or p_evidence_id is null or length(p_evidence_id) not between 1 and 200 then raise exception 'Bounded recorded evidence required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_run_artifacts where project_id=p_project_id and run_id=p_run_id and id::text=p_evidence_id;
 if r is null then return public._prepare_dynamic_independent_copy_v1(p_project_id,p_run_id,p_evidence_id,p_bytes);end if;
 if (r->>'bytes')::integer<>p_bytes then raise exception 'Immutable artifact bytes changed';end if;
 ref:=r;mime:=r->>'mimeType';expiry:=(r->>'capturedAt')::timestamptz+interval '7 days';
 select * into c from public.dynamic_evidence_copies where run_id=p_run_id and evidence_id=p_evidence_id for update;
 if c.id is null then
  c.id:=oid;c.project_id:=p_project_id;c.run_id:=p_run_id;c.evidence_id:=p_evidence_id;c.expires_at:=expiry;c.state:='pending';c.created_at:=stamp;c.updated_at:=stamp;
  c.object_path:=p_project_id::text||'/dynamic-v1/'||p_run_id::text||'/'||oid::text||'/'||(ref->>'sha256')||case when ref->>'kind'='download' then '.bin' when mime='image/png' then '.png' else '.json' end;
  c.payload:=jsonb_build_object('id',oid,'projectId',p_project_id,'runId',p_run_id,'evidenceId',p_evidence_id,'kind',ref->>'kind','sha256',ref->>'sha256','bytes',p_bytes,'mimeType',mime,'executorId',r->>'registeredBy','syncedBy',null,'deletedBy',null,'createdAt',stamp,'criterionProof',false,'sourceSha256',r->>'sourceSha256','privacyVersion',1);
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

revoke all on function public.prepare_dynamic_evidence_copy(uuid,uuid,text,integer) from public,anon;
grant execute on function public.prepare_dynamic_evidence_copy(uuid,uuid,text,integer) to authenticated;
