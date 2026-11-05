-- Suggested requirement links (5 November 2026) use existing
-- requirement_mappings rows with coverage_status = 'suggested'. This checks the
-- exact statements the sidecar issues under member RLS: insert, conditional
-- confirm/reject that only touches suggestion rows, and non-member denial.
begin;
insert into auth.users (id, aud, role, email) values
  ('c0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'link-member@example.test'),
  ('c0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'link-outsider@example.test');
insert into public.projects (id, owner_id, name) values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Suggested links fixture');
insert into public.project_members (project_id, user_id, role) values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'member')
  on conflict do nothing;
insert into public.requirements (id, project_id, title) values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Pay once');
insert into public.artifacts (id, project_id, path, name) values ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'src/checkout.ts', 'checkout.ts');
insert into public.requirement_mappings (id, project_id, requirement_id, artifact_id, file_id, coverage_status, confidence) values
  ('c4000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'implemented', 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
do $$
declare
  p uuid := 'c1000000-0000-4000-8000-000000000001';
  r uuid := 'c2000000-0000-4000-8000-000000000001';
  a uuid := 'c3000000-0000-4000-8000-000000000001';
  changed integer;
begin
  -- Same columns as SupabaseStaticReviewRepository.saveRequirementLinkSuggestions.
  insert into public.requirement_mappings (id, project_id, requirement_id, artifact_id, file_id, symbol_id, coverage_status, confidence) values
    ('c4000000-0000-4000-8000-000000000001', p, r, a, a, 'POST /checkout', 'suggested', 0.8),
    ('c4000000-0000-4000-8000-000000000002', p, r, a, a, 'refund', 'suggested', 0.7);
  if (select count(*) from public.requirement_mappings where requirement_id = r and coverage_status = 'suggested') <> 2 then raise exception 'Member could not store suggestions'; end if;

  -- Same conditional update as SupabaseCentinelStore.decideRequirementMappingSuggestion.
  update public.requirement_mappings set coverage_status = 'unknown'
    where id = 'c4000000-0000-4000-8000-000000000001' and requirement_id = r and coverage_status = 'suggested';
  get diagnostics changed = row_count; if changed <> 1 then raise exception 'Confirm did not update the suggestion'; end if;
  update public.requirement_mappings set coverage_status = 'suggestion_rejected'
    where id = 'c4000000-0000-4000-8000-000000000002' and requirement_id = r and coverage_status = 'suggested';
  get diagnostics changed = row_count; if changed <> 1 then raise exception 'Reject did not update the suggestion'; end if;

  -- A stale decision cannot rewrite a decided or human-entered mapping.
  update public.requirement_mappings set coverage_status = 'suggestion_rejected'
    where id in ('c4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000009') and requirement_id = r and coverage_status = 'suggested';
  get diagnostics changed = row_count; if changed <> 0 then raise exception 'Conditional decision changed a non-suggestion row'; end if;
  if (select coverage_status from public.requirement_mappings where id = 'c4000000-0000-4000-8000-000000000009') <> 'implemented' then raise exception 'Manual mapping changed'; end if;
  raise notice 'PASS: member stores, confirms and rejects suggestions; non-suggestion rows are untouched';
end $$;

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
do $$
declare changed integer;
begin
  if exists (select 1 from public.requirement_mappings where project_id = 'c1000000-0000-4000-8000-000000000001') then raise exception 'Non-member can read mappings'; end if;
  update public.requirement_mappings set coverage_status = 'unknown' where id = 'c4000000-0000-4000-8000-000000000002';
  get diagnostics changed = row_count; if changed <> 0 then raise exception 'Non-member decided a suggestion'; end if;
  begin
    insert into public.requirement_mappings (project_id, requirement_id, artifact_id, file_id, coverage_status, confidence)
      values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', null, null, 'suggested', 0.5);
    raise exception 'Non-member inserted a suggestion';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: non-member cannot read, decide or insert suggestions';
end $$;
rollback;
