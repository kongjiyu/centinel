# Independent review of synthetic semantic-support controls

Reviewed 25 October 2026. **Accepted by model-assisted independent review for prospective evaluation of supplied candidate claims at the final recorded revision. No blocking finding or required label change.** This acceptance covers corpus suitability, answer-key reasoning, packet separation, and integrity checks only. It is not human approval and does not establish production semantic accuracy, a calibrated threshold, or discovery recall. The existing production v9 evaluation is outside this review and remains unchanged.

## Scope and method

The delegated reviewer inspected every file in this directory except this newly written report: all 20 complete synthetic TypeScript sources, all 21 candidate claims and corresponding answer-key entries, all 56 quoted references, six contrast mappings, documentation, verifier, and four tests. Sources were read as text; no fixture was imported or executed. Review and test skills and the supplied AGENTS instructions were applied. No additional reviewers were spawned by this reviewer.

No public benchmark frozen manifest, oracle, patch, source case, production source, upstream code, provider, application, or network service was read or called. The provenance statement about the author's source independence is an author declaration, not something this restricted review can independently establish.

## Final revision check

The lead corrected wording before any configured-provider evaluation. This reviewer read the revised README, provenance and blind-packet instructions, checked the revised explanation, and reran the verifier and all four tests successfully. Replacing only the new case-02 summary with its original text reproduces the original manifest SHA-256; replacing only the new verifier pin with the original pin reproduces the original verifier SHA-256. All 20 source files, the task packet and the test file still match their original reviewed hashes. Thus no disposition, source, task, citation, or verifier behavior changed.

The final manifest digest is `560f25368db33e29e826efb1a0e5653cc6e16fe6e837302daeb6d4d46ec401eb`. The initial observations below are preserved as review history: the explanation qualification and opaque-ID instructions are resolved; README test-scope wording is resolved. Adding more committed mutation tests remains an optional improvement, with those protections separately exercised successfully during this review. Opaque randomization is now correctly specified, but no randomized evaluation packet was created or inspected; this review does not claim that procedure has been executed.

A final inventory check initially caught the lead's concurrent provenance edit; that was a revision change, not a failed corpus-integrity check. The lead's stable revised files were then read and rechecked as described above.

## Initial findings (history; disposition after revision stated above)

### Consider — P3: narrow the case-02 explanation to the asserted input

Location: `expected/expected-dispositions.json:41`; implementing expression: `inputs/case-02/source.ts:13`.

The candidate specifically concerns a numeric request above 24, for which the `contradicted` judgment is correct. Its explanation says, without qualification, “The value is clamped to the inclusive range 1 through 24 before the sink call.” A TypeScript `number` can also be `NaN`; `Math.max(1, NaN)` and the following `Math.min` remain `NaN`, outside that range. This does not overturn the candidate judgment and is not a new security/impact finding.

Recommended replacement: **“A numeric request above 24 becomes 24 before the sink call; nullish input uses the default. This expression does not validate NaN.”** No disposition or source change is needed. Any explanation edit changes the manifest hash and requires an explicit prospective revision of its pinned hash; preserve the review history rather than presenting this reviewed hash as the revised one.

### Consider — P3: optional opaque-directory instructions retain original task IDs

Location: `BLINDED_EVALUATION.md:6`; task examples: `tasks/candidate-claims.json:4` onward.

The optional “stronger blind” procedure rewrites only `caseId`. Every `id` still contains `task-case-NN-...`, retaining the original case identity and task ordering. There are no expected disposition fields in the current task packet, so this is not evidence of current answer-key leakage. However, the procedure does not remove original identifiers and must not be described as having achieved an opaque identity blind.

Recommended wording: **“For an opaque identity blind, assign random case-directory IDs and random task IDs, rewrite task caseId values to the new directory IDs, and shuffle task order. Keep the original-to-random mappings outside the packet. Preserve source bytes, line numbers, filenames within each case, and relative imports. This removes original IDs; it does not conceal the content of a candidate claim or its source evidence.”** Future scoring must use the private task mapping. Merely randomizing directories is not sufficient to claim this stronger condition.

