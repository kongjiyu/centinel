Scoring review — 2026-10-23

Final verdict: the V7 wrapper resolves both identified scoring gaps. No remaining actionable scoring findings in the reviewed scope. The live workflow is still in progress; this is not whole-workflow acceptance. No production or frozen-gold changes were made for this task.

Resolved (original P2): canonical occurrence identity was not enforced.
- PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs:101 caps occurrenceIds per match row, then line 104 unions arbitrary IDs across every row. V7 score.mjs delegates directly to this calculation.
- Two valid duplicate predictions of the Axios timeout issue may each receive one finding-specific occurrence label. Both rows satisfy the one-occurrence per-row cap, but score as two occurrences although the immutable Axios oracle has one. This is an ordinary deduplication error, not dependent on a malicious adjudicator. Repeating one occurrence can promote actual 5/7 recall to reported 6/7 and cross the acceptance threshold.
- Minimal fix in the V7 wrapper: normalize/require occurrence IDs to identify original affected source paths, validate each against the frozen issue affectedFiles, and count their union per issue. At minimum reject a per-issue union above goldOccurrenceCount; canonical identity additionally prevents duplicate inflation within the Three.js three-occurrence allowance. Add a duplicate-prediction regression and unknown-occurrence regression without changing frozen gold or original scorer.

Verified strengths and limits:
- Fixed five cases are built from frozen manifest; issue/occurrence recall denominators remain 5/7. Selected JS/TS denominator derives from the immutable input manifest (169 selected files). Missing cases cannot establish eligibility.
- V7 derives all 35 Readiness assertions by exact frozen instance/ID; rejects unknown and duplicate IDs; missing/unknown/false rows fail agreement. Policies are checked per case against Review v7 and Readiness .2.
- Unadjudicated predictions become unknown and block acceptance; empty claims have undefined precision. Precision merges stable claim keys and rejects conflicting duplicate verdicts.
- Retained citations are checked against original files. Axios independent record contains seven exact expected assertion IDs; 52 original hashes/lengths and all 197 retained references were independently checked in readiness adjudication. Raw/effective categories are recorded separately. No full 16-criterion accuracy claim is supported.
- Resolved: validateGoldMatches now requires canonical occurrence-1 for single-occurrence issues, exact frozen affected-file paths for multi-occurrence issues, and a true model claim matching both findingId and claimKey. Canonical IDs are unioned by the unchanged base scorer, so duplicate predictions cannot inflate occurrence recall. Missing, unregistered or duplicate occurrence IDs and unsupported split claims are rejected before scoring.
- Current run has no completed Review finding report yet, so no actual false acceptance or bundled-claim disagreement is alleged.

Final checks: node --test on V7 score.test.mjs and original score.test.mjs passed 11/11 (7 wrapper + 4 original). New tests cover duplicate predictions, unregistered occurrence paths and exact split-claim support. Comparing the actual Axios result against the base evidenceValidity collector found 197 references through recursive enumeration and the same 197 through category.criteria.references plus findings.references, with zero omissions. These are the retained references previously checked against source bytes; rejected raw citations appear only as diagnostics and are not asserted retained citations. Review was read-only except this note; no live/network/model calls or upstream source execution.

