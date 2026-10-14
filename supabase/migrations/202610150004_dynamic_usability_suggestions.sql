-- Optional advisory selection; existing revisions and Runs stay unchanged.
-- Optional, explicitly selected usability perspective/rules. No historical rewrites.
create or replace function public.validate_dynamic_usability(p_config jsonb,p_checks jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare rule jsonb;ids jsonb;ref jsonb;field text;
begin
 if jsonb_typeof(p_config) is distinct from 'object' or p_config->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_config->'persona') is distinct from 'string' or p_config->>'persona' not in ('first_time','keyboard_only','returning') then raise exception 'Supported usability configuration required';end if;
 if p_config ? 'includeSuggestions' and jsonb_typeof(p_config->'includeSuggestions') is distinct from 'boolean' then raise exception 'Explicit boolean suggestion selection required';end if;
 if exists(select 1 from jsonb_object_keys(p_config) k where k not in ('schemaVersion','includeSuggestions','persona','rules','feedbackCheckIds','errorRecoveryCheckIds')) then raise exception 'Unsupported usability field';end if;
 if jsonb_typeof(p_config->'rules') is distinct from 'array' then raise exception 'Usability rules required';end if;
 if jsonb_array_length(p_config->'rules') not between 1 and 5 or (select count(distinct value) from jsonb_array_elements(p_config->'rules'))<>jsonb_array_length(p_config->'rules') then raise exception 'Unique bounded usability rules required';end if;
 for rule in select value from jsonb_array_elements(p_config->'rules') loop
  if jsonb_typeof(rule) is distinct from 'string' or rule #>> '{}' not in ('labels','keyboard','focus','feedback','error_recovery') then raise exception 'Unsupported usability rule';end if;
 end loop;
 foreach field in array array['feedbackCheckIds','errorRecoveryCheckIds'] loop
  ids:=p_config->field;
  if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Explicit usability check references required';end if;
  if jsonb_array_length(ids)>20 or (select count(distinct value) from jsonb_array_elements(ids))<>jsonb_array_length(ids) then raise exception 'Unique bounded usability references required';end if;
  for ref in select value from jsonb_array_elements(ids) loop
   if jsonb_typeof(ref) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(p_checks) c where c->'id'=ref) then raise exception 'Usability references unknown check';end if;
   if field='feedbackCheckIds' and (p_config->'rules') ? 'feedback' and not exists(select 1 from jsonb_array_elements(p_checks) c where c->'id'=ref and c->>'kind' in ('visible_text','element_visible')) then raise exception 'Feedback needs a visible text or element check';end if;
  end loop;
  if ((field='feedbackCheckIds' and (p_config->'rules') ? 'feedback') or (field='errorRecoveryCheckIds' and (p_config->'rules') ? 'error_recovery')) and jsonb_array_length(ids)=0 then raise exception 'Selected rule needs explicit check references';end if;
 end loop;
