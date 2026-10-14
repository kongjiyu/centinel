-- Bounded approved downloads and independent fingerprint checks; preserve history.
-- Explicit immutable upload fingerprints; existing profiles and history are unchanged.
-- Explicit repeat consent; preserve historical policies and Run snapshots.
-- New Runs freeze database-owned action grants and engine versions. Old histories remain unchanged.
create or replace function public.normalize_dynamic_action_policy(p_input jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare row_input jsonb;action_input jsonb;selectors text[]:='{}';upload_selectors text[]:='{}';uploads jsonb:='[]';downloads jsonb:='[]';download_selectors text[]:='{}';actions text[];selector_value text;rows jsonb:='[]';
begin
 if p_input is null then return '{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb;end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_input->'allowCoordinates') is distinct from 'boolean' or jsonb_typeof(p_input->'interactions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('schemaVersion','interactions','allowCoordinates','uploads','downloads')) then raise exception 'Invalid action permissions';end if;
 if jsonb_array_length(p_input->'interactions')>20 then raise exception 'Too many action grants';end if;
 for row_input in select value from jsonb_array_elements(p_input->'interactions') loop
  if jsonb_typeof(row_input) is distinct from 'object' or jsonb_typeof(row_input->'selector') is distinct from 'string' or jsonb_typeof(row_input->'actions') is distinct from 'array' or exists(select 1 from jsonb_object_keys(row_input) k where k not in ('selector','actions','repeatable')) then raise exception 'Invalid control grant';end if;
  selector_value:=btrim(row_input->>'selector');
  if length(selector_value) not between 1 and 500 or length(row_input->>'selector')>500 or selector_value=any(selectors) or jsonb_array_length(row_input->'actions') not between 1 and 4 then raise exception 'Invalid or duplicate control grant';end if;
  selectors:=array_append(selectors,selector_value);actions:='{}';
  for action_input in select value from jsonb_array_elements(row_input->'actions') loop
   if jsonb_typeof(action_input) is distinct from 'string' or action_input#>>'{}' not in ('click','type','select_option','set_checked') or action_input#>>'{}'=any(actions) then raise exception 'Unsupported or duplicate action';end if;
   actions:=array_append(actions,action_input#>>'{}');
  end loop;
  if row_input ? 'repeatable' and (jsonb_typeof(row_input->'repeatable') is distinct from 'boolean' or not ('click'=any(actions))) then raise exception 'Repeat consent requires an approved click action';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('selector',selector_value,'actions',to_jsonb(actions))||case when row_input ? 'repeatable' then jsonb_build_object('repeatable',row_input->'repeatable') else '{}'::jsonb end);
 end loop;
 if p_input ? 'uploads' then
  if jsonb_typeof(p_input->'uploads') is distinct from 'array' or jsonb_array_length(p_input->'uploads')>10 then raise exception 'Invalid upload permissions';end if;
  for row_input in select value from jsonb_array_elements(p_input->'uploads') loop
   if jsonb_typeof(row_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(row_input) k where k not in ('selector','id','sha256','bytes','mimeType')) or jsonb_typeof(row_input->'selector') is distinct from 'string' or jsonb_typeof(row_input->'id') is distinct from 'string' or jsonb_typeof(row_input->'sha256') is distinct from 'string' or jsonb_typeof(row_input->'bytes') is distinct from 'number' or jsonb_typeof(row_input->'mimeType') is distinct from 'string' then raise exception 'Invalid upload grant';end if;
   selector_value:=btrim(row_input->>'selector');
   if length(selector_value) not between 1 and 500 or length(row_input->>'selector')>500 or selector_value=any(upload_selectors) or row_input->>'id'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or row_input->>'sha256'!~'^[a-f0-9]{64}$' or (row_input->>'bytes')::numeric not between 1 and 1048576 or (row_input->>'bytes')::numeric<>trunc((row_input->>'bytes')::numeric) or length(row_input->>'mimeType')>100 or row_input->>'mimeType'!~'^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' then raise exception 'Invalid upload fingerprint';end if;
   upload_selectors:=array_append(upload_selectors,selector_value);uploads:=uploads||jsonb_build_array(row_input||jsonb_build_object('selector',selector_value));
  end loop;
 end if;
 if p_input ? 'downloads' then
  if jsonb_typeof(p_input->'downloads') is distinct from 'array' or jsonb_array_length(p_input->'downloads')>10 then raise exception 'Invalid download permissions';end if;
  for row_input in select value from jsonb_array_elements(p_input->'downloads') loop
   if jsonb_typeof(row_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(row_input) k where k not in ('selector','url','maxBytes','mimeType','publicTestData')) or jsonb_typeof(row_input->'selector') is distinct from 'string' or jsonb_typeof(row_input->'url') is distinct from 'string' or jsonb_typeof(row_input->'maxBytes') is distinct from 'number' or jsonb_typeof(row_input->'mimeType') is distinct from 'string' or row_input->'publicTestData' is distinct from 'true'::jsonb then raise exception 'Invalid download grant';end if;
   selector_value:=btrim(row_input->>'selector');
   if length(selector_value) not between 1 and 500 or length(row_input->>'selector')>500 or selector_value=any(download_selectors) or length(row_input->>'url')>2000 or row_input->>'url'!~'^https?://[^/@?#[:space:]]+/[^?#[:space:]]*$' or (row_input->>'maxBytes')::numeric not between 1 and 1048576 or (row_input->>'maxBytes')::numeric<>trunc((row_input->>'maxBytes')::numeric) or length(row_input->>'mimeType')>100 or row_input->>'mimeType'!~'^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' then raise exception 'Invalid bounded download permission';end if;
   download_selectors:=array_append(download_selectors,selector_value);downloads:=downloads||jsonb_build_array(row_input||jsonb_build_object('selector',selector_value));
  end loop;
 end if;
 return jsonb_build_object('schemaVersion',1,'interactions',rows,'allowCoordinates',p_input->'allowCoordinates')||case when p_input ? 'uploads' then jsonb_build_object('uploads',uploads) else '{}'::jsonb end||case when p_input ? 'downloads' then jsonb_build_object('downloads',downloads) else '{}'::jsonb end;
