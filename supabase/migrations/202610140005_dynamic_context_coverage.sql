-- Validate the versioned mock consumer boundary; never scan or approve Static.
create or replace function public.dynamic_context_text(p_value jsonb,p_limit integer)
returns boolean language sql immutable set search_path=public as $$select jsonb_typeof(p_value)='string' and length(btrim(p_value#>>'{}')) between 1 and p_limit$$;
create or replace function public.normalize_dynamic_incoming_context(p_project_id uuid,p_context jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare source jsonb;requirement jsonb;criterion jsonb;risk jsonb;conflict jsonb;item jsonb;sources jsonb:='[]';requirements jsonb:='[]';criteria jsonb;risks jsonb:='[]';conflicts jsonb:='[]';source_ids text[]:='{}';requirement_ids text[]:='{}';criterion_ids text[]:='{}';risk_ids text[]:='{}';target jsonb;
begin
 if p_context is null or p_context='null'::jsonb then return 'null'::jsonb;end if;
 if jsonb_typeof(p_context) is distinct from 'object' or p_context->'schemaVersion' is distinct from '1'::jsonb or p_context->>'provenance' is distinct from 'mock-static' or p_context->>'projectId' is distinct from p_project_id::text then raise exception 'Invalid or cross-project incoming context';end if;
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
 if jsonb_typeof(target) is distinct from 'object' or not coalesce(public.dynamic_context_text(target->'repository',4000),false) or target->>'repository' !~ '^https?://[^/@]+(/|$)' or not coalesce(target->>'commit' ~ '^[0-9a-fA-F]{40}$',false) or target->'deploymentVersion' is distinct from 'null'::jsonb then raise exception 'Invalid target version metadata';end if;
 return jsonb_build_object('schemaVersion',1,'provenance','mock-static','projectId',p_project_id,'reviewId',p_context->'reviewId','snapshotId',p_context->'snapshotId','approvalState',p_context->'approvalState','sources',sources,'requirements',requirements,'risks',risks,'conflicts',conflicts,'limitations',p_context->'limitations','target',jsonb_build_object('repository',target->'repository','commit',target->'commit','deploymentVersion',null));
end $$;
revoke all on function public.dynamic_context_text(jsonb,integer),public.normalize_dynamic_incoming_context(uuid,jsonb) from public,anon,authenticated;
do $$begin if to_regprocedure('public.save_dynamic_revision_without_context_contract(uuid,uuid,jsonb,uuid)') is null then alter function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) rename to save_dynamic_revision_without_context_contract;end if;end $$;
revoke all on function public.save_dynamic_revision_without_context_contract(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_revision(p_project_id uuid,p_actor_id uuid,p_input jsonb,p_mission_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb;exclusions jsonb:=coalesce(p_input->'criterionExclusions','[]'::jsonb);clean_exclusions jsonb:='[]';excluded_ids text[]:='{}';criteria_ids text[]:='{}';check_ids text[]:='{}';item jsonb;requirement jsonb;check_item jsonb;result jsonb;needs_ack boolean;
begin
 if auth.uid() is null or auth.uid()<>p_actor_id or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 if p_input?'contextAcknowledged' and jsonb_typeof(p_input->'contextAcknowledged') is distinct from 'boolean' then raise exception 'Explicit context acknowledgment required';end if;
 if jsonb_typeof(p_input->'checks') is distinct from 'array' then raise exception 'Checks required';end if;
 if jsonb_array_length(p_input->'checks') not between 1 and 20 then raise exception 'Bounded checks required';end if;
 context:=public.normalize_dynamic_incoming_context(p_project_id,p_input->'context');
 if jsonb_typeof(exclusions) is distinct from 'array' or jsonb_array_length(exclusions)>500 then raise exception 'Bounded criterion exclusions required';end if;
 if context<>'null'::jsonb then
  for requirement in select * from jsonb_array_elements(context->'requirements') loop for item in select * from jsonb_array_elements(requirement->'criteria') loop criteria_ids:=array_append(criteria_ids,item->>'id');end loop;end loop;
  needs_ack:=context->>'approvalState'<>'approved' or jsonb_array_length(context->'conflicts')>0 or exists(select 1 from jsonb_array_elements(context->'sources') source where source->>'currency'<>'current') or exists(select 1 from jsonb_array_elements(context->'requirements') supplied_requirement where jsonb_array_length(supplied_requirement->'criteria')=0);
  if needs_ack and p_input->'contextAcknowledged' is distinct from 'true'::jsonb then raise exception 'Acknowledge stale, conflicting, pending or incomplete mock context';end if;
  if jsonb_typeof(p_input->'checks') is distinct from 'array' then raise exception 'Checks required';end if;
  for check_item in select * from jsonb_array_elements(p_input->'checks') loop
   if not coalesce(public.dynamic_context_text(check_item->'id',200),false) or check_item->>'id'=any(check_ids) or not coalesce(public.dynamic_context_text(check_item->'description',4000),false) or jsonb_typeof(check_item->'required') is distinct from 'boolean' then raise exception 'Invalid or duplicate configured check identity';end if;
   check_ids:=array_append(check_ids,check_item->>'id');
   if not coalesce(public.dynamic_context_text(check_item->'criterionId',200),false) or not coalesce(check_item->>'criterionId'=any(criteria_ids),false) then raise exception 'Check criterion absent from incoming snapshot';end if;end loop;
 end if;
 for item in select * from jsonb_array_elements(exclusions) loop
  if not coalesce(public.dynamic_context_text(item->'criterionId',200),false) or not coalesce(item->>'criterionId'=any(criteria_ids),false) or item->>'criterionId'=any(excluded_ids) or not coalesce(public.dynamic_context_text(item->'reason',2000),false) then raise exception 'Invalid or dangling exclusion';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'checks') configured_check where configured_check->>'criterionId'=item->>'criterionId') then raise exception 'Executing criterion cannot be excluded';end if;
  excluded_ids:=array_append(excluded_ids,item->>'criterionId');clean_exclusions:=clean_exclusions||jsonb_build_array(jsonb_build_object('criterionId',item->'criterionId','reason',btrim(item->>'reason')));
 end loop;
 result:=public.save_dynamic_revision_without_context_contract(p_project_id,p_actor_id,jsonb_set(p_input,'{context}',context),p_mission_id)||jsonb_build_object('criterionExclusions',clean_exclusions);
 update public.dynamic_mission_revisions set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;
 return result;
end $$;
revoke all on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) to authenticated;