end $$;
revoke all on function public.validate_dynamic_usability(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.validate_dynamic_usability_suggestions(p_assessment jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s jsonb:=p_assessment->'suggestions';model jsonb;idx jsonb;item jsonb;ref jsonb;indexes jsonb;count_observations integer:=jsonb_array_length(p_assessment->'observations');field text;
begin
 if jsonb_typeof(s) is distinct from 'object' or s->'schemaVersion' is distinct from '1'::jsonb or s->>'kind' is distinct from 'subjective' or coalesce(s->>'status','') not in ('completed','unavailable') then raise exception 'Explicit subjective suggestion record required';end if;
 if exists(select 1 from jsonb_object_keys(s) key where key not in ('schemaVersion','kind','status','reason','model','sampledObservationIndexes','omittedObservationCount','items')) then raise exception 'Unsupported suggestion metadata';end if;
 if jsonb_typeof(s->'sampledObservationIndexes') is distinct from 'array' or jsonb_typeof(s->'items') is distinct from 'array' or jsonb_typeof(s->'omittedObservationCount') is distinct from 'number' then raise exception 'Bounded suggestion sources required';end if;
 indexes:=s->'sampledObservationIndexes';
 if jsonb_array_length(indexes)>20 or (select count(distinct value) from jsonb_array_elements(indexes))<>jsonb_array_length(indexes) or jsonb_array_length(s->'items')>5 or (s->>'omittedObservationCount')::numeric<>count_observations-jsonb_array_length(indexes) then raise exception 'Suggestion source bounds exceeded';end if;
 for idx in select value from jsonb_array_elements(indexes) loop
  if jsonb_typeof(idx) is distinct from 'number' then raise exception 'Numeric observation index required';end if;
  if (idx::text)::numeric<>trunc((idx::text)::numeric) or (idx::text)::numeric not between 0 and count_observations-1 then raise exception 'Unknown observation index';end if;
 end loop;
 if s->>'status'='completed' then if s->'reason' is distinct from 'null'::jsonb then raise exception 'Completed suggestion record cannot carry failure reason';end if;
 else if coalesce(s->>'reason','') not in ('budget_limit','provider_unavailable','invalid_response','not_executed') or jsonb_array_length(s->'items')<>0 then raise exception 'Unavailable suggestions cannot invent items';end if;end if;
 model:=s->'model';
 if s->>'reason'='not_executed' then if model is distinct from 'null'::jsonb then raise exception 'No model was executed';end if;
 else
  if jsonb_typeof(model) is distinct from 'object' or exists(select 1 from jsonb_object_keys(model) key where key not in ('provider','apiFormat','model')) then raise exception 'Safe configured model metadata required';end if;
  foreach field in array array['provider','apiFormat','model'] loop if not coalesce(public.dynamic_context_text(model->field,250),false) then raise exception 'Bounded model label required';end if;end loop;
 end if;
 for item in select value from jsonb_array_elements(s->'items') loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'Suggestion object required';end if;
  if exists(select 1 from jsonb_object_keys(item) key where key not in ('ruleId','suggestion','rationale','observationIndexes','evidenceIds')) or not coalesce((p_assessment->'config'->'rules') ? (item->>'ruleId'),false) or not coalesce(public.dynamic_context_text(item->'suggestion',1000),false) or not coalesce(public.dynamic_context_text(item->'rationale',1000),false) then raise exception 'Supported bounded suggestion required';end if;
  if jsonb_typeof(item->'observationIndexes') is distinct from 'array' or jsonb_typeof(item->'evidenceIds') is distinct from 'array' then raise exception 'Suggestion references required';end if;
  if jsonb_array_length(item->'observationIndexes') not between 1 and 20 or (select count(distinct value) from jsonb_array_elements(item->'observationIndexes'))<>jsonb_array_length(item->'observationIndexes') or jsonb_array_length(item->'evidenceIds')=0 or (select count(distinct value) from jsonb_array_elements(item->'evidenceIds'))<>jsonb_array_length(item->'evidenceIds') then raise exception 'Unique suggestion sources required';end if;
  for idx in select value from jsonb_array_elements(item->'observationIndexes') loop
   if not indexes @> jsonb_build_array(idx) then raise exception 'Unsupplied suggestion observation';end if;
   if p_assessment->'observations'->((idx::text)::numeric)::integer->'ruleId' is distinct from item->'ruleId' then raise exception 'Suggestion rule does not match source';end if;
   if not (item->'evidenceIds') @> (p_assessment->'observations'->((idx::text)::numeric)::integer->'evidenceIds') then raise exception 'Missing suggestion proof';end if;
  end loop;
  for ref in select value from jsonb_array_elements(item->'evidenceIds') loop
   if jsonb_typeof(ref) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(item->'observationIndexes') source where (p_assessment->'observations'->((source::text)::numeric)::integer->'evidenceIds') @> jsonb_build_array(ref)) then raise exception 'Invented suggestion proof';end if;
  end loop;
 end loop;
end $$;
revoke all on function public.validate_dynamic_usability_suggestions(jsonb) from public,anon,authenticated;

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
 if exists(select 1 from jsonb_object_keys(a) k where k not in ('schemaVersion','config','observations','limitations','keyboardActions','assessedAt','suggestions')) then raise exception 'Unsupported assessment field';end if;
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
 if cfg->'includeSuggestions'='true'::jsonb then perform public.validate_dynamic_usability_suggestions(a);elsif a ? 'suggestions' then raise exception 'Model suggestions were not selected';end if;
 result:=result||jsonb_build_object('usability',a);
 update public.dynamic_runs set payload=result where id=(result->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.transition_dynamic_run(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.transition_dynamic_run(uuid,uuid,text,jsonb) to authenticated;


-- Version fresh Runs only. Reused requests and historical records stay immutable.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_suggestions_version(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_suggestions_version;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_suggestions_version(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_suggestions_version;end if;
end $$;
revoke all on function public.start_dynamic_run_without_suggestions_version(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_suggestions_version(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_suggestions_version(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' or result->'run'->'revision'->'usability'->'includeSuggestions' is distinct from 'true'::jsonb then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,usability}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_suggestions_version(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' or result->'run'->'revision'->'usability'->'includeSuggestions' is distinct from 'true'::jsonb then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,usability}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
