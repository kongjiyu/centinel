# Explicit source-index resume across saved identities

CargoChain's native-app supported-text Review (`f405dc7b` prefix) froze 285 selected text sources, excluding the two original binary PDFs. Document checks completed, but indexing stopped with `assessment_paused`. A manual Source Resume affected the current full-project index identity while leaving the narrower saved Review identity paused. This was an execution/control-state failure, not an AI quality verdict.

## Mitigation

Only explicit Source Resume reads a snapshot of the requesting owner's paused jobs for the project. The read completes before clearing the expected owner hold. Each captured revision is conditionally changed to queued; concurrent revisions, owner transfers and live leases are preserved. Old identities are not scheduled by Resume: a subsequent explicit saved-source Review must select them. Current-source preparation retains its existing scheduling behavior.

Ordinary queueing and status recovery continue to preserve paused state. An earlier cleared hold cannot authorize a later pause, including after a failed capacity-hold write. Snapshot read/validation failures stop before hold clearing. New capacity holds remain checked before paid work and publication.

## Verification

- Local targeted run: 43 tests passed across source-index coordinator/store, repository-index sync routes and local repository index; sidecar TypeScript passed. Machine-readable evidence: `evidence/cargochain-2026-10-28/index-resume-tests.json`.
- Independent read-only GPT-6.1 Sol review found no actionable findings in the revised design, with 46 tests passing in its scoped run. An offline store pagination probe returned 1,001 unique paused jobs across two requests.
- Regression coverage includes different current/saved fingerprints, old cleared holds after hold-persistence failure, snapshot read failure, concurrent live lease changes, and owner/project/state validation.
- Desktop/provider verification is separate from these offline checks and must be recorded against the actual subsequent Review. No offline test establishes semantic assessment acceptance.

## Live continuation

After backend restart, explicit Source Prepare search/Resume succeeded in the authenticated native Centinel window. A normal saved-source retry created Review `4bd96441` (display prefix). It read all 285 selected text files and advanced past the earlier immediate `assessment_paused` failure into local indexing. The app recorded 19,115 provider-reported embedding tokens across five calls at the observed checkpoint. This verifies release of the saved identity, not final index publication or semantic quality. Originals and Solidity coverage remain excluded/unverified as described in the Drive import report.

During live observation, a separate Readiness display defect was found: every two-second poll incremented the response sequence even while an earlier GET was pending. Repeated requests taking over two seconds could all be discarded. The card now admits one status GET per component lifecycle, preserves POST invalidation and permits a new project to load without waiting for the previous project's request. Fifteen component tests and the frontend build passed; independent read-only review found no blockers. No layout/CSS changed. The live card still reported queued work after this fix; no final Readiness verdict follows from correcting polling.
