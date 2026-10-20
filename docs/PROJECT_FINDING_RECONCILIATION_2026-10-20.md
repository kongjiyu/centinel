# Review completion and the project findings list

Every new Static Review compares its results with earlier findings in the same project. The user confirmed that this applies to independent reviews as well as explicitly linked follow-ups. Human approval remains a separate final decision.

## Workflow

1. Complete the review against its selected, versioned sources.
2. Validate source references and form the candidate findings.
3. Remove confidently redundant candidates within that review, including repeated deterministic detections. Different sources, categories or rules are not merged just because their excerpts overlap.
4. Compare the resulting findings with the project's existing issues. Match the latest known occurrence of an issue while retaining its original project finding ID. Use stable IDs/fingerprints with source and rule context; constrained similarity matching keeps uncertain candidates separate. Identical older fingerprint/title/evidence/location occurrences can be consolidated when the issue is reproduced.
5. Re-check unmatched old issues using their own earlier review/source basis. Resolve only when the new review succeeded with comparable scope, configuration, model policy, feedback and readable source coverage, and the relevant source version changed. Otherwise carry the issue over for further verification. A plausible uncertain recurrence prevents resolution.
6. Present the final project list: new issues, existing issues with latest evidence, review-derived resolutions and issues still needing verification. A previously resolved issue that reappears opens under the same original identity.
7. Summarize the recorded comparison outcomes and ask for the human review decision. Approving a review does not resolve its findings.

The project list has one entry per confidently linked issue. Per-review observations and earlier evidence remain immutable history, rather than being deleted or overwritten. Actions from the project list target the original finding ID; details show its latest occurrence and link to earlier reviews. Later explicit human decisions take precedence. Previously accepted or dismissed decisions are preserved for recurring issues; a regression or a reproduced fixed issue can reopen in the derived current view while the saved earlier decision remains in history. Automatic absence-based resolution does not overwrite fixed, dismissed or accepted decisions.

An issue carried over through an intervening review remains eligible for a later adequate check; comparing only with the most recent review would lose that issue. The comparison therefore considers the project's history and stores each finding's actual baseline review, even when one completion snapshot contains several baselines. No schema migration is needed: the existing correlation tables already support this representation.

## Verification meaning and limits

Review-derived Resolved means **not reproduced in a successful comparable review after the affected source changed**. It does not assert an independently executed regression test or exhaustive security proof. Missing, removed, unreadable, differently scoped or unchanged-source evidence cannot establish this resolution. Failed, cancelled, paused and partial review execution cannot close old issues. A history-loading failure prevents final review completion rather than silently skipping this step.

Older explicit iteration records remain readable even when they are not trustworthy automatic-resolution baselines. Unlinked legacy findings without a usable successful execution/source basis remain visible. Ambiguous matches are retained, not silently combined. If project-list lineage evidence cannot be loaded, the existing safe fallback returns stored rows without derived resolution; those rows can temporarily include unconsolidated occurrences.

Source identities now preserve repository path punctuation and case. Older resolution metadata that used a lossy path hash can fail the stronger validation and remain unverified until a new review supplies current evidence. No saved finding decision is rewritten during that validation.

Document/readiness issues represented only as supplemental immutable snapshots retain their own existing lifecycle; this persisted Static Review reconciliation does not manufacture finding database IDs or mutate those snapshots. A bounded JS/TS feature/branch map and four-domain request are now implemented locally; whole-program control/data-flow and real-model acceptance remain pending. Current project risk and exports now share the Findings reconciliation projection; immutable per-review exports retain the saved occurrences.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Every project review | An independent review performs comparison without changing its explicit iteration lineage | Passed orchestrator and pure workflow fixtures | Live model execution remains paused |
| Reuse existing issue | Original ID survives repeated reviews while details use latest evidence and history remains available | Passed reconciliation, presentation and component tests | Ambiguous or unavailable legacy evidence remains separate |
| Remove redundancy | Duplicate candidates are removed; identical historical occurrences consolidate when reproduced; distinct source/rule issues remain distinct | Passed normalization, matching and project fixtures | Similar wording alone is not identity proof |
| Resolve old issues | Comparable changed-source success can derive resolution, including findings carried through intervening reviews | Passed positive and negative workflow fixtures | Static non-reproduction is not runtime regression verification |
| Prevent unsafe resolution | Uncertain matches, partial model work, unreadable or unchanged sources, different scope/configuration and missing metadata cannot resolve issues | Passed regression tests | No live public finding disposition was changed |
| Reappearance/decisions | Reappearing resolved issue keeps its original ID; later human decisions and saved history remain intact | Passed project and presentation fixtures | Historical accepted/dismissed dispositions are not silently replaced for an unchanged recurring issue |
| Persistence and reporting | Multiple baseline reviews survive snapshot round-trip; failure to inspect history does not report completion; Summary/Activity use recorded counts | Passed repository, orchestrator and narrative fixtures | Database integration uses mocked Supabase in this check |

Verification: **166 backend tests passed in 11 files**, including correlation, project registry, reconciliation/presentation, candidate normalization, actual orchestrator with synthetic providers, Supabase repository fixtures, iteration/routes, harness, grounding and provider pause. **345 frontend tests passed in all 59 files**; the focused Findings, Project Detail and narrative set passed **49 tests in 3 files**. Frontend production build, sidecar TypeScript and whitespace checks passed. The build retains the existing large-bundle warning. The earlier 18 Windows Dynamic failures remain outside this scoped acceptance.

All new provider responses in these tests are synthetic; no additional AI requests were made after the earlier `rate_limited` pause. Native/live-account acceptance is still pending. No live finding was dismissed, fixed or approved, and these local changes have not been published.
