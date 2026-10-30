# Codex Model Provider and Shared Runtime Foundation

Status: authenticated text/image inference and one live Web smoke Mission accepted on 13 October 2026. Wider journeys, API mode and release gates remain pending.

Centinel can use a locally installed Codex app-server as an alternative to an
API-key text/image provider. Review and Dynamic Testing share the same model
transport and resolve model settings from the authenticated user's Supabase
configuration. Existing API providers remain supported.

## Setup and acceptance

1. Install [Codex CLI](https://developers.openai.com/codex/cli) on the device
   running Centinel. The initial transport was checked with CLI **0.144.4**.
2. Ensure `codex` is on the sidecar's PATH. If a desktop launch cannot find it,
   set `CENTINEL_CODEX_BIN` to the executable's absolute path in repository-root
   `.env`, then restart Centinel. Never place this in a `VITE_*` variable.
3. Sign into Centinel and open **Settings → Model Provider → Codex with ChatGPT**.
4. Choose **Connect Codex** and finish ChatGPT sign-in in the browser. Keep
   Centinel running while the local app-server handles the callback. The panel
   polls while sign-in is pending; it can also refresh or cancel sign-in.
5. Select a model from the CLI's model catalog. Run **Test text**. For Dynamic,
   also run **Test screenshot**; the latter asks the model to identify the color
   of an attached image and checks the answer.
6. Choose **Use for Review** and/or **Use for Dynamic**. These save independent
   `static_review` and `vision` configurations. Saving the API provider form
   switches Review back to the specified API provider.
7. Run a small Review and a non-destructive Dynamic journey against a test app.
   Confirm structured output, screenshots, cancellation and usage reporting.

Local managed-browser sign-in remains a separate acceptance path. On 13 October,
the explicitly authorized desktop OAuth path passed real text/image tests and
one Web smoke Mission using a real Centinel QA bearer. This does not accept
Static Review, API-backed journeys, all failure/recovery paths or packaging.

## Credential and execution boundaries

- The sidecar launches `codex app-server` over stdio using the documented
  [app-server protocol](https://developers.openai.com/codex/app-server).
- Every verified Centinel account gets a private `data/codex/<user-hash>/`
  directory and separate `CODEX_HOME`. The CLI stores credentials locally in
  that directory; credentials are not uploaded to Supabase or sent to the UI.
- Default operation does not read existing `~/.codex` credentials. An optional,
  explicitly authorized owner binding can read only its desktop access token
  through experimental `chatgptAuthTokens`; see below. Desktop config, tools,
  history and refresh tokens are not copied. Parent API-key environment
  variables are excluded from the child process.
- **Disconnect Codex** logs out only this Centinel-local integration. It retains
  saved model selections, so a later run requires reconnecting. It does not log
  out the user's separate Codex desktop/CLI session or delete project data.
- Connections do not roam across devices. Credentials are protected by private
  directory permissions, not by the Centinel API-key encryption vault.
- Requests use ephemeral threads in an isolated workspace, read-only sandboxing,
  no shell tools, no local-image tool, no web search, and no approval host.
  Screenshots are passed as explicit `localImage` inputs. Server requests for
  tool execution/approval are rejected. Playwright remains the browser driver.
- Model calls are serialized per account. Cancellation closes the account's
  active app-server process; a later request starts a new connection. Requests
  time out after two minutes; idle processes stop after ten minutes. Up to 32
  local account adapters are retained until sidecar restart.
- Upstream error bodies, diagnostic streams and model commentary are not exposed
  as user-facing errors. Structured final answers and actual reported usage are
  consumed by the calling workflow.

## Shared functionality delivered

| Foundation | Review | Dynamic Testing |
| --- | --- | --- |
| Authenticated model settings | Text configuration, including existing API fallback | Screenshot configuration plus optional text configuration for repair |
| Text/image transport | Existing JSON analysis contracts | Screenshot action planning through the same adapter |
| Codex connection | Account-scoped local ChatGPT connection | Same connection; screenshot capability required |
| Cancellation/error contract | Existing Review cancellation reaches transport | Cancellation aborts model calls/retry waits and closes the browser |
| Usage | Existing Supabase ledger | New authenticated runs write the same ledger with Dynamic session metadata |
| Project access | Existing shared-project membership | Membership checked before local sessions/evidence/cancellation |

New Mission/Run metadata and immutable revisions use bearer-scoped Supabase,
while legacy sessions and screenshot files remain local. See
[the current foundation record](../dynamic/DYNAMIC_MISSION_RUN_FOUNDATION.md).

No estimated ChatGPT dollar price is invented. Usage accounting is best effort;
absent provider usage stays absent. Dynamic session/evidence records remain local
SQLite for now. A new shared project gets an additive local Dynamic workspace
pointer; existing local sessions and project workspaces are preserved. This is
not cross-device Dynamic run synchronization.

Runtime/provider failures, cancellation and exhausted limits do not create
application-defect findings. A model-reported failed goal creates one finding.
Action schemas reject unknown, incomplete or unbounded actions before execution.
The existing model-declared success/failure semantics remain provisional: this
slice does not yet add independent success criteria or a human finding review.

## Limits and follow-up work

- Embeddings still require an API provider; Codex is not an embedding backend.
- Codex is a primary provider only. The existing Review orchestration can use an
  explicitly configured API fallback; Dynamic does not yet execute fallback
  chains. The panel saves Codex with fallback disabled.
- Account rate/usage limits and model availability are enforced by Codex. The
  model catalog is refreshed from the CLI; no model identifier is hardcoded.
- Packaged installations still need an installed CLI and accessible executable
  path. This change does not bundle or auto-install Codex.
- Environment variables/test accounts/fixtures, Static context snapshots,
  mission/run separation, independent verdict verification, reproducible
  regression suites and collaborative Dynamic results remain subsequent PRD
  work. Native desktop application testing remains a future extension.

## Validation

Automated coverage includes app-server framing and initialization, isolated
credentials, early completion events, login/logout, screenshot capability,
timeouts, cancellation/reconnection, safe errors, authenticated HTTP routes,
settings validation, shared Dynamic model calls, honest blocked/cancelled
outcomes, finding deduplication and Settings interactions.

UI acceptance uses the actual Settings components and styles at 1440×900,
1200×900 and a narrow viewport with mocked connection/model responses. It is
layout validation, separate from real ChatGPT authentication/inference.

Verified on 2026-10-07:

- `pnpm --filter @centinel/sidecar exec vitest run`: **325 tests passed**.
- `pnpm --filter @centinel/sidecar exec tsc --noEmit`: passed.
- `pnpm --filter centinel exec vitest run --maxWorkers=2`: **172 tests passed**.
  The initial unrestricted run overlapped other checks and hit timeouts; the
  bounded-concurrency run passed without increasing assertion timeouts.
- Settings/Codex targeted tests after the final copy change: **25 passed**.
- `pnpm --filter centinel build`: passed, with the existing bundle-size warning.
- Codex CLI 0.144.4: real initialization and account/read succeeded using an
  empty, isolated temporary home; reported available and not connected.
- Settings layout inspected at 1440×900, 1200×900 and 390×844. Screenshot-test
  feedback was exercised with a mocked provider response.

## Explicit reuse of desktop OAuth

This is an opt-in local integration using the documented experimental
[external ChatGPT token mode](https://learn.chatgpt.com/docs/app-server).
Configure both server-only variables:

- `CENTINEL_CODEX_LOCAL_AUTH_FILE`: absolute path to the explicitly authorized
  desktop Codex `auth.json`.
- `CENTINEL_CODEX_LOCAL_AUTH_OWNER_ID`: one canonical Centinel Auth UUID.

The backend still receives a verified Centinel identity from AuthGateway.
Only that UUID gets a token source; every other user keeps isolated sign-in.
The source validates ChatGPT mode and pins the account ID for that adapter.
Changed desktop accounts require reconfiguration/restart. It sends only the
access token/account ID to app-server and reads updated tokens when requested;
the desktop app remains responsible for refresh. Expired desktop login produces
an actionable failure, without exchanging refresh tokens in Centinel.

The isolated child retains no desktop config/tools/history. Disconnecting this
external integration closes only its child and disables reuse for that adapter's
lifetime; it does not call desktop logout. Removing the two config values and
restarting disables this opt-in persistently. This route is CLI-version-specific
and does not promise portability of desktop credentials or a public OAuth SDK.

Live acceptance: CLI 0.144.4 with an explicitly bound QA user, model
`gpt-5.6-sol`, real text/schema and known-color screenshot checks passed.
A real authenticated sign-in-page smoke Mission then completed with two passed
independent checks and retained local evidence. Usage was available; no dollar
cost estimate was invented. No tokens or admin key were persisted to Supabase.
