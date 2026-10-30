# Dynamic incoming-context development stub

Status: M3 mock consumer, editable Mission UI and frozen criterion coverage implemented and verified on 14 October 2026. Real Static export remains excluded. See [M3 implementation and acceptance](DYNAMIC_CONTEXT_COVERAGE.md).

This simulates Static sending context to Dynamic. It does not scan sources, call
an LLM, persist a Review, authenticate a user or invent an application verdict.
Static implementation is outside the [Dynamic development plan](../DEVELOPMENT_PLAN.md).
The whole-product PRD remains unchanged.

## Usage and boundary

Implementation: [staticContextStub.ts](../../sidecar/src/dynamic/testing/staticContextStub.ts).

```ts
import { createStaticContextStub } from './dynamic/testing/staticContextStub';

const incomingContext = createStaticContextStub('normal');
const snapshot = await incomingContext.load(projectId);
// P1/P3: inject this source into the mission-creation consumer explicitly.
// Preserve snapshot.provenance and the selected criterion IDs with the Run.
```

`IncomingContextSource.load(projectId)` returns a fresh JSON-serializable snapshot
or `null`. The current TypeScript interface is a proposed consumer DTO, not a
claim that an existing Review endpoint exports that shape. The new Mission authoring route can explicitly load a fixture via
`contextScenario`. The Mission Run pins that snapshot while the browser bridge
uses the configured checks. No mock mode is automatically activated on a service
error. Existing legacy session routes remain compatible. See the
[foundation interface](DYNAMIC_MISSION_RUN_FOUNDATION.md).

| Input | Purpose |
| --- | --- |
| `normal` | Two synthetic requirements: seeded sign-in/sign-out and payment validation/history |
| `stale` | A versioned source explicitly marked stale |
| `conflicting` | Contradictory payment-note expectations that the consumer must expose |
| `unapproved` | Pending context requiring an attributable decision before use |
| `incomplete` | Missing payment criteria and unknown source currency |
| `absent` | No incoming context; manual missions remain available |

All non-null snapshots include `schemaVersion: 1`, `provenance: "mock-static"`,
project ID, `mock-*` Review/snapshot/source IDs, source version/currency,
requirements with revision and criterion IDs, synthetic priority hints,
conflicts, limitations and the pinned evaluation repository commit. Deployment
version remains unknown. Mock approval is test data, never a real human decision.

The stub's caller supplies a project ID for fixture reuse; this is not a membership
check. It creates no durable foreign keys. Future persistence must distinguish
synthetic IDs from real Review references and validate project access/references
at the consumer boundary. Cross-project and dangling-reference negative tests
belong there when it exists, not in a fake authorization service.

## Consumer acceptance and remaining work

1. Load a fixture, select criteria, create an editable mission and pin its snapshot.
2. Map natural-language criteria to explicit browser checks; the fixture itself
   does not implement a checker or establish passing behavior.
3. Execute on the actual local target. Use real browser observations/evidence;
   never supply fake passes or fabricated screenshots.
4. Preserve mock provenance in mission history, coverage and report snapshots.
5. Handle missing/stale/conflicting/pending input visibly. Retain earlier results
   when revisions change; never apply an old pass to an updated criterion.
6. Later replace the injected source with a separately verified real adapter.
   A service failure must remain a failure rather than silently switching to mock.

Fixture and Mission tests verify reference consistency, scenario contents, JSON
serialization, project binding, independent copies, absence handling, Mission
authoring and scoped API access. The scripted real-browser baseline verifies
criterion outcomes with explicit mock provenance. Coverage UI is implemented through M3; real Static integration remains excluded
and versioned report retention/sharing remains M5.