### Consider — P3: make integrity-test scope explicit when expanding the suite

Locations: `README.md:22`; `tools/verify-corpus.test.mjs:47` (the final test); verifier input enumeration and pinned-hash checks.

The four committed tests pass. The final negative test inserts `expected.json`, exercising the source-extension check; it does not itself exercise an extra `.ts` file, task mutation, default pinned-manifest rejection, or inconsistent contrast mapping. Direct inspection confirms those checks exist, and this review separately exercised all four with temporary corpus copies successfully. No missing protection was demonstrated for the current pinned corpus.

Optional README replacement: **“The committed tests check the intact corpus, source-byte edits, forged line quotations, and a JSON gold file placed under inputs. Input registration and hashes protect the reviewed packet; these checks do not semantically classify arbitrary source text as gold-free.”** Add the separately exercised negative cases to the committed suite if the corpus tooling will evolve. A future repackaged blind packet needs its own byte inventory and field/separation check; the current default verifier is tied to the original directory and manifest IDs.

## Candidate-by-candidate adjudication

All labels below agree with the current answer key. “Supported” denotes the stated bounded claim, and does not automatically denote a defect.

| Case / judgment | Expected | Independent assessment against complete supplied source |
| --- | --- | --- |
| 01 / over_limit_value_forwarded | supported | `source.ts:9,12-13`: an above-24 supplied number survives `??` and is forwarded. No bound or upstream caller appears in this complete case. This establishes forwarding, not a declared maximum contract or application damage. |
| 02 / over_limit_value_forwarded | contradicted | `source.ts:9,12-14`: values above 24 become 24. NaN qualification affects the summary, not this claim. |
| 03 / invalid_column_reaches_selected_division | contradicted | `source.ts:3-6,13-15`: conversion, finite check and truncation/clamping supply an integer from 1 through 10, or fallback 4, to the private calculation helper. Invalid raw inputs do not become invalid columns on this selected path. |
| 03 / row_count_uses_received_columns | supported | `source.ts:9-10`: `itemCount / columns` occurs inside `Math.ceil`. This local expression does not establish an invalid selected divisor. |
| 04 / configured_palette_is_overwritten | contradicted | `source.ts:1-8`: non-nullish palette strings, including an empty string, survive the nullish fallback and reach `paint`. |
| 04 / missing_palette_uses_fallback | supported | `source.ts:4,6-8`: omission/undefined selects `paper`; the expression also handles runtime null although the declared optional string type does not include null. No wider input-type guarantee is inferred. |
| 05 / private_helper_maps_negative_to_empty | supported | `source.ts:2-4`: a direct negative count becomes zero, producing an empty list. This is local helper behavior and is not the selected entry's behavior on a count argument. |
| 05 / public_entry_accepts_negative_count | contradicted | `source.ts:7-9`: the selected entry has no count parameter and passes fixed 3. A JavaScript extra argument would be ignored rather than propagated as a count; the judgment is about the declared selected count input/path. |
| 06 / entry_propagates_negative_count | supported | `source.ts:1-9`: `submitBoard` forwards its count without entry validation, contrary to the stated negative-count entry contract; the helper subsequently maps a negative to zero. This is a local contract defect, not demonstrated remote exposure. |
| 06 / external_actor_controls_count | insufficient | `source.ts:8-9`: export and direct forwarding establish no caller, remote route, trust origin, or actor control. |
| 07 / requested_length_formula | supported | `source.ts:1-3`: the typed-array constructor argument is `slotCount * 256`. This is the requested expression, not a guarantee of successful allocation or exact realized length for every numeric value. |
| 07 / large_value_exhausts_process_memory | insufficient | `source.ts:1-3`: deployment limits, runtime allocation behavior, and process exhaustion are unestablished; a size rejection/exception is also compatible with this source. |
| 08 / missing_schedule_throws | contradicted | `source.ts:1-7`: an absent optional method fails the function-type guard and returns before invocation. This does not guarantee safety for arbitrary proxies/getters or invalid scheduler objects outside the stated ordinary capability case. |
| 08 / runtime_matrix_has_unsupported_version | insufficient | `source.ts:1-7`: neither runtime versions nor supported deployment capability requirements are supplied. Optional typing and a guard do not establish an incompatible supported version. |
| 09 / false_switch_is_dropped | supported | `source.ts:1-8`: false is skipped, directly violating the explicit serialization contract. This is a genuine local defect. |
| 09 / false_switch_bypasses_access_control | insufficient | The complete case contains no consumer or authorization decision. The supported serialization defect does not prove an application access-control bypass. |
| 10 / selected_notebook_omits_gutter | supported | `contract.ts:1-2`, both complete writer implementations, `selected.ts:1-4`: both writers are selected, the shared contract covers both, and notebook returns fixed output while board uses the requested gutter. This is a supported cross-implementation contract defect for a requested nonempty gutter. |
| 11 / byte_stable_writer_ignores_mark | supported | `byte-stable-writer.ts:3-5`, `selected.ts:1-3`: the selected implementation returns fixed bytes and ignores its argument, consistently with the specific exception. |
| 11 / documented_omission_violates_rule | contradicted | `contract.ts:1` explicitly states a default rule, while `byte-stable-writer.ts:3` supplies a specific exception. The complete supplied contracts are compatible; ignoring the option here is not a demonstrated defect. |
| 12 / prototype_omits_mark_locally | supported | `prototype-writer.ts:1-4`: the local prototype ignores its options and returns fixed text. The selected-production contract does not automatically apply to it. |
| 12 / prototype_omission_affects_active_route | contradicted | `selected.ts:1-3` selects only `writeCard`; `active-writer.ts:3-5` applies the supplied mark at both edges. The complete selected set does not import/select the prototype. No unseen runtime selection is assumed. |

