# Dynamic mock context and immutable coverage

M3 delivery contract, 14 October 2026. Authority: DESIGN.md, revised PRD and
DEVELOPMENT_PLAN.md P3. Static implementation and a real Static export adapter
remain excluded. Implementation and the acceptance below are verified for the M3 milestone PR.

## Delivered behavior

The foundation supported explicit `contextScenario` authoring and immutable
Mission/Run context, but its editor only showed the normal fixture and regenerated
criterion options while editing a recorded revision. M3 preserves the loaded
snapshot, handles all six mock scenarios and adds explicit acknowledgment,
exclusion reasons and recorded criterion coverage.

Consume `IncomingContextSource` through the explicit development mock adapter;
reuse existing authorized authoring rather than adding a simulated Static service.
The user must choose mock input. An absent snapshot permits manual authoring;
provider/source failure must remain visible and cannot fall back to fabricated input.
Preserve loaded snapshots while editing instead of regenerating normal criteria.

- Expose normal, stale, conflicting, pending, incomplete and absent fixtures.
  Distinguish scenario/snapshot identity and display supplied source versions,
  currency, requirements, criteria, synthetic risk hints and limitations.
- Permit an attributable acknowledgment for stale/conflicting/pending/incomplete
  context. Mock approval remains synthetic data; acknowledgment is not a real
  Review approval. Missing input is not a passed requirement.
- Select a supplied criterion, author its explicit independent browser check and
  edit the generated Mission before running. Keep criteria identities separate
  from check identities and preserve the full incoming context in every revision.
- Validate bounded structure, schema/provenance, project binding, unique references,
  requirement revisions and source/criterion relationships at the consumer. Reject
  cross-project input, duplicate/dangling references and malformed metadata.
  Caller-supplied IDs never authorize access to the real Review service.
- Persist explicit criterion exclusions with bounded reasons in Mission revisions.
  Reject an exclusion that also has an executing check. Unselected criteria remain
  not tested, rather than being silently excluded from the denominator.

## Coverage contract

For each Run, derive coverage exclusively from its frozen revision/context,
configured checks, actual independent check results and retained evidence. Show
snapshot provenance/version and all supplied criteria in the declared denominator.
Map multiple checks to a criterion without treating a model's finish proposal as
an observation. A pass/fail requires relevant checked evidence; missing or
contradictory results remain uncertain. A blocked execution shows its execution
reason separately from a website failure. Unselected criteria remain not tested;
explicitly excluded criteria retain their recorded reason.

If a requirement has no supplied criteria, disclose that incompleteness separately
from the known-criteria count; do not invent a criterion or a zero-coverage success.
Manual tests have independently checked outcomes but no incoming-requirement
coverage denominator. New snapshots/revisions do not rewrite old coverage, and
old passes do not validate a changed source. M5 reports will consume this same
frozen coverage boundary with an explicit synthetic-source label.

## Acceptance contract

1. Unit/consumer tests exercise all six fixtures, bad schema/types, duplicate IDs,
   cross-project and dangling references, source failures and manual authoring.
2. Coverage tests cover passed/failed/blocked/uncertain/not-tested/excluded states,
   multiple checks, unavailable evidence, incomplete denominators and historical
   source/revision changes. No runtime outcome is authored by the stub.
3. A real QA bearer selects a normal criterion, saves an edited Mission and runs
   it on the pinned local target with Codex/Playwright and retained independent
   evidence linked to that exact mock criterion. Preserve target data lifecycle.
4. Logged-in UI handles exceptional fixtures and explicit acknowledgments, retains
   user edits on errors, preserves a loaded historical snapshot and shows exact
   coverage for the selected Run. DESIGN.md viewports: 1440×900, 1200×900, narrow.
5. Run appropriate suites, TypeScript/build and persisted-data regression checks;
   publish/attach the milestone PR and merge only after these gates pass. API live
   acceptance remains user-deferred. P4–P7 remain required subsequent work.

## Retained acceptance, 14 October 2026

- 449 sidecar tests and 202 frontend tests passed; sidecar TypeScript and frontend
  build passed. Ten transactional Postgres suites passed, including schema/types,
  cross-project/duplicate/dangling references, exclusions, attributable pending
  acknowledgment, helper privacy and historical source/revision preservation.
  The isolated additive-upgrade fixture retained prior ready/dirty data, preparation,
  events and cancelled Run history. Build retains its existing large-chunk warning.
- Migration `202610140005` applied and registered on Centinel Supabase. New revision
  writes validate/sanitize context and persist exclusions in both HTTP and the
  bearer-scoped public RPC. Internal normalization/legacy-core functions remain
  private. Existing snapshots are not rewritten; malformed legacy coverage is
  explicitly unavailable rather than fabricated.
- Real QA-bearer authoring exercised normal/stale/conflicting/pending/incomplete/
  absent inputs. Exceptional input was rejected without acknowledgment, accepted
  with attributable acknowledgment, and retained pending synthetic approval rather
  than converting it to real approval. Manual authoring with absent input worked.
  Authorized public-RPC control succeeded; foreign context and private helper calls
  were rejected. No Static scan/export or fallback service was introduced.
- Real RWA seeded credentials were entered through the actual browser UI during
  baseline preparation, with a private encrypted local session reference. Codex
  then clicked **Logout**, navigated to the protected root and verified the redirect
  to `/signin` plus visible Sign in text. Both independent checks mapped to exactly
  `MOCK-RWA-AUTH-01-C2` in revision `107ef263-3c3d-41a7-aef9-690927ec6cc5`.
  Run `9c54af02-cdeb-4a5f-a61f-4bf18576336d` completed/passed. The four supplied
  criteria remained the denominator: one passed, one explicit payment exclusion
  and two not tested. Synthetic context supplied no browser result.
- Four exceptional fixtures were handled in the logged-in editor; absent input
  switched explicitly to manual authoring. Saving a recorded snapshot no longer
  reloads it as a new mock scenario or disables Run with a phantom dirty draft.
  Unknown fixture names fail instead of manufacturing normal input. Source failures
  and project changes preserve/discard data appropriately without a fallback.
- Creating revision 2 with changed source/requirement versions left the actual old
  Run's coverage unchanged. The UI warns that an earlier pass does not validate the
  current revision. Coverage includes frozen source currency, synthetic approval,
  acknowledgment attribution and incomplete-input warnings; it does not claim every
  natural-language clause was automatically exercised by the configured checks.
- 14 retained JSON/Markdown artifacts were inspected for captured session values;
  none were found. RWA business database SHA-256 stayed unchanged. Cleanup was
  recorded and only the test's local session reference was forgotten after logout.
- Visual checks at 1440×900, 1200×900 and 390×844 passed. Narrow coverage uses an
  explicitly labelled, focusable horizontal table with readable columns and no
  document overflow; styling is scoped to Dynamic. Screenshots and acceptance
  metadata remain in ignored root/sidecar `output/playwright/` directories.
- Coverage is versioned derived data over the frozen Run inputs/results, not a
  mutable mapping to the latest source. Versioned report retention/sharing belongs
  to M5. Richer observations/action policies/exploration/regression, usability,
  unit-run integration and release/isolation evaluation remain M4–M7. API-provider
  live acceptance remains user-deferred for this release.
