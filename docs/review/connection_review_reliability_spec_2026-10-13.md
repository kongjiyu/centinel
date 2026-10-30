# Connection, project import, and Review reliability spec

## Request and delivery scope

The user authorized correction of future-issued Supabase JWT failures, slow project loading/creation, background GitHub imports traceable in Project Source, the Review iteration NOT NULL failure, and visible bounded retries for external Review operations. Classification: feature delivery protocol; integration, persistence, auth, performance, accessibility impact. Preserve the existing uncommitted Review Playground/harness and development launcher work.

Requirements elicitation used grill-me/grilling: retry counting is the only unresolved product detail. Recommended working interpretation: **3 total non-AI attempts; 5 total AI attempts**, including the first call. User clarification remains welcome. Existing maximum-three AI contracts are superseded for this change. The implementation is authorized by the user's direct change request; external publication, clock changes, live schema changes, and destructive actions are outside this delivery.

## Design and integration

### F1 — Authentication and truthful connection state

Keep Supabase signature/user validation and exact bearer-scoped RLS. `JWT issued at future` means a time-validation rejection, not proof that the GitHub/Drive authorization was revoked. Detect and classify that specific error; allow a bounded transient recovery if appropriate, then show an actionable clock/session error. Do not disable JWT validation, edit claims, silently use an admin key, log tokens, or automatically change the Windows clock. Preserve known connection data on temporary status errors and label unavailable/stale states honestly. All external operations remain bounded; permanent authentication/permission/configuration failures need an explicit recovery action.

### F2 — Responsive project directory

Project rows render as soon as metadata is available. Optional Model Provider configuration and activity/source summaries do not block the whole workspace. Summary enrichment is progressive and bounded; unresolved values are labelled loading/unavailable rather than invented No activity/Setup required. Remove the artifact-version N+1 query path through a bulk project-scoped version lookup with pagination. Preserve frozen-version/content-hash behavior and project RLS. Measure query counts/controlled delayed promises in scripted cases; report actual live timing only if measured.

### F3 — Background repository import

POST /projects persists the project, GitHub source, and queued work record before returning 201. GitHub tree/blob retrieval occurs after that response. Reuse `project_sources` and durable connected-source sync runs, rather than a second local database. Continue all partial pages automatically, deduplicate concurrent jobs for the same source, and preserve failure/partial history. Refresh bearer clients from authenticated requests without persisting Supabase refresh tokens or using service-role credentials. On restart, recover persisted queued/interrupted work when a valid authenticated session is available; do not claim a stale worker is still active. Existing synchronous import/sync APIs remain compatible unless the source UI is updated together.

### F4 — Source progress and creation accessibility

After GitHub project creation, open the project's Source destination where feasible. Explain before submission that repository import runs in the background. Source shows actual queued/importing/retrying/complete/failed state, processed file counts, last update, history, and a usable retry/reconnect action. Poll only while work is active; stop on terminal state/unmount and avoid overlapping polls. Use semantic status text, `aria-live="polite"`, keyboard-accessible controls, visible focus, shared neutral-first DESIGN.md tokens, and responsive layout at 1440×900, 1200×900, and narrow width. Completion/failure announcements do not steal focus. Never show a fabricated percentage.

### F5 — Review creation schema compatibility

New root Reviews write the schema's non-null empty JSON representation for optional iteration metadata; derived Reviews preserve their real iteration object. Verify against the actual migration NOT NULL/default contract in the repository test seam, not a mock that accepts invalid nulls. Preserve idempotency, scope/lineage, decisions, and existing harness instrumentation. No schema reset or live migration is required for a payload correction.

### F6 — Classified retry policy

Non-AI external operations involved in Review (Supabase tables/Storage, source-provider operations, and token refresh where applicable): at most 3 total eligible attempts, increasing waits nominally 1s and 3s. AI operations (analysis, grounding, indexing/embeddings as applicable): at most 5 total requests per operation shared across primary/fallback/repair and persisted recovery offsets, nominal waits 1s, 3s, 7s, 15s. Respect bounded Retry-After and cancellation. Retry transient network/timeouts/429/eligible 5xx, never repeat a permanent schema/permission/configuration failure blindly. Safe retries require idempotent/upsert/compare-and-set behavior; do not replay ambiguous non-idempotent writes or compound paid calls. Prevent nested retry multiplication. Persist each paid attempt once.

### F7 — Observable retry activity

Before waiting, record retry attempt, limit, safe operation/service label, delay/next attempt time and outcome through the existing Review progress/audit/harness contract. Source jobs expose equivalent progress/history. Review Activity and Playground display clear status such as “Model service retry 2 of 5 in 3 seconds”; distinguish automatic operation retries from the manual Retry review action. No source bodies, prompts, provider response bodies, tokens, or private reasoning enter progress metadata. Cancellation wakes retry waits immediately.

## Rationale and dependencies

Reuse React 18, current CSS/shared primitives, Supabase/PostgREST bearer clients, existing connected-source run tables and Review harness. A worker coordinator and narrow retry seam are justified by durable continuation, cancellation, and testability. Avoid adding a queue provider or database when current persisted run state is sufficient. Background work lasts while the sidecar is running; authentication is required for recovery. Provider-enforced Google Testing expiry remains an external configuration rule.

## Verification and reviews

See synchronized plan/tests documents for stable feature/criterion/case IDs. Require meaningful failing repros for payload, response-blocking, status, retry and query-count behavior, focused and regression tests, frontend build, sidecar TypeScript, and viewport evidence. Agent-led security and usability reviews cover auth/RLS, retry idempotency and budgets, secret redaction, cancellation, lifecycle clarity, keyboard/focus/live regions, nesting, responsiveness. No required check is delegated to the user; unavailable live credentials or UI tooling remain explicitly pending and prevent full acceptance unless equivalent evidence is agreed.
