-- Auto test runs several browser tests at once, each on its own environment
-- (12 November 2026, approved by the user). The original one-active-run-per-project
-- limit existed so two Runs could not use the same test data at once; each
-- environment's data lock (dynamic_environment_data state ready -> in_use) already
-- guarantees that per environment. Runs without an environment keep sharing one
-- slot per project, so manual tests behave exactly as before.
drop index if exists public.dynamic_one_active_run_per_project;
create unique index if not exists dynamic_one_active_run_per_environment
  on public.dynamic_runs(project_id, (coalesce(payload->'environment'->>'id', '')))
  where state in ('queued','running');
