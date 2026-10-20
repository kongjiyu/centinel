# Connection, project import, and Review reliability test inventory

All cases initially **unrun**. Use deterministic fake clocks, delayed promises, scoped mock Supabase HTTP, and provider fixtures; never include real credentials in evidence. Record each exact command/result after execution. Existing unrelated baseline failures are separate from regressions.

| Module | Case | Kind | Prerequisites and steps/inputs | Expected result | Actual/evidence |
| --- | --- | --- | --- | --- | --- |
| Auth | T-AUTH-01 | Negative | Signed-user validation succeeds, data API returns JWT issued at future | Bounded recovery or explicit clock/session error, no fake disconnect | Unrun |
| Auth | T-AUTH-02 | Edge | Persistent/large skew or invalid signature/auth | Stops within budget; no auth/RLS bypass | Unrun |
| Connections | T-AUTH-03 | Negative | Connected GitHub/Drive then temporary status request failure | Last-known state marked unavailable; no destructive disconnect | Unrun |
| Auth | T-AUTH-04 | Regression | Bearer rotation, user switch, spoofed identity headers | Canonical owner stays authoritative; no stale-user result | Unrun |
| Loading | T-LOAD-01 | Positive | Projects resolve, provider settings promise held open | Project workspace renders without waiting for settings | Unrun |
| Loading | T-LOAD-02 | Edge | One summary delayed/rejected among several | Rows/progress available; completed summaries enrich independently | Unrun |
| Artifacts | T-LOAD-03 | Performance | 272 artifacts with version rows | Bounded bulk version queries rather than one query per artifact | Unrun |
| Artifacts | T-LOAD-04 | Security/edge | Pagination > server row cap; mixed project/version rows | Every authorized artifact has latest correct version; no cross-project leak | Unrun |
| Sources | T-SRC-01 | Positive | Hold GitHub network/import promise while creating project | 201 returned after durable project/source/queued run | Unrun |
| Sources | T-SRC-02 | Edge | Repository needs multiple partial runs/pages | Automatic continuation to terminal success; no missing reconciliation | Unrun |
| Sources | T-SRC-03 | Negative | Transient failure vs rejected credentials | Bounded retries, persisted failure, user recovery action | Unrun |
| Sources | T-SRC-04 | Concurrency | Two requests and worker restart/token rotation | One active source job; recover under current authorized bearer | Unrun |
| Sources | T-SRC-05 | Regression | Existing synchronous source sync/history | Compatible response/data contract; no lost artifacts | Unrun |
| Review DB | T-REV-01 | Negative repro | Create root Review against NOT NULL iteration seam | Insert has empty JSON object; succeeds | Unrun |
| Review DB | T-REV-02 | Positive | Create child Review with iteration metadata | Metadata retained exactly | Unrun |
| Review DB | T-REV-03 | Regression | Duplicate idempotency/CAS transition | No duplicate Review or stale transition | Unrun |
| Retry | T-RETRY-01 | Edge | Always transient non-AI failure | Exactly 3 total calls and increasing waits | Unrun |
| Retry | T-RETRY-02 | Edge | Always transient AI/repair/fallback failure | Exactly 5 total paid calls shared across providers | Unrun |
| Retry | T-RETRY-03 | Negative | 401/403/schema/bad configuration | No blind retries; useful terminal error | Unrun |
| Retry | T-RETRY-04 | Edge | Cancel during wait or late response | Immediate cancellation, no next call/success | Unrun |
| Retry | T-RETRY-05 | Edge | Recovery has persisted paid attempts; nested seams | Original cap retained; no multiplication | Unrun |
| Retry | T-RETRY-06 | Security | Ambiguous write failure and provider error containing secrets | Idempotent outcome, safe persisted metadata only | Unrun |
| UI | T-UI-01 | Positive | Create GitHub project | Modal explains background work, Source destination available | Unrun |
| UI | T-UI-02 | States | Queued/running/retrying/complete/failure source fixtures | Real counts/history/retry; no fake percentages | Unrun |
| UI | T-UI-03 | Accessibility | Keyboard/focus/live-region checks | Controls named/reachable, updates announced without moving focus | Unrun |
| UI | T-UI-04 | Visual | 1440×900, 1200×900, narrow viewport, 200% zoom/reduced motion | No clipping/overflow/lost action; shared tokens | Unrun |
| UI | T-UI-05 | Positive | Review retries while live Activity/Playground polling | Service, attempt, limit, wait appear before next call | Unrun |
| UI | T-UI-06 | Security | Trace/error fixtures with sensitive content | No credential/prompt/source-body/private-reasoning leak | Unrun |
| Delivery | T-VERIFY-01 | Build | Frontend build and sidecar tsc | Pass | Unrun |
| Delivery | T-VERIFY-02 | Regression | Relevant frontend/sidecar/dev-launcher suites | Pass; baseline exceptions separately identified | Unrun |
| Delivery | T-VERIFY-03 | Review | Agent-led security review | No blocking findings; remediations re-tested | Unrun |
| Delivery | T-VERIFY-04 | Review | Agent-led usability/accessibility review | No blocking findings; remediations re-tested | Unrun |

## Commands, results and evidence

Pending implementation. Intended commands: `pnpm --filter centinel test`, `pnpm --filter @centinel/sidecar test`, `pnpm --filter centinel build`, `pnpm --filter @centinel/sidecar exec tsc --noEmit`, `pnpm test:dev`, targeted browser verification using fixtures without production writes.

## Review findings and closeout counts

Security review: pending. Usability review: pending. Per-module and total passed/failed/blocked/skipped/unrun counts will be calculated from executed evidence; initial inventory 32 required cases, all unrun. No feature accepted yet.
