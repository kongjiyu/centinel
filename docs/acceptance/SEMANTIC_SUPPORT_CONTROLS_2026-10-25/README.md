# Semantic-support evaluation controls

This folder contains a small, hand-authored source corpus for evaluating whether a reviewer distinguishes exact citations from supported consequences. It has 12 miniature cases, 21 candidate judgments, 20 TypeScript source files, and six paired or grouped contrasts.

## Contents

- `inputs/` contains only miniature `.ts` source fixtures. These are the complete source packets for the cases.
- `tasks/candidate-claims.json` contains candidate claims without expected labels. It can be combined with the source packets for a blinded run.
- `expected/expected-dispositions.json` is the separate answer key, with expected dispositions, scope boundaries, explanations, source hashes, and exact line references.
- `tools/` contains a Node built-in-only corpus verifier and its tests.
- `PROVENANCE.md` and `BLINDED_EVALUATION.md` describe how the corpus was authored and how to use it without exposing the answer key.

## Verify integrity

Run from this directory:

```powershell
node tools/verify-corpus.mjs
node --test tools/verify-corpus.test.mjs
```

The verifier checks the pinned answer-key hash, candidate-task hash, all source SHA-256 values, the exact input file list, source-only input folders, every quoted source line, and the contrast-to-answer mapping. Committed tests check source edits, forged line quotations and an unregistered `expected.json` under `inputs/`. This is file/hash separation, not semantic scanning for answer text in arbitrary source comments.

Only Node built-ins are imported. The verifier does not compile or execute fixture code, import application code, use providers, access the network, or install dependencies.

## Disposition meanings

- `supported`: the supplied source and any stated local contract establish the claim at its declared boundary.
- `contradicted`: supplied source or a documented exception directly conflicts with the claim.
- `insufficient`: the source does not establish a required caller, trust origin, runtime condition, or application consequence. This label does not mean the claim is false.

The expected judgments deliberately distinguish local behavior from selected-call-path, runtime, and cross-implementation claims. In particular, a supported local defect must remain separable from an insufficient broader impact claim.

## Limits

This corpus does not implement or validate Centinel's production semantic gate. A fake provider, a schema-valid response, or a passing integrity check cannot establish semantic accuracy. The cases are small controls for specific reasoning distinctions; they do not measure general review recall, calibrate a model, or prove real-world behavior. See `BLINDED_EVALUATION.md` before using the answer key for an evaluation.
