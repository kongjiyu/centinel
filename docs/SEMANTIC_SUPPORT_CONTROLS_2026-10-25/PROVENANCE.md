# Provenance and authorship

Created on 25 October 2026 as an isolated documentation artifact under `docs/SEMANTIC_SUPPORT_CONTROLS_2026-10-25/`.

The fixture families follow the general recommendations in `docs/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24/SEMANTIC_GAP_REVIEW.md`: challenge a stated consequence against guards and counter-evidence; use bounded selected-call-path context; keep runtime claims qualified; retain supported local behavior when a wider consequence is unestablished; and compare selected implementations against a declared contract.

Every TypeScript fixture in `inputs/` was written for this corpus. The cases use invented names, contracts, and behaviors. No frozen public benchmark manifest, oracle, patch, source case, or upstream code was used or copied. Fixture code is inert and is not imported or executed by the verifier. The candidate prompts and expected labels live in separate files.

The expected dispositions were written by the corpus author from the miniature sources and declared fixture contracts before any model evaluation. They are a separate answer key, not an independent second-person adjudication. The hashes and line checks establish artifact integrity and citation location; they cannot certify that a judgment is semantically correct. Human review should approve the answer key before future use.

No production source, production tests, benchmark gold, evaluation metrics, or historical results are part of this artifact. No app imports, provider calls, credentials, network access, or upstream execution are required.

## Pre-evaluation wording revision

Before any provider evaluation of this corpus, independent GPT-6.1 Sol High review identified three precision improvements. The lead qualified case-02's explanation to values above24 rather than claiming validation of every numeric value; no expected disposition, candidate task, source byte or source reference changed. The expected-manifest SHA changed from `d9fcc88bddd533c1f1f91dd56e6c2dc958a63233512940296af41f18822d1c30` to `560f25368db33e29e826efb1a0e5653cc6e16fe6e837302daeb6d4d46ec401eb`, and the verifier pin was updated explicitly. Blind-packet instructions now randomize task IDs and order as well as case IDs; verifier documentation describes file/hash separation without implying semantic answer-content scanning. The verifier and all four integrity tests passed again. No registered public-benchmark gold or historical result was changed.

Fixture author: delegated GPT-6 Luna MAX. The separate synthetic-corpus reviewer is GPT-6.1 Sol High; its review is model-assisted artifact review, not human approval or calibrated production-model accuracy. Neither saw configured-provider responses for this corpus because none have been requested.
