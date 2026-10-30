# Dynamic Codex release evaluation protocol

Frozen before new release-corpus runs on 15 October 2026. Scope follows the user’s
Dynamic-only authorization and Codex-only live acceptance decision. Static ingestion
and real Static integration, API live acceptance, native applications-under-test,
unit-test generation and heatmaps are excluded. Packaged Centinel launch/export is
required. API provider contracts remain tested and live API acceptance stays deferred.

## Fixed inputs

- Candidate engine base: main `44916ff991439a6f824a1347798e3578c9ce88e6` (PR #36).
  Evaluation/packaging fixes must be recorded as explicit later commits; rerun
  affected gates when behavior changes.
- RWA source: `9dfcb9869533ce8a8963c556facc0d80457f9d39`. Browser execution uses
  the independent `rwa-dynamic-release-20261014` workspace; unit execution uses the
  marked independent `rwa-unit-release-20261015` archive. Preserve the primary
  `cypress-realworld-app` database and capture each tested baseline before use.
- Bounded public web fixture: checked-in `usabilityTarget.ts`, fixture identity
  `centinel-usability-v1`; inspect /meta and record source hash/mode before each run.
- Existing QA executor UUID `1905e7a0-2891-477c-a1cf-524856b34383` and Reader UUID
  `c213df04-49da-41d4-ab0b-dd818fe55260`, QA project
  `6a1f51f5-96da-43f5-b693-462e57e23cd3`. Nonmember/new-project fixtures are
  separately labeled. QA decisions are acceptance simulations, not stakeholder approval.
- Live provider: existing QA Codex OAuth binding, selected model `gpt-5.6-sol`.
  Record actual executable/app-server versions and available ledger rows; missing
  tokens/cost remain unknown. No model or threshold changes after scoring starts.
- Incoming source denominator is an explicit immutable mock-static fixture. Record
  its snapshot ID, supplied criteria, source versions and every excluded criterion.

## Corpus and thresholds chosen before scoring

Use three independent Runs per fixed public normal and fixed defect journey
(N=3 each), with saved revision/explicit checks and label/keyboard/focus rules.
Normal ground truth: Ready visible, labeled/reachable enabled controls. Defect
ground truth: Ready visible; the original name input lacks a configured name and
has tabindex=-1. These are two explicit failed rule observations, not proof of
all possible usability defects. No broad recall or real-user-study claim is allowed.

Required thresholds for this bounded corpus:

- Functional required-check outcome correct in 3/3 normal and 3/3 defect Runs.
  A usability defect must not change the independent Ready criterion verdict.
- The two planted rule failures reproduced in 3/3 defect Runs; no failed label/
  keyboard observation on the normal page in 3/3 Runs. Uncertain focus remains
  uncertain and does not become a confirmed defect.
- All attempted Runs, including blocked/cancelled ones, appear in the evaluation
  table. No silent retries or replacement of failed samples. If a sample fails a
  threshold, preserve it, investigate and label a new evaluation cohort explicitly.
- 100% of sampled observations/finding candidates have matching recorded proof IDs
  and SHA-256; a second member retrieves fully synced proof. Candidate review stays
  separate; precision is only scored against this declared ground truth after
  explicit QA review. Unreviewed candidates cannot count as confirmed precision.
- Report task completion, criterion coverage, failure counts, verdict agreement,
  evidence completeness, elapsed time, action/model-call counts and actual available
  token usage for every sample. No latency/cost target or broader recall is inferred.
- Repeat the mock context → saved Mission → real browser checks → explicit QA
  finding review → versioned report chain on a pinned, labeled sample. Record the
  manual/scripted baseline and differences from an AI-driven run.

## Required release gates beyond the repeated corpus

Map PRD acceptance 3–14 individually; 1–2 are outside scope and 4 uses mock context.
Scenario 12’s real API part is deferred by direct user decision, not represented as
passed. Combine existing reproducible acceptance with fresh verification where
current behavior, versions or unverified scope require it:

- New shared-project identity; known normal/seeded defect versus provider outage/
  unreachable target; exploration/untested scope; pinned fix/retest/finding history.
- Active cancellation, worker/process interruption and restart reconciliation;
  duplicate starts; manual/configured preparation, collision and failed cleanup.
- Usability evidence versus subjective advice; passing/failing/error unit results.
- Real member/nonmember/revoked and expired/refreshed access for records/evidence;
  offline upload recovery, immutable retries and seeded-secret inspection across
  prompts/logs/reports and project/file endpoints.
- Packaged Tauri client on the documented macOS/architecture: launch, sign-in,
  live Codex configuration/executable discovery, shared history/proof and a native
  user-selected report export with verified bytes. Browser preview is insufficient.
- Demo script, setup/recovery guide, evaluation tables, known limitations and a
  requirement-by-requirement completion audit. No whole-product/Static release claim.

Raw local evidence remains ignored. Publish only sanitized IDs, versions, measured
outcomes and links in repository release documentation. No service-role key enters
the runtime; no primary data reset or unrelated service termination is permitted.
