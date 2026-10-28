# Requirement-driven Review workflow assessment

Date: 22 October 2026. User expectation: trace payment requirements to related documents/code even when implementation is defective; assess business, technical, personnel and security behavior using that context; also inspect security concerns outside authored requirements across the declared system boundary.

## Direct answer

A defective payment handler can and should be linked to its payment requirement. Relevance and implementation correctness are different propositions. The correct result can be **Linked / implementation fails**. A mapping must not disappear because the code violates the rule, nor should a mapping alone certify that the rule is satisfied.

The current system can save a link to buggy code, but has no demonstrated automatic semantic mapper in the active Review path. Existing links are manually supplied and frozen before model execution. The model receives confirmed requirement text and the selected source content, so it may find the duplicate-payment defect, but the workflow does not guarantee a per-requirement assessment or whole-system security coverage.

## Existing stages, verified in source

| Stage | Existing behavior | Boundary |
| --- | --- | --- |
| Before Review: requirements | RequirementsScreen explicitly extracts candidates from a selected artifact; a person confirms a candidate. The confirmed row retains its source locator/version. Requirements may also be entered manually. | Candidate extraction/confirmation establishes requirement authority and origin, not a code relationship. |
| Before Review: mapping | RequirementsScreen.handleMap calls the mapping API with file ID, coverage status and confidence. POST `/projects/:id/requirements/:id/mappings` persists supplied values. | No production call site automatically discovers requirement/code mappings. The UI writer does not save target version/hash proof. |
| Freezing sources | Orchestrator selects artifacts, captures versions/content, loads confirmed requirements/rules, then calls `captureTraceabilitySnapshot`. Snapshot reads existing mapping rows and validates target identity, scope and available version/hash proof. | This captures existing relations; it does not discover new ones or execute payment behavior. Unavailable/stale mapping proof stays Incomplete. |
| Evidence gate | Snapshot states contribute to the evidence-sufficiency gate; scope, missing inputs and contradictions are checked before model analysis. | An unmapped requirement is a coverage issue, not proof of a runtime failure. |
| Context and deterministic checks | Selected frozen sources are indexed/retrieved and deterministic rules run. | Retrieval is a ranking aid. The prompt also includes readable frozen artifact content; it is not limited to mapped files. |
| Model analysis | Bounded JS/TS feature/path map is derived; one structured model operation receives confirmed requirements, standards, objective, excerpts and frozen source content. All four domain outcomes are requested for each recognized feature. | The frozen mapping graph is not passed explicitly to the model. Domain rows are per inferred feature, not per requirement/acceptance criterion. |
| Validation and persistence | Shape, domain coverage and exact source evidence are validated; requirement/standard IDs are checked if supplied; findings and frozen traceability are persisted. | Source/ID validity does not prove the model correctly understood business behavior. The pre-analysis mapping snapshot is not replaced by model-proved requirement verdicts. |

Supporting source locations:

- `centinel/src/screens/RequirementsScreen.tsx:97` — manual mapping; `:107` onward — extraction/confirmation handlers.
- `sidecar/src/index.ts:1470` — mapping writer; `sidecar/src/store/supabase.ts:287` — persisted mapping fields.
- `sidecar/src/review/orchestrator.ts:530` — source selection; `:579` — grounding; `:589` — snapshot; `:628` — indexing; `:658` — feature map; `:660` — model request; `:750` — grounding/evidence validation.
- `sidecar/src/review/supabaseRepository.ts:686` — mapping reader; `:697` — version proof; `:731` — Complete derived from verified mapping/coverage labels.
- `sidecar/src/review/orchestrator.ts:1134` — full readable frozen content; `:1148` — requirement summaries; `:1168` — shared domain instruction. There is no argument carrying frozen mapping records into `buildModelRequest`.
- `sidecar/src/review/featurePathAnalysis.ts:58` — supported formats and bounds; `:320` — cross-function/runtime/dependency limitations. Map bounds: 30 recognized features and 12 paths per feature; `coverage.exhaustive` is always false.

## Findings against the requested workflow

