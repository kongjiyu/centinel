# Future blinded evaluation instructions

Keep the expected-disposition file away from the model and evaluator until responses are frozen.

1. Copy only `inputs/` and `tasks/candidate-claims.json` into a clean evaluation packet. Do not include `expected/`, `tools/`, this folder's README, or provenance notes.
2. For a stronger blind, rename each `inputs/case-NN/` directory to a random opaque ID, rewrite task `caseId` values to match, replace each task `id` with a separate opaque ID and shuffle task order. Original case numbers must not remain embedded in task IDs. Preserve source bytes, line numbers, filenames inside each case, and relative import structure. Keep both old-to-new mappings outside the evaluation packet so responses can be matched to the answer key only after they are frozen.
3. Give the evaluator each task with its matching source packet. Request one of `supported`, `contradicted`, or `insufficient`, the claim boundary, exact source-line references, a concise public explanation, and any missing evidence needed to advance an insufficient claim. Do not ask for private reasoning.
4. Freeze and hash all responses before opening the answer key. Then compare each task against `expected/expected-dispositions.json`, including its paired or grouped cases. Have a human adjudicate disagreements before changing any label.
5. Report counts by disposition and contrast set, plus false promotions, missed supported claims, incorrect contradictions, citation errors, and abstentions. Keep the raw response record separate from the answer key.

These tasks test support judgments for supplied candidate claims. They do not test whether a reviewer discovers every possible issue in an open-ended code review. Add a separately designed recall study if that is the evaluation goal. Do not use these 12 miniatures as a calibrated acceptance threshold for a production feature.

The fixtures should be treated as static text. Do not execute code from a reviewed repository or import it into the verifier. A fake provider can check request/response plumbing, but it cannot show that a semantic conclusion is true. This corpus itself does not demonstrate that a production semantic gate works.
