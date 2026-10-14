# Session and observation protection specification

M2d, 14 October 2026. Authority: DESIGN.md, revised PRD and development plan
P2.1/P2.3/P2.6. M2d1 delivers network-origin enforcement and observation protection;
M2d2 still requires account/session references, shared resource locks and profile
budgets. This record does not declare the entire phase complete.

## Required remaining behavior

- Shared profiles hold credential/session reference names only. Values and browser
  storage state stay encrypted per account/project/environment/device. Reference
  changes create a profile version; earlier Runs retain their sanitized snapshot.
- Preflight checks reference presence, allowed origins and expiry. Credentials use
  deterministic approved local bindings, never model-generated secret arguments.
- Explicit shared resource/data identifiers coordinate profiles that use the same
  target data. Frozen duration/output settings bound a Run. Dirty-data locks cannot
  disappear silently; source-matched configured cleanup remains separate from checks.
- Repeat a real authenticated RWA journey from an equivalent baseline twice. Verify
  missing/expired sessions, owner isolation, budget expiry and shared contention.
  Report/export privacy and account revocation remain later acceptance gates.

## M2d1 delivered transport

Every Run owns an ephemeral loopback network proxy. The browser uses that proxy
for loopback and remote traffic, including redirect hops, popup first requests,
frames, dedicated workers and WebSocket handshakes. HTTP destinations and HTTPS
CONNECT authorities must match the frozen exact allowed origins. CONNECT protocol
bytes distinguish TLS from plaintext WebSocket tunneling before an upstream socket
opens, preserving scheme restrictions. The proxy does not log/decrypt headers,
cookies, payloads or TLS content. HTTP/2, QUIC and non-proxied WebRTC UDP are disabled
for this browser; service workers remain disabled. The proxy is closed on all Run
exit paths. Missing/unauthorized origins remain explicit blocked/not-tested work.

Browser initialization traffic is denied as well. Application request/WebSocket
origins observed by Playwright distinguish an application policy violation from
background Chromium initialization attempts; background requests are never allowed.
An application violation aborts the Run. Direct model navigate actions independently
check the same origin list. Target transport failure remains an execution blocker,
not a finding about the website. Runtime plumbing accepts a 1–300 second limit;
shared profile controls are still pending.

Page-event/CDP interception was replaced because a real adversarial test showed
that a popup's initial HTTP request escaped before interception attached. The
transport now guards requests without depending on page-creation timing. Allowed
popups, workers and same-origin redirects retain normal behavior and URLs.

## M2d1 delivered privacy

The account-local environment vault supplies known sensitive values to the runner,
without adding them to shared metadata. Page context, provider and repair prompts,
debug events, console/action traces, summaries/status and independent check evidence
are sanitized before provider use or persistence. URL userinfo/query/fragments are
removed. Text redaction occurs before observation clipping so a truncated token
prefix cannot escape. Complete, JSON-escaped and URL-escaped known values are handled.

Both runner and independent checker screenshots mask password controls, declared
sensitive regions and known sensitive text/input values in frames. App values are
preserved. Visible canvas/video surfaces with known sensitive values fail closed;
missing visual coverage is a blocker. This protects declared/known surfaces rather
than claiming detection of arbitrary unknown secrets embedded in image pixels.
Raw browser tracing/video is not enabled. Reports must consume sanitized evidence;
shared evidence and exports remain their own later milestone.

## Verification

- Chromium tests prove foreign two-hop redirect, popup, iframe and worker requests
  receive no upstream traffic; allowed worker messages, popup content and redirects
  still work. HTTPS CONNECT rejection and WebSocket allowed/denied cases pass.
- Capture tests verify actual mask pixels, unchanged input/iframe state, opaque
  capture rejection and cancellation. Text/provider tests check retained JSON,
  Markdown, summaries and known-value boundaries before clipping.
- Real QA bearer → Codex → proxy → RWA signed-out form → independent checker:
  Run 66e4c830-eb4e-4fb9-8b1d-44f988361ec1 passed. The existing RWA database hash
  was unchanged; direct server commands bypassed its resetting prestart hook.
- Real Codex protected synthetic page Run 91c4c17b-1f1e-496e-aff6-1a1b98e7d508
  passed. Seven retained JSON/Markdown files contained no seeded value; the actual
  saved provider screenshot was visually inspected with text/input/password masked.
