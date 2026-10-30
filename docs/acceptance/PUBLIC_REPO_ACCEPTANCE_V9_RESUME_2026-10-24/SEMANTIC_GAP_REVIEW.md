# Semantic gap review — bounded source claims

Review date: 25 October 2026. Read-only adversarial review of the production sources that produced Axios Review `4cf606de-7bc7-482d-aee2-8df0f3cbdb97`, policy `review-2026-10-24-batch-domain-coverage-v9`. No implementation is included or accepted by this report. The active baseline runtime must remain unchanged until its remaining cases finish or encounter an execution stop.

## Decision

**Act on the distinction between a valid citation and a supported consequence.** The minimum useful mitigation is a small, bounded candidate-support gate between exact-source validation and finding promotion. It should require a public trigger, selected guard/caller evidence where necessary, an explicit claim boundary, and a supported/contradicted/insufficient disposition. A short evidence challenge can supply that disposition; schema checks alone cannot establish its truth. Preserve the existing exact-citation validator, conservative coverage rules, attempt ledger and failure retention.

Do not expand the syntax map into a whole-program analyzer or add a multi-provider architecture. Any verification request in the authorized scope must use the user's current configured provider/model: the new Axios harness records `provider=codex`, `model=gpt-5.6-sol`. No production model switch is authorized or proposed. Do not claim that adding instructions, response fields, or a second model pass fixes semantics. Accept a mitigation only after generic adversarial fixtures and a separately recorded, completed real evaluation demonstrate its behavior. Keep this report and registered gold outside production inputs.

The completed Axios case provides direct evidence of the gap: all **656/656** Review finding/domain references are valid, all **48/48** selected JS/TS files have inspection evidence, and **588/588** domain pairs are disclosed, yet one unique model claim is concretely false, five unique claims remain Unknown, and the registered behavioral issue is missed. This is not five-project acceptance. See [new adjudication](review-axios-adjudication.json) and [verification](review-axios-verification.json).

## Act on

### 1. Exact evidence currently promotes a causal claim without checking its stated guard or consequence

**Disposition: Act on. Severity: high for quality acceptance.**

Production evidence:

- [`assessmentValidation.ts:179`](../../../sidecar/src/review/assessmentValidation.ts#L179) explicitly says anchoring validates provenance, not the semantic conclusion. Lines 185–211 validate file identity, version, range and excerpt, then return the finding. [`assessmentValidation.ts:167`](../../../sidecar/src/review/assessmentValidation.ts#L167) checks causal steps only for bounded string shape and private-reasoning labels.
- [`orchestrator.ts:749`](../../../sidecar/src/review/orchestrator.ts#L749) normalizes candidates and validates quotations; lines 754–756 immediately add source-valid candidates to `lastSafePartial`. Lines 842–847 later add the same source-valid findings to model results. There is no intervening semantic acceptance decision.
- [`featurePathAnalysis.ts:1542`](../../../sidecar/src/review/featurePathAnalysis.ts#L1542) checks exact membership in known reference objects; lines 1575–1582 accept an assessed summary with those references and compute completion. It does not evaluate the summary's proposed input through the referenced condition.
- [`orchestrator.ts:1305`](../../../sidecar/src/review/orchestrator.ts#L1305) already asks for entry, condition, consequence and safeguards. The observed failure therefore survives existing causal instructions; repeating them alone has no demonstrated effect.

Concrete counter-evidence from the new adjudication: the alleged dangerous-key mutation in `toFlatObject` cannot take its proposed assignment under the stated ordinary-object conditions because the preceding membership guard reads a truthy inherited property and rejects that key. The same code has a different supported omission behavior. The false claim's quote is exact. This is a local guard contradiction, not a missing source citation or missing whole-program graph.

Minimum change to evaluate after the baseline:

1. Add a bounded, transient support record for each atomic candidate consequence, indexed by a trusted candidate index/ID: `claimBoundary` (`local_source`, `selected_call_path`, `runtime_dependent`), a concise public trigger/consequence, exact references for relevant entry/guard/sink, and a disposition (`supported`, `contradicted`, `insufficient`). These are audit-ready conclusions, not private reasoning. Do not require a fabricated caller or guard where none is evidenced.
2. Validate every support reference with the existing frozen-source machinery and batch-range check. A reference's role is a claim from the assessor, not a deterministic proof of its semantics. Require exact index coverage and reject missing, duplicate or unknown candidate IDs. Explicitly challenge the strongest supplied guard/counterexample, including short-circuit and inherited-property behavior; do not accept mere “no safeguard found” text as proof.
3. Promote only the supported bounded consequence. A contradicted consequence must not remain an actionable issue just because its quote is valid. An insufficient claim needs a public limitation; preserve any separately supported local claim without carrying an unsupported application-impact sentence with it. If uncertainty affects required local completion, retain partial evidence and fail conservatively rather than manufacturing `no_issue_identified` or clean absence proof.

A small evidence-challenge request over the current frozen batch is a practical mechanism to evaluate. It must compare the candidate with guards and counter-evidence, not vote on whether the writer sounds convincing. A second invocation of the same model is an additional assessment pass, **not independent model evidence**. No general deterministic validator can infer arbitrary JavaScript consequences from the proposed schema; quality acceptance still requires independent outcome grading.

Retention integration is essential: source-valid is currently treated as safe partial at lines 754–756. A new semantic rejection must also remove that rejected consequence from this retained set, or terminal repair/capacity failure can reintroduce it. Preserve independently supported siblings and earlier completed batches; retain safe indexes/disposition counts for rejected claims without storing rejected model text in audit metadata. Historical Review findings remain immutable.

### 2. Missing selected callers and runtime assumptions must narrow the claim, rather than become asserted exploitability

**Disposition: Act on. Severity: medium.**

Production evidence:

- [`sourcePrompt.ts:8`](../../../sidecar/src/review/sourcePrompt.ts#L8) correctly separates local assessment from runtime/external verification. It permits qualified `potential_gap` rows, but findings have no separate support-boundary field in [`assessmentValidation.ts:14`](../../../sidecar/src/review/assessmentValidation.ts#L14). Confidence and domain do not encode what was actually established.
- [`featurePathAnalysis.ts:1303`](../../../sidecar/src/review/featurePathAnalysis.ts#L1303) stops branch traversal at nested function bodies; lines 1325–1336 explicitly leave loop bounds, calls and asynchronous behavior unresolved. Those limitations are appropriate and must remain.
- [`assessmentBatches.ts:82`](../../../sidecar/src/review/assessmentBatches.ts#L82) chooses full files for artifact IDs already in the feature references. This protects against snippet-only guard omission, but does not guarantee that every relevant selected caller, configuration normalization or external capability is included. [`assessmentBatches.ts:16`](../../../sidecar/src/review/assessmentBatches.ts#L16) also intentionally restricts retrieval aids to visible batch content.

Observed distinctions: helper nontermination with a caller-supplied bad expression does not establish an application attack when the selected caller supplies a fixed consuming expression; construction of a potentially sparse array does not establish allocation exhaustion; raw cookie metadata concatenation does not prove browser attribute effects in an actual application; and a direct capability access does not establish a regression in a supported runtime without accounting for preceding short-circuit conditions and polyfills.

Minimum change: make the candidate-support gate require selected call-path evidence **only for claims that depend on that path**. A helper-local defect can remain supported at helper scope. For an application/attacker consequence, require an actual selected entry and argument provenance, the relevant normalization/guards, and the consequence boundary. If that selected path is absent from the current packet, mark the application consequence insufficient. An empty caller search is not proof of no caller or safe behavior.

Do not add an unbounded caller expansion. First use the current full selected files and explicit linked references. If later evidence supports adding a syntactic caller index, treat its matches as bounded retrieval hints, not reachability proof; include exact frozen ranges only when they fit existing limits and retain an explicit omission otherwise. Do not follow README links or fetch dependencies to make an allegation pass.

`runtime_dependent` is not synonymous with false: preserve a source-proven limit bypass or conditional exception separately from unsupported engine resource thresholds, browser effects, deployment trust boundaries or compatibility claims. Only an already authorized, separately captured reproduction can establish such operational claims. The product must not execute imported repository code to fill this evidence gap.

## Consider

### 3. A separate verification pass is optional and must share the existing budget

**Disposition: Consider. Severity: medium if enabled incorrectly.**

The existing request budget is **five total AI requests per stable batch operation**, not five per writer plus five per verifier. [`orchestrator.ts:724`](../../../sidecar/src/review/orchestrator.ts#L724) gives each deterministic batch an operation ID; line 731 reads its persisted high-water mark. [`retry.ts:463`](../../../sidecar/src/review/retry.ts#L463) subtracts that offset from the total; lines 495–510 reserve each paid slot before the provider call; lines 580–594 record successful calls too. [`supabaseRepository.ts:1296`](../../../sidecar/src/review/supabaseRepository.ts#L1296) counts attempts by Review and stage.

An optional verifier should therefore consume a remaining slot under **the same batch ledger key**. Calling a provider inside `analyze` as an uncounted subcall, creating a fresh `semantic_verify:<batch>` five-attempt budget, or forgetting successful generation calls violates that contract. Reserve verification capacity within the five-slot plan; do not permit five writer/repair calls followed by a sixth checker. Recovery must resume from durable reservations and a frozen candidate identity, not reset the budget. If no required verification slot remains, retain evidence and report verification incomplete; do not silently accept or auto-start another workflow.

Example admissible total: generation 1, citation repair 2, evidence challenge 3, checker response repair 4, leaving at most one remaining slot for already eligible recovery/transient behavior. This is a maximum budget illustration, not a requirement to spend all slots. A normal candidate batch could use generation plus one challenge. No-finding batches need a separate recall strategy; checking returned candidates cannot discover omitted findings by itself.

Keep the current configured provider/model for the optional pass. Independent evidence verification is an aim, not an independence guarantee: a fresh `codex/gpt-5.6-sol` invocation can repeat the writer's mistake. Do not switch credentials/models to obtain agreement or describe same-model agreement as independent corroboration. Existing capacity classification at [`retry.ts:133`](../../../sidecar/src/review/retry.ts#L133), immediate pause propagation at line 556, and [`orchestrator.ts:961`](../../../sidecar/src/review/orchestrator.ts#L961) must stop generation, challenge, later batches and fallback alike. Existing malformed fallback suppression at [`orchestrator.ts:794`](../../../sidecar/src/review/orchestrator.ts#L794) must remain effective. Whether an already configured fallback is eligible remains governed by the existing policy; a verification step must not create new fallback eligibility.

### 4. The recall miss needs generic contract-comparison fixtures, not a benchmark-shaped prompt

**Disposition: Consider until all baseline cases establish the broader failure pattern. Severity: high for the fixed recall threshold.**

The new completed case misses a selected behavioral contract even though the relevant files were inspected and source sweeps ran. The prepared map and complete four-domain records establish execution/disclosure, not semantic recall. [`orchestrator.ts:864`](../../../sidecar/src/review/orchestrator.ts#L864) checks map completion; it cannot prove that every defect was found. [`assessmentValidation.ts:216`](../../../sidecar/src/review/assessmentValidation.ts#L216) already restricts absence proof by unresolved edges; do not weaken that conservatism to improve completion numbers.

Add independently authored miniature cases that compare a declared configuration option with two selected implementations, where one implementation omits or mishandles it. Pair with a case where the difference is documented/intended and a case where the missing implementation is unselected. Grade exact trigger/cause/consequence plus correct abstention. These must use different names, structures and behavior from registered gold. A generic source-sweep instruction to compare public contracts may be tested, but a wording change alone is not acceptance evidence. Do not insert the missed issue, special-case its repository/file names, or expose benchmark issue text to production.

## Required acceptance fixtures for any proposed patch

Use trusted miniature fixtures and fake providers for lifecycle checks; no upstream Axios code/dependencies/test execution is needed. These are recommendations, not tests run by this review.

| Fixture family | Required observable result | Blocking regression |
| --- | --- | --- |
| Guard/counter-evidence pair | Unguarded local failure is retained; guarded twin rejects the alleged consequence; any different omission is evaluated separately | Exact quoted text lets the contradicted consequence pass, or an unsupported sibling is promoted on repair exhaustion |
| Caller/normalization pair | Bad direct helper input supports only its demonstrated local behavior; fixed safe selected caller does not become an attacker-controlled application path; unsafe selected caller can support the stronger claim | Generic helper exposure or a missing keyword is treated as remote exploitability; caller context is fabricated |
| Runtime/contract pair | Source-level configured limit bypass is distinct from process exhaustion; short-circuited capability access does not become unconditional compatibility failure; browser impact remains insufficient without evidence | Confidence alone turns runtime assumptions into proof, or every conditional source defect is discarded as Unknown |
| Ledger/retention/privacy | Across writer, repairs, challenge, fallback and recovered reservations, paid requests stay at most five per stable batch; quota stops immediately; valid siblings survive; unverified claims cannot resolve old issues | Nested unreserved calls, reset verifier sub-budgets, sixth request, capacity fallback, lost siblings, raw rejected text/source/prompt/private reasoning in audit metadata |
| Recall and evidence controls | Generic cross-implementation contract defect is found with exact frozen references; intentional difference does not become a defect; malformed/unknown/duplicate candidate IDs and forged citations fail | Candidate challenge is presented as recall coverage; missing candidates or altered-source citations receive acceptance |

At integration level, verify every added support/challenge/repair reference against the frozen version and original range. Preserve `findingsWithinBatch` at [`assessmentBatches.ts:37`](../../../sidecar/src/review/assessmentBatches.ts#L37). Apply context checks to every request built for the challenge and its repair. [`sourcePrompt.ts:150`](../../../sidecar/src/review/sourcePrompt.ts#L150) currently measures prompt characters; account explicitly for any added system/schema/support-packet overhead rather than assuming a second pass fits. Never truncate guards or caller evidence silently to obtain a disposition.

Audit only allowlisted counts, trusted candidate indexes, stable hashes, safe disposition/error enums, attempt numbers and durations. Existing citation-repair feedback intentionally omits rejected text at [`sourcePrompt.ts:99`](../../../sidecar/src/review/sourcePrompt.ts#L99); existing map auditing excludes raw source/prompts at [`featurePathAnalysis.ts:1601`](../../../sidecar/src/review/featurePathAnalysis.ts#L1601). Support evidence belongs in the appropriate frozen evidence record, not raw harness metadata. Public concise limitations remain distinct from private model reasoning. Preserve legacy reading and immutable historical results if additive support metadata is persisted.

## Verification and limits

Only source/data reads and SHA-256 comparison were performed for this follow-up. All six reviewed production files below exactly match the captured runtime-source copies for the active baseline. No production or test files were changed; no provider/app/network calls, upstream execution, installs, unit/integration tests or behavior reproductions were performed. Recommendations are unimplemented and unverified. Earlier successful source/type checks belong to the separate Axios adjudication, not validation of a future mitigation.

| Reviewed file | SHA-256 |
| --- | --- |
| `sidecar/src/review/sourcePrompt.ts` | `96646b933a588d0c5c61e115baf399d1eaf5092a31259c655813185f857d91e8` |
| `sidecar/src/review/assessmentValidation.ts` | `78ac75e0e063822190784e1b14f80a218138d35c8f822cf83ebed3f8cea26da2` |
| `sidecar/src/review/orchestrator.ts` | `28d590d2935750a3bc3c282490447c3804c337372f0c1be269fe945d9eba41d1` |
| `sidecar/src/review/featurePathAnalysis.ts` | `e1e8adfb3f4256b361a828868dcba392753be821145e238c6835bf5ed1a0ad3b` |
| `sidecar/src/review/assessmentBatches.ts` | `2f14d5031a9ed4465d5b76d7e04faf3de3102396475eda152b77f1c04023c1ff` |
| `sidecar/src/review/retry.ts` | `a34494a4c4da5138ab26ef70324c03564a13ce820b3d404ead3e1285072056f6` |

The four other baseline outcomes are still required. Keep frozen thresholds, unknown counts, fixed five-issue/seven-occurrence denominators, raw/effective Readiness distinctions, and all historical reports unchanged. A patch that suppresses allegations can improve precision while worsening recall; evaluate both. This review author is the independent Axios adjudicator performing a sequential production-source follow-up, not a separate independent model-review panel.