| ID | Priority | Finding and observable implication | Required mitigation |
| --- | --- | --- | --- |
| RW-01 | P1 | No automatic, evidenced requirement → implementation discovery stage. A payment requirement can remain unmapped despite relevant code existing. Current writer also omits mapping-version proof needed by the snapshot reader, so a newly saved link can remain unavailable for verified traceability. | Add proposed links with exact artifact/version/hash/symbol/range provenance, confidence and rationale; validate references; confirm ambiguous matches; freeze them before domain checks. A wrong implementation must still be discoverable as related. |
| RW-02 | P1 | Domain analysis receives requirements and content, but not the explicit frozen relationship graph; output does not require one result for every scoped criterion. The model can omit a payment invariant while returning all four feature-domain rows. | Pass requirement IDs, acceptance criteria, related code/design/test evidence and versioned relationships explicitly. Require per-criterion addressed/not-addressed/violated/unverified results and verify every scoped criterion has an outcome. |
| RW-03 | P1 | Traceability Complete is derived before semantic analysis from existing coverage labels plus version validity. It does not establish payment behavior correctness and is not reconciled with semantic findings as a separate implementation verdict. | Separate relation/provenance, coverage and conformance states. Keep a valid link while showing a failed business/technical check. Preserve old persisted/report contracts until a versioned change is specified. |
| RW-04 | P1 | Security is broader than requirement matching in the prompt, but remains bounded by imported/selected artifacts and provisional JS/TS features. Omitted sources, unsupported languages, dependency internals, middleware/deployment and distributed retry paths cannot become whole-system assurance. | Declare an explicit security review boundary; inventory entry points, trust boundaries, sensitive stores and dependencies independently of requirement links. Traverse relevant cross-file flows or mark them unresolved. Report omitted/unavailable scope and context limits; require runtime probes where static evidence cannot settle behavior. |
| RW-05 | P2 | Requirement origin is retained and selected documents reach the model, but there is no first-class, validated relationship graph connecting a criterion to related design/operational documents, tests, implementation and domain outcomes. | Introduce typed versioned evidence edges (defines, designs, implements, tests, constrains) and applicability/authority distinctions. Supporting documents provide context; unconfirmed prose must not silently override confirmed rules. |

These findings concern source-established capability gaps. No real payment project was assessed, and no duplicate-payment bug was demonstrated in production data.

## Recommended workflow contract

1. **Establish authority and scope:** extract/confirm requirements and measurable criteria; identify authoritative versus supporting documents. Declare feature scope and a separate security boundary covering all available in-scope system sources, including sources with no requirement link. Readiness determines whether evidence is assessable; it does not certify implementation.
2. **Discover and freeze relationships:** identify candidate code, symbols, routes, jobs, database constraints, design sections, tests and failure/recovery paths. Validate each cited version/location and preserve unresolved/ambiguous links. Freeze the evidence graph and selected scope for this Review.
3. **Run complementary checks:** all domains consume the same frozen context. Business checks confirmed rules and invariants; Technical checks implementation mechanisms/state/concurrency/errors; Personnel checks user decisions, feedback and recoverability. Security checks applicable requirements plus independent abuse/trust-boundary concerns within its declared system scope. No domain depends solely on another domain's inferred answer.
4. **Validate outcomes and coverage:** require a result for every scoped criterion and every planned security surface. Verify exact source references and linked IDs. Distinguish a supported defect, an inferred risk requiring verification, and missing/unreadable evidence. Static analysis cannot claim runtime proof it does not have.
5. **Publish traceability plus findings:** show Linked/Unmapped/Ambiguous/Stale independently from Meets/Violates/Unverified/Not assessed. Present one canonical defect with its primary cause and additional domain impacts; preserve immutable evidence and separate human approval.

## Payment acceptance example for future implementation/evaluation

Assumed confirmed rule `PAY-01`: “Repeated attempts for the same logical payment, including retries and duplicate callbacks, must not create a second successful charge or ledger transaction.” This is an illustrative explicit rule, not an assertion about requirements already stored in Centinel.

Expected evidence graph: PAY-01 → payment design/idempotency policy → payment route/service → transaction insert/unique constraint → callback/retry handler → relevant tests. A source link establishes relevance even if its code performs an unguarded second insert.

| Dimension | Expected result for a demonstrably duplicate-producing implementation |
| --- | --- |
| Link | Linked to PAY-01 with validated version/location |
| Business | Violates the single-payment invariant, citing PAY-01 and actual failing path |
| Technical | Identify the demonstrated non-atomic check/insert, missing enforced uniqueness, or retry-state defect; inspect existing safeguards before attributing cause |
| Personnel | Assess whether repeated user actions or misleading pending/success feedback contribute; do not claim disabling a button proves server-side duplicate prevention |
| Security | Assess replay/unauthorized payment manipulation when an attacker-controlled path is demonstrated; continue checking unrelated authorization/injection/credential/disclosure surfaces inside the declared scope |
| Verification | Test sequential retries, concurrent duplicate requests, duplicate/out-of-order callbacks, and failure after provider acceptance but before local commit. Use an isolated fake gateway/ledger; perform no real payment. Verify one intended charge/transaction and consistent recovery state. |

If the requirement says only “make payment,” the exact retry/cardinality rule needs clarification. A concrete data-integrity or abuse defect may still be reported with its independent evidence, without inventing a confirmed business requirement.

## Verification and remaining limits

Read-only source tracing and **100 tests / 5 files passed**: Supabase Review repository, Static Review orchestrator, grounding, assessment validation and feature/path analysis. The repository test explicitly demonstrates Complete mapping state from verified mapping/version metadata before any semantic model result. These tests establish current contracts, not payment-model detection accuracy.

No application code, provider setting, project mapping, finding decision or AI hold changed during this assessment. No live model calls or payments occurred. This is the workflow assessment and recommended target contract; RW-01 through RW-05 are not implemented by this document.