end $$;
revoke all on function public.normalize_dynamic_action_policy(jsonb) from public,anon,authenticated;
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
  if kind is null or kind not in ('url','visible_text','element_visible','field_value','field_checked','field_enabled','field_valid','selected_values','download_sha256') then raise exception 'Unsupported check kind';end if;
  -- Old direct RPC clients omitted descriptions; retain compatibility with an explicit generic label.
  if item ? 'description' and not coalesce(public.dynamic_context_text(item->'description',4000),false) then raise exception 'Invalid check description';end if;
  row_result:=jsonb_build_object('id',item->'id','criterionId',item->'criterionId','description',coalesce(item->'description','"Configured browser check"'::jsonb),'required',item->'required','kind',kind);
  if kind not in ('url','visible_text','download_sha256') then
   if not coalesce(public.dynamic_context_text(item->'selector',1000),false) then raise exception 'Bounded selector required';end if;
   row_result:=row_result||jsonb_build_object('selector',item->'selector');
  end if;
  if kind='download_sha256' then
   if jsonb_typeof(item->'url') is distinct from 'string' or length(item->>'url')>2000 or item->>'url'!~'^https?://[^/@?#[:space:]]+/[^?#[:space:]]*$' or jsonb_typeof(item->'expected') is distinct from 'string' or item->>'expected'!~'^[a-f0-9]{64}$' then raise exception 'Download check requires a public URL and SHA-256';end if;
   row_result:=row_result||jsonb_build_object('url',item->'url');
  elsif kind in ('url','visible_text') then
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
-- Record download capture and independent file-check protocols on fresh Runs.
do $$begin
 if to_regprocedure('public.start_dynamic_run_without_download_protocol(uuid,uuid,uuid,text)') is null then alter function public.start_dynamic_run(uuid,uuid,uuid,text) rename to start_dynamic_run_without_download_protocol;end if;
 if to_regprocedure('public.start_dynamic_environment_run_without_download_protocol(uuid,uuid,uuid,text,jsonb)') is null then alter function public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) rename to start_dynamic_environment_run_without_download_protocol;end if;
