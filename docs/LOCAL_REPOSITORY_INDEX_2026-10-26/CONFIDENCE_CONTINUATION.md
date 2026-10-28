# Evidence confidence and independent-batch continuation

## User decision and policy

The user explicitly selected “Continue; flag uncertain evidence.” Prepared Review policy `review-2026-10-27-confidence-continuation-v18` supersedes the earlier fail-fast behavior for invalid local evidence and exhausted validation repairs. Historical Review outputs and evaluation gold remain unchanged.

Each finding reference receives at most three candidates copied from the actual frozen packet supplied to the model. High is 90–100, Medium is 60–89, and Low is below 60. These are deterministic match-strength scores, not calibrated probabilities that a finding is true. The primary supplied location with exact text scores 100; a unique relocated exact quote in the same source identity scores 95. Ambiguous relocated quotes or exact quotes under conflicting supplied identities score 80. Approximate windows score at most 85 and never qualify as exact evidence proof. Empty/unmatched citations produce no manufactured excerpt. Candidate scanning and retained lists are bounded independently of the request ceiling.

The finding detail highlights the best candidate for each reference and reveals the alternatives through keyboard-operable native disclosures. Exact duplicated recorded references appear once. Historical records without metadata keep their original presentation and receive no invented scores. Source previews continue to read the Review-owned frozen version and reject a mismatched version. Source-match verification never substitutes for causal support.

## Execution and acceptance

1. A weak citation is retained with `needs_verification`. It bypasses causal assertion as a verified claim, and cannot establish absence proof.
2. An invalid independent packet or exhausted repair budget records a safe batch failure, then allows later feature packets and independent source sweeps to execute. Cancellation, capacity failures, transport/persistence failures and context admission gates retain their existing stop behavior.
3. Invalid local evidence still ends with `failed`/`partial` after independent batches finish, retaining observations and explicit verification flags. It does not become an approval-ready clean Review.
4. A validated external caller/runtime limitation may coexist with a technically completed local assessment, as before. The uncertain observation is retained and displayed; affected artifacts stay excluded from absence proof. Contradicted claims remain excluded rather than being promoted into findings.
5. Attempt ceilings still apply per stable batch operation. Continuing all independent packets can consume more total tokens than stopping at the first invalid packet. The optimization/quality evaluation must measure this increased coverage honestly.

No raw rejected model text or source excerpts are written into audit metadata. Persisted finding evidence comes from frozen candidate windows; original model descriptions remain generated observations. The model's initial four-domain coverage, canonical identities, semantic-support checks, independent sweeps, and resolution eligibility are not replaced by match scoring.

Occurrence fingerprints are recomputed after candidate relocation. Uncertain observations cannot suppress independently verified observations or deterministic rules during deduplication, even when a model labels its own confidence High. Shared finding groups can still present their occurrences under one issue type.

## Verification evidence and limits

The offline 52-file fixture injects an uncertain citation into the first request. Every selected source is subsequently present in recorded AI packet identities and every private-marker region reaches an independent source sweep. No assessment-validation completion or resolution correlation is issued. A companion capacity case stops at the first request with no later sweeps.

The initial 125-test core run passes across candidate matching, packet orchestration, acceptance validation, orchestrator, support repairs, batch planning and sync-route tests. Independent Sol review initially passed 17 backend and 9 frontend tests. Follow-up review found that the repository's fingerprint idempotency lookup could still overwrite proven observations; the fix separates verifier and uncertainty-state identities, preserves stable correlation fingerprints, paginates lookup results and rejects ambiguous duplicates. The actual repository regression passes with a one-row server cap and both insertion orders. Final independent follow-up cleared that fix and the later route deadline/disconnect and exact-duplicate presentation changes. Browser fixture checks passed at 1440×900, 1200×900 and 390×844, including Enter-to-expand/collapse and no horizontal overflow at 390px. These are fixture checks, not provider semantic acceptance or a production finding-quality score.

Saved screenshots: `evidence/repository-index-evaluation-2026-10-26/offline-v18-2026-10-27/`. A new live Review and blinded adjudication against unchanged gold remain required before claiming precision, recall, complete usage, quality preservation or token savings.

The primary quality evaluation must include retained uncertain observations as predictions for adjudication; do not silently remove them to improve precision. A verified-only breakdown may be supplementary and must report the excluded uncertain count. A failed/partial execution never qualifies as a complete benchmark, regardless of the number of source packets reached.
