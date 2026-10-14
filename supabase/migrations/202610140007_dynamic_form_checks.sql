-- Typed, bounded form expectations; preserve old revisions and original Run engine versions.
create or replace function public.normalize_dynamic_check_definitions(p_checks jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare item jsonb;result jsonb:='[]';row_result jsonb;ids text[]:='{}';values_seen text[];option_value jsonb;kind text;required_found boolean:=false;
begin
 if jsonb_typeof(p_checks) is distinct from 'array' then raise exception 'Checks must be an array';end if;
 if jsonb_array_length(p_checks) not between 1 and 20 then raise exception 'Checks outside supported bounds';end if;
 for item in select value from jsonb_array_elements(p_checks) loop
  if jsonb_typeof(item) is distinct from 'object' or not coalesce(public.dynamic_context_text(item->'id',200),false) or item->>'id'=any(ids) or not coalesce(public.dynamic_context_text(item->'criterionId',200),false) or jsonb_typeof(item->'required') is distinct from 'boolean' then raise exception 'Invalid or duplicate check identity';end if;
  ids:=array_append(ids,item->>'id');required_found:=required_found or item->'required'='true'::jsonb;kind:=item->>'kind';
  if kind is null or kind not in ('url','visible_text','element_visible','field_value','field_checked','field_enabled','field_valid','selected_values') then raise exception 'Unsupported check kind';end if;
  -- Old direct RPC clients omitted descriptions; retain compatibility with an explicit generic label.
  if item ? 'description' and not coalesce(public.dynamic_context_text(item->'description',4000),false) then raise exception 'Invalid check description';end if;
  row_result:=jsonb_build_object('id',item->'id','criterionId',item->'criterionId','description',coalesce(item->'description','"Configured browser check"'::jsonb),'required',item->'required','kind',kind);
  if kind not in ('url','visible_text') then
   if not coalesce(public.dynamic_context_text(item->'selector',1000),false) then raise exception 'Bounded selector required';end if;
   row_result:=row_result||jsonb_build_object('selector',item->'selector');
  end if;
  if kind in ('url','visible_text') then
   if not coalesce(public.dynamic_context_text(item->'expected',1000),false) then raise exception 'Bounded expectation required';end if;
  elsif kind='field_value' then
   if jsonb_typeof(item->'expected') is distinct from 'string' or length(item->>'expected')>1000 then raise exception 'Field value must be a bounded string';end if;
  elsif kind in ('field_checked','field_enabled','field_valid') then
   if jsonb_typeof(item->'expected') is distinct from 'boolean' then raise exception 'Form state must be an explicit boolean';end if;
  elsif kind='selected_values' then
   if jsonb_typeof(item->'expected') is distinct from 'array' then raise exception 'Selected values must be a list';end if;
   if jsonb_array_length(item->'expected')>30 then raise exception 'Too many selected values';end if;values_seen:='{}';
   for option_value in select value from jsonb_array_elements(item->'expected') loop
    if jsonb_typeof(option_value) is distinct from 'string' or length(option_value#>>'{}')>1000 or option_value#>>'{}'=any(values_seen) then raise exception 'Invalid or duplicate selected value';end if;
    values_seen:=array_append(values_seen,option_value#>>'{}');
   end loop;
  end if;
  if kind<>'element_visible' then row_result:=row_result||jsonb_build_object('expected',item->'expected');end if;
  result:=result||jsonb_build_array(row_result);
 end loop;
 if not required_found then raise exception 'At least one required check needed';end if;
 return result;
end $$;
revoke all on function public.normalize_dynamic_check_definitions(jsonb) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.save_dynamic_revision_without_form_checks(uuid,uuid,jsonb,uuid)') is null then alter function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) rename to save_dynamic_revision_without_form_checks;end if;
end $$;
revoke all on function public.save_dynamic_revision_without_form_checks(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_revision(p_project_id uuid,p_actor_id uuid,p_input jsonb,p_mission_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 return public.save_dynamic_revision_without_form_checks(p_project_id,p_actor_id,jsonb_set(p_input,'{checks}',public.normalize_dynamic_check_definitions(p_input->'checks')),p_mission_id);
end $$;
revoke all on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_revision(uuid,uuid,jsonb,uuid) to authenticated;
-- Replace the newly-created default engine metadata only. Idempotent historical replays remain unchanged.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_form_checker_version(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_form_checker_version;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_form_checker_version(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_form_checker_version;end if;
end $$;
revoke all on function public.start_dynamic_run_without_form_checker_version(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_form_checker_version(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_form_checker_version(p_project_id,p_actor_id,p_revision_id,p_key);
 if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,observer}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,checker}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_form_checker_version(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);
 if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,observer}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,checker}','2'::jsonb);
 update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