end $$;
revoke all on function public.start_dynamic_run_without_download_protocol(uuid,uuid,uuid,text),public.start_dynamic_environment_run_without_download_protocol(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.start_dynamic_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_run_without_download_protocol(p_project_id,p_actor_id,p_revision_id,p_key);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,files}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,checker}','3'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
create or replace function public.start_dynamic_environment_run(p_project_id uuid,p_actor_id uuid,p_revision_id uuid,p_key text,p_environment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.start_dynamic_environment_run_without_download_protocol(p_project_id,p_actor_id,p_revision_id,p_key,p_environment);if result->>'reused'='true' then return result;end if;
 result:=jsonb_set(result,'{run,executionVersions,files}','2'::jsonb);result:=jsonb_set(result,'{run,executionVersions,checker}','3'::jsonb);update public.dynamic_runs set payload=result->'run' where id=(result->'run'->>'id')::uuid and project_id=p_project_id;return result;
end $$;
revoke all on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) from public;
grant execute on function public.start_dynamic_run(uuid,uuid,uuid,text),public.start_dynamic_environment_run(uuid,uuid,uuid,text,jsonb) to authenticated;
create or replace function public.checkpoint_dynamic_exploration(p_project_id uuid,p_run_id uuid,p_worker_id text,p_token uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.dynamic_runs;l public.dynamic_run_leases;item jsonb;state_ids text[]:='{}';state_id text;control jsonb;control_refs text[];action jsonb;objective jsonb;check_ids jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 select * into r from public.dynamic_runs where id=p_run_id and project_id=p_project_id for update;
 if not found or r.state<>'running' then return false;end if;
 if r.payload->>'createdBy'<>auth.uid()::text then raise insufficient_privilege;end if;
 select * into l from public.dynamic_run_leases where run_id=p_run_id and project_id=p_project_id;
 if not found or p_token is null or p_worker_id is null or l.worker_id is distinct from p_worker_id or l.lease_token is distinct from p_token or l.expires_at<=clock_timestamp() then return false;end if;
 if r.payload->'revision'->>'mode' is distinct from 'exploratory' then raise exception 'Run is not exploratory';end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->'schemaVersion' is distinct from '1'::jsonb or p_snapshot->>'mode' is distinct from 'exploratory' or p_snapshot->'exhaustive' is distinct from 'false'::jsonb or octet_length(p_snapshot::text)>800000 then raise exception 'Invalid or oversized exploratory scope';end if;
 if exists(select 1 from jsonb_object_keys(p_snapshot) k where k not in ('schemaVersion','mode','objectives','states','actions','unvisitedControls','unresolvedControls','unresolvedTargetActions','limits','truncated','exhaustive','limitations')) then raise exception 'Unsupported scope field';end if;
 if jsonb_typeof(p_snapshot->'states') is distinct from 'array' or jsonb_typeof(p_snapshot->'actions') is distinct from 'array' or jsonb_typeof(p_snapshot->'objectives') is distinct from 'array' or jsonb_typeof(p_snapshot->'unvisitedControls') is distinct from 'array' or jsonb_typeof(p_snapshot->'unresolvedControls') is distinct from 'array' or jsonb_typeof(p_snapshot->'limitations') is distinct from 'array' then raise exception 'Scope arrays required';end if;
 if jsonb_array_length(p_snapshot->'states')>51 or jsonb_array_length(p_snapshot->'actions')>25 or jsonb_array_length(p_snapshot->'objectives')>20 or jsonb_array_length(p_snapshot->'unvisitedControls')>2040 or jsonb_array_length(p_snapshot->'unresolvedControls')>2040 or jsonb_array_length(p_snapshot->'limitations')>10 or p_snapshot->'limits' is distinct from '{"maxStates":51,"maxActions":25}'::jsonb or jsonb_typeof(p_snapshot->'truncated') is distinct from 'boolean' then raise exception 'Scope bounds exceeded';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'states') loop
  state_id:=item->>'id';if state_id is null or state_id!~'^[a-f0-9]{64}$' or state_id=any(state_ids) or not coalesce(public.dynamic_context_text(item->'url',2000),false) or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title')>500 or jsonb_typeof(item->'controls') is distinct from 'array' or jsonb_typeof(item->'visits') is distinct from 'number' or jsonb_typeof(item->'omittedControls') is distinct from 'boolean' then raise exception 'Invalid sampled state';end if;
  if (item->>'visits')::numeric<>trunc((item->>'visits')::numeric) or (item->>'visits')::numeric not between 1 and 100 or jsonb_array_length(item->'controls')>40 then raise exception 'State bounds exceeded';end if;
  state_ids:=array_append(state_ids,state_id);control_refs:='{}';
  for control in select value from jsonb_array_elements(item->'controls') loop
   if control->>'ref' is null or control->>'ref'!~'^e[0-9]{1,2}$' or control->>'ref'=any(control_refs) or not coalesce(public.dynamic_context_text(control->'role',1000),false) or jsonb_typeof(control->'name') is distinct from 'string' or length(control->>'name')>250 or control ? 'selector' and not coalesce(public.dynamic_context_text(control->'selector',2000),false) or exists(select 1 from jsonb_object_keys(control) k where k not in ('ref','role','name','selector')) then raise exception 'Invalid sampled control';end if;control_refs:=array_append(control_refs,control->>'ref');
  end loop;
  if exists(select 1 from jsonb_object_keys(item) k where k not in ('id','url','title','visits','omittedControls','controls')) then raise exception 'Unsupported state field';end if;
 end loop;
 for action in select value from jsonb_array_elements(p_snapshot->'actions') loop
  if not coalesce(action->>'beforeStateId'=any(state_ids),false) or action ? 'afterStateId' and not coalesce(action->>'afterStateId'=any(state_ids),false) or coalesce(action->>'status','') not in ('dispatched','skipped','blocked','unavailable','uncertain') or coalesce(action->>'action','') not in ('click','type','select_option','set_checked','upload_file','download_file','press_key','scroll','wait','navigate','assert_visible') or jsonb_typeof(action->'step') is distinct from 'number' then raise exception 'Invalid exploratory action';end if;
  if (action->>'step')::numeric<>trunc((action->>'step')::numeric) or (action->>'step')::numeric not between 0 and 24 then raise exception 'Invalid action step';end if;
  if action ? 'targetRef' and not exists(select 1 from jsonb_array_elements(p_snapshot->'states') s cross join lateral jsonb_array_elements(s->'controls') c where s->>'id'=action->>'beforeStateId' and c->>'ref'=action->>'targetRef') then raise exception 'Dangling target reference';end if;
  if exists(select 1 from jsonb_object_keys(action) k where k not in ('step','action','beforeStateId','afterStateId','targetRef','status')) then raise exception 'Unsupported action field';end if;
 end loop;
 for item in select value from jsonb_array_elements((p_snapshot->'unvisitedControls')||(p_snapshot->'unresolvedControls')) loop
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'states') s cross join lateral jsonb_array_elements(s->'controls') c where s->>'id'=item->>'stateId' and c->>'ref'=item->>'ref') or exists(select 1 from jsonb_object_keys(item) k where k not in ('stateId','ref')) then raise exception 'Dangling scope reference';end if;
 end loop;
 -- Objectives are selected from the frozen checks, never supplied by a planner.
 select coalesce(jsonb_agg(jsonb_build_object('criterionId',criterion,'checkIds',ids,'verdict','not_tested')),'[]') into check_ids from (select c->>'criterionId' criterion,jsonb_agg(c->'id') ids from jsonb_array_elements(r.payload->'revision'->'checks') c group by c->>'criterionId') grouped;
 for objective in select value from jsonb_array_elements(p_snapshot->'objectives') loop
  if exists(select 1 from jsonb_object_keys(objective) k where k not in ('criterionId','checkIds','verdict')) or jsonb_typeof(objective->'checkIds') is distinct from 'array' then raise exception 'Invalid selected objective';end if;
  if objective->>'verdict' is distinct from 'not_tested' or not exists(select 1 from jsonb_array_elements(check_ids) selected where selected->>'criterionId'=objective->>'criterionId' and jsonb_array_length(selected->'checkIds')=jsonb_array_length(objective->'checkIds') and (selected->'checkIds') @> (objective->'checkIds') and (objective->'checkIds') @> (selected->'checkIds')) then raise exception 'Unverified or invented objective';end if;
 end loop;
 if (select count(distinct o->>'criterionId') from jsonb_array_elements(p_snapshot->'objectives') o)<>jsonb_array_length(p_snapshot->'objectives') then raise exception 'Duplicate selected objective';end if;
 if jsonb_array_length(p_snapshot->'objectives')<>jsonb_array_length(check_ids) then raise exception 'Incomplete selected objectives';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'limitations') loop if not coalesce(public.dynamic_context_text(item,2000),false) then raise exception 'Invalid scope limitation';end if;end loop;
 if jsonb_typeof(p_snapshot->'unresolvedTargetActions') is distinct from 'number' or ((p_snapshot->>'unresolvedTargetActions')::numeric not between 0 and 25 or (p_snapshot->>'unresolvedTargetActions')::numeric<>trunc((p_snapshot->>'unresolvedTargetActions')::numeric)) then raise exception 'Invalid unresolved count';end if;
 update public.dynamic_runs set payload=jsonb_set(r.payload,'{exploration}',p_snapshot) where id=p_run_id and project_id=p_project_id;return true;
