-- Accept incoming Dynamic context exported from a frozen Static Review snapshot
-- (provenance review-snapshot) alongside the existing mock-static development
-- input. Additive: the existing mock contract is unchanged; a Review snapshot may
-- record an unknown repository or commit as null. Never scans or approves Static.
create or replace function public.normalize_dynamic_incoming_context(p_project_id uuid,p_context jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare source jsonb;requirement jsonb;criterion jsonb;risk jsonb;conflict jsonb;item jsonb;sources jsonb:='[]';requirements jsonb:='[]';criteria jsonb;risks jsonb:='[]';conflicts jsonb:='[]';source_ids text[]:='{}';requirement_ids text[]:='{}';criterion_ids text[]:='{}';risk_ids text[]:='{}';target jsonb;
begin
 if p_context is null or p_context='null'::jsonb then return 'null'::jsonb;end if;
 if jsonb_typeof(p_context) is distinct from 'object' or p_context->'schemaVersion' is distinct from '1'::jsonb or coalesce(p_context->>'provenance','') not in ('mock-static','review-snapshot') or p_context->>'projectId' is distinct from p_project_id::text then raise exception 'Invalid or cross-project incoming context';end if;
 if not coalesce(public.dynamic_context_text(p_context->'reviewId',200),false) or not coalesce(public.dynamic_context_text(p_context->'snapshotId',200),false) or coalesce(p_context->>'approvalState','') not in ('approved','pending') then raise exception 'Invalid incoming context identity or approval metadata';end if;
 if jsonb_typeof(p_context->'sources') is distinct from 'array' or jsonb_typeof(p_context->'requirements') is distinct from 'array' or jsonb_typeof(p_context->'risks') is distinct from 'array' or jsonb_typeof(p_context->'conflicts') is distinct from 'array' or jsonb_typeof(p_context->'limitations') is distinct from 'array' then raise exception 'Incoming context arrays required';end if;
 if jsonb_array_length(p_context->'sources')>50 or jsonb_array_length(p_context->'requirements')>100 or jsonb_array_length(p_context->'risks')>100 or jsonb_array_length(p_context->'conflicts')>100 or jsonb_array_length(p_context->'limitations')>100 then raise exception 'Incoming context arrays exceed bounds';end if;
 for source in select * from jsonb_array_elements(p_context->'sources') loop
  if not coalesce(public.dynamic_context_text(source->'id',200),false) or not coalesce(public.dynamic_context_text(source->'version',200),false) or not coalesce(public.dynamic_context_text(source->'uri',4000),false) or coalesce(source->>'currency','') not in ('current','stale','unknown') or source->>'id'=any(source_ids) then raise exception 'Invalid or duplicate incoming source';end if;
  source_ids:=array_append(source_ids,source->>'id');sources:=sources||jsonb_build_array(jsonb_build_object('id',source->'id','version',source->'version','currency',source->'currency','uri',source->'uri'));
 end loop;
 for requirement in select * from jsonb_array_elements(p_context->'requirements') loop
  if not coalesce(public.dynamic_context_text(requirement->'id',200),false) or not coalesce(public.dynamic_context_text(requirement->'description',4000),false) or requirement->>'id'=any(requirement_ids) or not coalesce(public.dynamic_context_text(requirement->'sourceId',200),false) or not coalesce(requirement->>'sourceId'=any(source_ids),false) or jsonb_typeof(requirement->'revision') is distinct from 'number' then raise exception 'Invalid, duplicate or dangling requirement';end if;
  if (requirement->>'revision')::numeric<>trunc((requirement->>'revision')::numeric) or (requirement->>'revision')::numeric<1 or (requirement->>'revision')::numeric>9007199254740991 then raise exception 'Requirement revision must be a positive safe integer';end if;
  if jsonb_typeof(requirement->'criteria') is distinct from 'array' or jsonb_array_length(requirement->'criteria')>100 then raise exception 'Bounded criteria array required';end if;
  requirement_ids:=array_append(requirement_ids,requirement->>'id');criteria:='[]';
  for criterion in select * from jsonb_array_elements(requirement->'criteria') loop
   if not coalesce(public.dynamic_context_text(criterion->'id',200),false) or not coalesce(public.dynamic_context_text(criterion->'description',4000),false) or criterion->>'id'=any(criterion_ids) then raise exception 'Invalid or duplicate criterion';end if;
   criterion_ids:=array_append(criterion_ids,criterion->>'id');if cardinality(criterion_ids)>500 then raise exception 'Too many supplied criteria';end if;
   criteria:=criteria||jsonb_build_array(jsonb_build_object('id',criterion->'id','description',criterion->'description'));
  end loop;
  requirements:=requirements||jsonb_build_array(jsonb_build_object('id',requirement->'id','revision',requirement->'revision','description',requirement->'description','sourceId',requirement->'sourceId','criteria',criteria));
 end loop;
 for risk in select * from jsonb_array_elements(p_context->'risks') loop
  if not coalesce(public.dynamic_context_text(risk->'id',200),false) or risk->>'id'=any(risk_ids) or not coalesce(public.dynamic_context_text(risk->'requirementId',200),false) or not coalesce(risk->>'requirementId'=any(requirement_ids),false) or coalesce(risk->>'priority','') not in ('high','medium') or not coalesce(public.dynamic_context_text(risk->'rationale',4000),false) then raise exception 'Invalid or dangling synthetic risk';end if;
  risk_ids:=array_append(risk_ids,risk->>'id');risks:=risks||jsonb_build_array(jsonb_build_object('id',risk->'id','requirementId',risk->'requirementId','priority',risk->'priority','rationale',risk->'rationale'));
 end loop;
 for conflict in select * from jsonb_array_elements(p_context->'conflicts') loop
  if not coalesce(public.dynamic_context_text(conflict->'requirementId',200),false) or not coalesce(conflict->>'requirementId'=any(requirement_ids),false) or not coalesce(public.dynamic_context_text(conflict->'description',4000),false) then raise exception 'Invalid or dangling conflict';end if;
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('requirementId',conflict->'requirementId','description',conflict->'description'));
 end loop;
 for item in select * from jsonb_array_elements(p_context->'limitations') loop if not coalesce(public.dynamic_context_text(item,4000),false) then raise exception 'Invalid context limitation';end if;end loop;
 target:=p_context->'target';
 if jsonb_typeof(target) is distinct from 'object' or target->'deploymentVersion' is distinct from 'null'::jsonb then raise exception 'Invalid target version metadata';end if;
 -- A Review snapshot records an unknown repository or commit as null; mock input must name both.
 if not (p_context->>'provenance'='review-snapshot' and target->'repository'='null'::jsonb) and (not coalesce(public.dynamic_context_text(target->'repository',4000),false) or target->>'repository' !~ '^https?://[^/@]+(/|$)') then raise exception 'Invalid target repository metadata';end if;
 if not (p_context->>'provenance'='review-snapshot' and target->'commit'='null'::jsonb) and not coalesce(target->>'commit' ~ '^[0-9a-fA-F]{40}$',false) then raise exception 'Invalid target commit metadata';end if;
 return jsonb_build_object('schemaVersion',1,'provenance',p_context->'provenance','projectId',p_project_id,'reviewId',p_context->'reviewId','snapshotId',p_context->'snapshotId','approvalState',p_context->'approvalState','sources',sources,'requirements',requirements,'risks',risks,'conflicts',conflicts,'limitations',p_context->'limitations','target',jsonb_build_object('repository',target->'repository','commit',target->'commit','deploymentVersion',null));
end $$;
revoke all on function public.normalize_dynamic_incoming_context(uuid,jsonb) from public,anon,authenticated;