## Acceptance and verification

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Candidate judgments | Every claim adjudicated against its full own-authored packet; bounded behavior separated from defects and impact | Pass: 21/21 labels retained; explanation qualification corrected | Typed/local fixture boundaries apply |
| Guard, caller and contract contrasts | All six contrast sets preserve their intended counter-evidence and supported siblings | Pass | Explicit synthetic comments are fixture contracts, not independently established real-world requirements |
| Source/task separation | Current inputs contain only the 20 registered TypeScript sources; task JSON has only schema/task IDs/candidate text; no expected labels, gold summaries or provenance in the packet | Pass by enumeration, full text review and field checks; stronger-blind instructions corrected | Randomized packet generation unrun; sources and claims necessarily reveal their own semantics |
| Integrity verification | Pinned manifest/task/source bytes, exact quotations, registration and mapping validated | Pass: 12 cases, 21 tasks/judgments, 20 sources, 56 references, six contrasts | Hashes and syntax/field checks do not establish semantic truth |
| Committed tests | Existing relevant test suite passes | Pass: 4/4; no skipped tests | Additional mutation checks below were ad hoc, not committed tests |
| Production/evaluation claims | Remain outside this prospective corpus approval | Not evaluated | No model responses, production gate evidence, calibrated threshold, or discovery-recall measurement |

Executed from this corpus directory:

```text
node tools/verify-corpus.mjs
PASS: 12 cases, 21 judgments, 21 tasks, 20 source files, 56 exact references, 6 contrasts

node --test tools/verify-corpus.test.mjs
PASS: 4 tests; 0 failures; 0 skipped
```

Additional Node built-in-only checks used isolated temporary copies and removed only those copies afterward:

1. Appending a newline to the expected manifest is rejected by the default pinned hash.
2. Appending a newline to the candidate-task file is rejected by its manifest-recorded hash.
3. Adding an unregistered `inputs/case-01/gold.ts` file is rejected by input/source inventory comparison.
4. Changing a contrast's disposition is rejected by contrast-to-judgment validation with only pin enforcement disabled, so the mapping check is exercised directly.
5. The actual candidate packet has exactly `schemaVersion`/`tasks` at top level and `id`/`caseId`/`candidate` on every task.

All five checks passed. This reviewer made no source, label, verifier or instruction edits. Frontend, sidecar, live providers, TypeScript compilation, and production tests were not run because they are outside the documentation-only review. Source behavior adjudication rests on complete static source inspection, not observed application execution.