end $$;
revoke all on function public.checkpoint_dynamic_exploration(uuid,uuid,text,uuid,jsonb) from public;
grant execute on function public.checkpoint_dynamic_exploration(uuid,uuid,text,uuid,jsonb) to authenticated;



do $$begin
 if to_regprocedure('public.save_dynamic_environment_without_download_origins(uuid,jsonb,uuid)') is null then alter function public.save_dynamic_environment(uuid,jsonb,uuid) rename to save_dynamic_environment_without_download_origins;end if;
end $$;
revoke all on function public.save_dynamic_environment_without_download_origins(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function public.save_dynamic_environment(p_project_id uuid,p_input jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare policy jsonb;item jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 policy:=public.normalize_dynamic_action_policy(p_input->'actionPolicy');
 for item in select value from jsonb_array_elements(coalesce(policy->'downloads','[]')) loop
  if not coalesce((p_input->'allowedOrigins') ? substring(item->>'url' from '^(https?://[^/]+)'),false) then raise exception 'Download origin must already be approved';end if;
 end loop;
 return public.save_dynamic_environment_without_download_origins(p_project_id,p_input,p_id);
end $$;
revoke all on function public.save_dynamic_environment(uuid,jsonb,uuid) from public;
grant execute on function public.save_dynamic_environment(uuid,jsonb,uuid) to authenticated;
-- Compare-and-set only the upload permissions, preserving concurrent profile fields.
create or replace function public.save_dynamic_upload_permissions(p_project_id uuid,p_profile_id uuid,p_version integer,p_uploads jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_profile jsonb;policy jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into current_profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 if not found then raise no_data_found;end if;
 if p_version is null or (current_profile->>'version')::integer<>p_version then raise exception 'Environment version changed';end if;
 policy:=coalesce(current_profile->'actionPolicy','{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb)||jsonb_build_object('uploads',p_uploads);
 policy:=public.normalize_dynamic_action_policy(policy);
 return public.save_dynamic_environment(p_project_id,current_profile||jsonb_build_object('actionPolicy',policy),p_profile_id);
end $$;
revoke all on function public.save_dynamic_upload_permissions(uuid,uuid,integer,jsonb) from public;
grant execute on function public.save_dynamic_upload_permissions(uuid,uuid,integer,jsonb) to authenticated;
-- Compare-and-set only the download permissions, preserving concurrent profile fields.
create or replace function public.save_dynamic_download_permissions(p_project_id uuid,p_profile_id uuid,p_version integer,p_downloads jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_profile jsonb;policy jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
 select payload into current_profile from public.dynamic_environments where id=p_profile_id and project_id=p_project_id for update;
 if not found then raise no_data_found;end if;
 if p_version is null or (current_profile->>'version')::integer<>p_version then raise exception 'Environment version changed';end if;
 policy:=coalesce(current_profile->'actionPolicy','{"schemaVersion":1,"interactions":[],"allowCoordinates":false}'::jsonb)||jsonb_build_object('downloads',p_downloads);
 policy:=public.normalize_dynamic_action_policy(policy);
 return public.save_dynamic_environment(p_project_id,current_profile||jsonb_build_object('actionPolicy',policy),p_profile_id);
end $$;
revoke all on function public.save_dynamic_download_permissions(uuid,uuid,integer,jsonb) from public;
grant execute on function public.save_dynamic_download_permissions(uuid,uuid,integer,jsonb) to authenticated;
