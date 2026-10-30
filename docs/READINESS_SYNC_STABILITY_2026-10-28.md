# Readiness evidence identity during source checks

## Problem and scope

Readiness's source fingerprint included sync progress (`syncStatus`, queued/running outcome and related run diagnostics) alongside evidence versions. An unchanged remote-head check could therefore replace an active assessment request. A completed model result could also be discarded solely because source revalidation coincided with an import check. This is a deterministic execution risk reproduced offline, not a semantic verdict about CargoChain or proof that every historical failure had this cause. Earlier CargoChain provider-capacity failures retain their own recorded cause.

## Mitigation

Fingerprint source access state, remote revision, exact item availability/version identities and terminal availability causes. Exclude transient healthy sync progress. Import activity still gates new assessment and final persistence. When an unchanged check is active after model execution, retain the result in memory and await source settlement under the existing job deadline. If evidence already changed, use the existing queue/defer behavior immediately. Revalidate latest job and fingerprint before saving; reacquire refreshed same-owner credentials after the wait. No provider retry/fallback or capacity-hold behavior is relaxed.

The frontend separately admits one status GET per component lifecycle. Two-second polling and focus events cannot repeatedly invalidate a slower response. Project switches and POST invalidation retain their stale-response guards.

## Verification and deployment state

- Five sidecar suites passed, 46 tests: runtime identity, coordinator, concurrency, HTTP and trigger integration. Final sidecar TypeScript passed after the wait refinement.
- Regressions cover unchanged sync transitions, terminal failure identity, real source changes, active-import publication guards, deadline expiry and bearer refresh during settlement.
- Fifteen frontend component tests and production frontend build passed. No layout/CSS changed.
- Independent read-only GPT-6.1 Sol review found no remaining blockers after the credential-refresh and changed-import refinements; it independently reran the five suites with 46 passing tests.
- The frontend polling fix is loaded by development HMR. The backend stability fix is prepared on disk; it must not be reported as live-verified until the running paid workflow reaches a safe boundary and the sidecar is restarted. Current live Review `4bd96441` continues indexing; Readiness was observed queued. Do not restart simply to discard those active calls or claim semantic acceptance from offline checks.