## Original reviewed SHA-256 inventory (history)

The following hashes identify all 27 originally reviewed input artifacts, excluding this report. The final reviewed revision is recorded in the second inventory below. This report contains gold information and must stay outside a blind evaluation packet.

```text
529969f5f4eafd8916bf2572ebea570d940d523b02fd98fd1b0ae17a8a2138d8  BLINDED_EVALUATION.md
560f25368db33e29e826efb1a0e5653cc6e16fe6e837302daeb6d4d46ec401eb  expected/expected-dispositions.json
36a802ce00946f2c5bc501d8f6b4c47843c8b6194b59724399ce5af5226a27c9  inputs/case-01/source.ts
bacff838548e7581c2b69ad29bf3144501ed44219d67a7234f38e1b5bdb6bd1f  inputs/case-02/source.ts
517e7538646d1028025102aa8ab84d03c910c784d7341630855fe0a1e545ca15  inputs/case-03/source.ts
8ca467d2f8c0f04ab6eff75fc63067f1126e444764579e9fb44c24d3f2103309  inputs/case-04/source.ts
41998c514744531eca278017db0af81f581734a7edda8215c9917f51717abffe  inputs/case-05/source.ts
33b0141f9e8b3f361c5c4a478d3729cc7e268872d14914d2ba984ee04309b38b  inputs/case-06/source.ts
cdbfdeb47628c878f6f97241a26a555477d6c386bdd415ade06ca9f4337b6bb0  inputs/case-07/source.ts
6132b0e48359d51f9995dbc247a8abba750d08e0fa690a126a6978358dce89cf  inputs/case-08/source.ts
662f5ada54c04af12ce039e47ecf67071589841395a946e34613a75ae538d71b  inputs/case-09/source.ts
911ece5c6a77f2559ea3acc366b99af83f59210f027e2df3ad68931c46950acf  inputs/case-10/board-writer.ts
c8435ddf510ef42a6d2242ecbb837c6d52be44f04b852eb9463e40862000a01c  inputs/case-10/contract.ts
5521ae27d024ae2a0f27fd6a501dc5e684cbc6bdf6f2d027aca3186c63612850  inputs/case-10/notebook-writer.ts
522b041e8907ca47298adacf1e5cb9f82cbcc192839d02b4acbf6cfae07578e1  inputs/case-10/selected.ts
633d45548699c45b27c45c4f3edcf8f25636f706b040b2d48f4029215abbea37  inputs/case-11/byte-stable-writer.ts
36920bae59565f4e6a60533eb7e4b0205d8ede76cd7765ce4c431da1e32a8e30  inputs/case-11/contract.ts
6323a343f004444411082a04bede6259781734a6a2bc7249d464e25879cf3ad0  inputs/case-11/selected.ts
7ee0457ca1f006ffb86a323e0bd0f7637ebd3053506341fcd1aaa6c4871bfaf3  inputs/case-12/active-writer.ts
92defb93ca79f1e8934a15bf271bbd819dff010ea284f677823d12c2b65dc9b7  inputs/case-12/contract.ts
8ed5bf287e8dad4c574994a35facfef85ee2e6609d077db97998bf001b02ef23  inputs/case-12/prototype-writer.ts
2856d4b8d0e7cd89de0a39956784444f8dd42c5d29f9185bcd8a5c633d394c3a  inputs/case-12/selected.ts
3b4941cf2c4c5bd0400adca90859dcb05868dea71de8b9719d1f1bc51d0eef33  PROVENANCE.md
e9b7e3eea21930081aca49229478c8dbd5f7d56a4a68d8ffdfbaaeaf0a007a0b  README.md
7e0d7e0ae374b9d8cef23e63ada3379e6db30cafc96a6e52a3dce9d8e2d4e13f  tasks/candidate-claims.json
abd23bf0fbebf0a2a2c1560cc5a6bb5e8fa1593aeda55fc33cf8f9ade7cb7d89  tools/verify-corpus.mjs
e70c191dfa67208e9f895403a0e4e918b0d532006c880a7581224ed6d9e2e3cb  tools/verify-corpus.test.mjs
```