- Seeded popup escape Run c8800eb6-ed36-4bf6-a1b8-45198c5623c9 remained
  blocked/not-tested; the foreign fixture recorded zero requests. Cleanup records
  were separate and did not rewrite any functional verdict.
- Complete sidecar suite: 398 tests passed with two workers; sidecar TypeScript
  and git diff whitespace checks passed. No UI
  layout or database schema changes are included in M2d1. API live acceptance is
  deferred by the user's release decision; Codex is the required live backend.

Local retained record: sidecar/output/playwright/network-policy-live.json.
Static implementation and native desktop testing remain excluded.

## M2d2a delivered session workflow

Profiles optionally declare a bounded session reference and a uniquely visible
signed-in readiness selector. Save both to enable authentication. Cookie/localStorage
state is validated against approved origins, encrypted with the desktop key and
stored in mode-0600 files bound to account/project/environment/reference. Import is
restricted to the local loopback service; malformed input never exposes file
contents. Unsupported IndexedDB/partition-cookie formats are rejected. Session
lifetimes are 1 hour to 7 days in the UI, with a seven-day backend maximum. An
explicit Forget local session action removes only that account-scoped record; it
does not pretend to revoke the target server account. No real saved session was
deleted during acceptance.

Open sign-in browser → sign in manually → Save signed-in session closes the browser
before its durable lease completes. The plaintext state never enters cloud records
or model prompts. Every session write creates an opaque version; reference/version/
expiry are frozen into the Run snapshot. Local expiry and availability participate
in preflight, and a uniquely visible signed-in element is checked before model work.
Missing authentication becomes blocked rather than a website finding. Session
values also participate in shared-field and retained-observation redaction.

Capture owns a private nonce, ten-second heartbeat, five-minute deadline and
project-wide durable lease. Run/Hook/data preparation and profile edits cannot
bypass that lease; original implementations are private behind authenticated
wrappers. Cancellation holds the reservation until the browser stops. Successful
capture leaves data unprepared; cancellation/expiry leaves cleanup required.
Monotonic request-start timing prevents late heartbeat replies from extending
local freshness. The local five-minute capture deadline starts with lease acquisition.
Loss of heartbeat stops network forwarding before lease expiry, including existing
TLS/WebSocket streams. Browser restart never silently treats interrupted capture
as a clean baseline. Close abandoned sign-in windows before verifying cleanup.

The proxy now owns its HTTP connection pool and tracks reused sockets once;
closing one execution cannot destroy another proxy's pooled connection. This fixed
listener warnings observed in the first real capture. No listener limit was raised.

Migrations 202610140001 and 202610140002 were applied transactionally to Centinel
Supabase and registered without resetting or deleting existing data. Isolated SQL
checks prove reference-only snapshots, raw-state exclusion, capture/Run/Hook
exclusion, private nonce permissions, other-member fencing, stop acknowledgement,
expiry recovery and unverified data readiness. All earlier Dynamic SQL regression
checks passed against the extended schema.

## M2d2a actual acceptance, 14 October 2026

- Normal Centinel QA login and session controls opened an actual headed RWA browser.
  The fictional existing account was signed in through native UI; readiness was
  visually confirmed. Saving captured encrypted state and closed the browser.
- The first attempt correctly blocked an undeclared avatar origin. Only this QA
  environment was updated to the fixture's declared https://api.dicebear.com origin;
  the rejection and cleanup history were retained. No global policy was widened.
- Run b6e4065a-3680-4f27-a51d-c3891d3cbc7c and repeat
  ad7a26ea-7e5d-4947-82c9-b4492abbebc8 used the same session version and equivalent
  read-only data baseline, and passed actual Codex plus independent checks.
- Fourteen actual retained JSON/Markdown artifacts contained no session values.
  RWA's existing business-data SHA-256 was unchanged. No seed/reset command ran.
- Expired-reference Run a432420a-a7ad-46ca-ae55-10520314ea1e was blocked before any
  browser session existed; its saved preflight explicitly recorded session expiry.
- UI was verified at 1440×900, 1200×900 and 390×844, without horizontal overflow.
  Complete suites: 411 sidecar tests and 192 frontend tests, plus sidecar
  TypeScript and frontend production build. The existing Vite bundle-size warning remains.

Local records: output/playwright/session-ui-acceptance.json and
sidecar/output/playwright/session-repeat-acceptance.json. Shared resource keys,
frozen profile budgets and generic worker liveness remain M2d2b; shared evidence,
exports, revocation and packaged acceptance retain their later gates.
