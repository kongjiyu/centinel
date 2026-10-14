-- Fixed stopped-usability diagnostic slot; no Run or criterion finalization.
create or replace function public.register_dynamic_run_artifact(p_project_id uuid,p_run_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;old jsonb;result jsonb;aid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();kind text;artifact_slot text;bytes integer;mime text;manifest jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Artifact object required';end if;
 if exists(select 1 from jsonb_object_keys(p_input) key where key not in ('slot','kind','sha256','sourceSha256','bytes','mimeType','sourceManifestId','permissionUrl','privacyVersion','criterionProof')) then raise exception 'Unsupported artifact field';end if;
 kind:=p_input->>'kind';artifact_slot:=p_input->>'slot';mime:=p_input->>'mimeType';
 if kind is null or kind not in ('partial_trace','partial_network','partial_console','partial_budget','partial_observation','partial_manifest','partial_usability','download') or artifact_slot is null or length(artifact_slot) not between 1 and 100 or p_input->>'sha256' is null or p_input->>'sha256' !~ '^[a-f0-9]{64}$' or p_input->>'sourceSha256' is null or p_input->>'sourceSha256' !~ '^[a-f0-9]{64}$' or p_input->'privacyVersion' is distinct from '1'::jsonb or p_input->'criterionProof' is distinct from 'false'::jsonb or jsonb_typeof(p_input->'bytes') is distinct from 'number' then raise exception 'Bounded non-criterion artifact required';end if;
 begin bytes:=(p_input->>'bytes')::integer;exception when others then raise exception 'Bounded artifact bytes required';end;
 if bytes not between 0 and 4194304 or mime is null or length(mime)>100 or mime !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' then raise exception 'Bounded MIME and size required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id;
 if r is null or r->>'createdBy'<>auth.uid()::text then raise insufficient_privilege;end if;
 if kind='partial_usability' and jsonb_typeof(r->'revision'->'usability') is distinct from 'object' then raise exception 'Selected usability scope required';end if;
 if kind='download' then
  if r->>'state' is distinct from 'completed' or bytes>1048576 or artifact_slot !~ '^download-[a-f0-9-]{36}$' or p_input->>'sourceSha256'<>p_input->>'sha256' or p_input->>'permissionUrl' is null then raise exception 'Completed bounded capture required';end if;
  select e into manifest from jsonb_array_elements(r->'evidence') e where e->>'id'=p_input->>'sourceManifestId' and e->>'kind'='file_manifest';
  if manifest is null then raise exception 'Immutable file manifest required';end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(r->'actionPolicy'->'downloads','[]')) g where g->>'url'=p_input->>'permissionUrl' and g->>'mimeType'=mime and g->'publicTestData'='true'::jsonb and bytes<=(g->>'maxBytes')::integer) then raise exception 'Frozen public-test-data permission required';end if;
  if not exists(select 1 from jsonb_array_elements(r->'checks') c join lateral jsonb_array_elements(r->'revision'->'checks') d on d->>'id'=c->>'checkId' and d->>'criterionId'=c->>'criterionId' where d->>'kind'='download_sha256' and d->>'url'=p_input->>'permissionUrl' and c->>'observed'='Captured SHA-256: '||(p_input->>'sha256') and c->>'verdict' in ('passed','failed') and c->'evidenceIds' ? (manifest->>'id')) then raise exception 'Matching independently observed capture required';end if;
 else
  if bytes=0 or r->>'state' is null or r->>'state' not in ('blocked','cancelled','interrupted') or mime<>'application/json' or p_input->>'sourceManifestId' is not null or p_input->>'permissionUrl' is not null then raise exception 'Stopped diagnostic artifact required';end if;
  if (kind='partial_usability' and artifact_slot<>'usability') or (kind='partial_manifest' and artifact_slot<>'manifest') or (kind='partial_trace' and artifact_slot<>'trace') or (kind='partial_network' and artifact_slot<>'network') or (kind='partial_console' and artifact_slot<>'console') or (kind='partial_budget' and artifact_slot<>'budget') or (kind='partial_observation' and artifact_slot !~ '^step-[0-9]{3}-(before|after)$') then raise exception 'Fixed diagnostic slot required';end if;
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
