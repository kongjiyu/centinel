-- Account-level provider tests have no project. Keep them private to their
-- owner while project Review usage remains visible to project members.
drop policy if exists model_usage_records_member on public.model_usage_records;
create policy model_usage_records_member on public.model_usage_records
  for all to authenticated
  using (
    auth.uid() is not null and (
      (project_id is not null and public.is_project_member(project_id)) or
      (project_id is null and owner_id = auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      (project_id is not null and public.is_project_member(project_id)) or
      (project_id is null and owner_id = auth.uid())
    )
  );
