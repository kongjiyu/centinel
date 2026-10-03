# Supabase setup

Centinel keeps the sidecar as the execution host, while Supabase provides the
authenticated durable store and private report/evidence storage.

1. Create a Supabase project and enable Email, Google, and GitHub providers
   under **Authentication → Providers**. Configure Google and GitHub sign-in
   with their own OAuth clients; they are separate from the Google Drive and
   GitHub repository-access clients used by the sidecar integrations.
2. Apply **every** script in [`supabase/migrations`](../supabase/migrations) in filename order, from
   `202609140001_initial.sql` through
   `202609250001_storage_deletion_jobs.sql`. Use the Supabase CLI or run
   each complete file in the SQL editor; applying only the initial schema will
   leave Review, report, indexing, and RLS functions unavailable. The final
   frozen-chunk search function runs as the authenticated caller and is restricted to the
   Review's frozen artifact versions. The final migration adds a private
   cleanup manifest for project and artifact deletion; apply it before using
   those actions in the updated desktop app.
3. Copy `.env.example` to `.env` at the repository root and fill in
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, and
   `VITE_SUPABASE_ANON_KEY`. Use your project's publishable key for the public
   key values. The `VITE_*` values are public credentials;
   never put a service-role key in a `VITE_*` variable.
4. Generate a private `CENTINEL_TOKEN_ENCRYPTION_KEY` for provider OAuth tokens.
   It is used only by the sidecar and must not be committed.
5. Register these OAuth callback URLs with the providers you enable:
   - `http://localhost:37701/integrations/github/callback`
   - `http://localhost:37701/integrations/google_drive/callback`
   - `http://localhost:37701/integrations/slack/callback`
6. For packaged desktop sign-in, register `centinel://auth/callback` in
   Supabase Auth redirect URLs and set `VITE_SUPABASE_AUTH_REDIRECT_URL` to the
   same value. GitHub and Google sign-in provider callbacks are configured in
   Supabase Auth; the three `localhost:37701` URLs above are for separate
   repository/Drive/Slack access, not for signing in.

When Supabase variables are present, the renderer signs in through Supabase
Auth and attaches the access token to sidecar requests. Active project, source,
Review, settings, usage, report, and integration routes use that user's RLS
client; report downloads use short-lived signed URLs. The service-role key is
for explicit migration/admin tooling only, never the desktop runtime. The
remaining live-service acceptance checks are tracked in the Phase 3 audit.

If Settings reports `PGRST205` for `public.model_configurations`, the app is
reaching Supabase but the Phase 1 schema is absent from that project's REST
schema. In the Supabase dashboard for the project named by the repository-root
`.env` URL, run `202609210001_phase1_static_foundation.sql` and every later
migration in filename order (or apply them with the Supabase CLI). Verify that
`public.model_configurations`, `public.project_standards`, and
`public.model_usage_records` appear in **Database → Tables**. If they already
exist, refresh PostgREST's schema cache in the SQL editor with
`notify pgrst, 'reload schema';` and reopen Settings. Do not put a service-role
key in the desktop `.env` to work around a missing table.