## Final reviewed SHA-256 inventory

These 27 hashes are the final accepted artifact revision. The report itself is excluded to avoid a self-referential hash.

```text
529969f5f4eafd8916bf2572ebea570d940d523b02fd98fd1b0ae17a8a2138d8  BLINDED_EVALUATION.md
560f25368db33e29e826efb1a0e5653cc6e16fe6e837302daeb6d4d46ec401eb  expected/expected-dispositions.json
36a802ce00946f2c5bc501d8f6b4c47843c8b6194b59724399ce5af5226a27c9  inputs/case-01/source.ts
bacff838548e7581c2b69ad29bf3144501ed44219d67a7234f38e1b5bdb6bd1f  inputs/case-02/source.ts
517e7538646d1028025102aa8ab84d03c910c784d7341630855fe0a1e545ca15  inputs/case-03/source.ts
8ca467d2f8c0f04ab6eff75fc63067f1126e444764579e9fb44c24d3f2103309  inputs/case-04/source.ts
41998c514744531eca278017db0af81f581734a7edda8215c9917f51717abffe  inputs/case-05/source.ts
33b0141f9e8b3f361c5c4a478d3729cc7e268872d14914d2ba984ee04309b38b  inputs/case-06/source.ts
cdbfdeb47628c878f6f97241a26a555477d6c386bdd415ade06ca9f4337b6bb0  inputs/case-07/source.ts
6132b0e48359d51f9995dbc247a8abba750d08e0fa690a126a6978358dce89cf  inputs/case-08/source.ts
662f5ada54c04af12ce039e47ecf67071589841395a946e34613a75ae538d71b  inputs/case-09/source.ts
911ece5c6a77f2559ea3acc366b99af83f59210f027e2df3ad68931c46950acf  inputs/case-10/board-writer.ts
c8435ddf510ef42a6d2242ecbb837c6d52be44f04b852eb9463e40862000a01c  inputs/case-10/contract.ts
5521ae27d024ae2a0f27fd6a501dc5e684cbc6bdf6f2d027aca3186c63612850  inputs/case-10/notebook-writer.ts
522b041e8907ca47298adacf1e5cb9f82cbcc192839d02b4acbf6cfae07578e1  inputs/case-10/selected.ts
633d45548699c45b27c45c4f3edcf8f25636f706b040b2d48f4029215abbea37  inputs/case-11/byte-stable-writer.ts
36920bae59565f4e6a60533eb7e4b0205d8ede76cd7765ce4c431da1e32a8e30  inputs/case-11/contract.ts
6323a343f004444411082a04bede6259781734a6a2bc7249d464e25879cf3ad0  inputs/case-11/selected.ts
7ee0457ca1f006ffb86a323e0bd0f7637ebd3053506341fcd1aaa6c4871bfaf3  inputs/case-12/active-writer.ts
92defb93ca79f1e8934a15bf271bbd819dff010ea284f677823d12c2b65dc9b7  inputs/case-12/contract.ts
8ed5bf287e8dad4c574994a35facfef85ee2e6609d077db97998bf001b02ef23  inputs/case-12/prototype-writer.ts
2856d4b8d0e7cd89de0a39956784444f8dd42c5d29f9185bcd8a5c633d394c3a  inputs/case-12/selected.ts
427ceca51cba53b667b19e2659fd19c6409e1d7535f78e5ddc67cf4b22920b37  PROVENANCE.md
e9b7e3eea21930081aca49229478c8dbd5f7d56a4a68d8ffdfbaaeaf0a007a0b  README.md
7e0d7e0ae374b9d8cef23e63ada3379e6db30cafc96a6e52a3dce9d8e2d4e13f  tasks/candidate-claims.json
abd23bf0fbebf0a2a2c1560cc5a6bb5e8fa1593aeda55fc33cf8f9ade7cb7d89  tools/verify-corpus.mjs
e70c191dfa67208e9f895403a0e4e918b0d532006c880a7581224ed6d9e2e3cb  tools/verify-corpus.test.mjs
```
