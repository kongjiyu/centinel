/** Development-only incoming Static context. Never fall back to this on a live error. */
export const STUB_SCENARIOS=['normal','stale','conflicting','unapproved','incomplete','absent'] as const;
export type StubScenario = typeof STUB_SCENARIOS[number];

export interface StaticContextFixture {
  schemaVersion: 1;
  /** mock-static: synthetic development input; review-snapshot: exported from a frozen Static Review. */
  provenance: 'mock-static' | 'review-snapshot';
  projectId: string;
  reviewId: string;
  snapshotId: string;
  approvalState: 'approved' | 'pending';
  sources: Array<{
    id: string;
    version: string;
    currency: 'current' | 'stale' | 'unknown';
    uri: string;
  }>;
  /** A Review snapshot may not know its repository or commit; unknown stays null. */
  target: { repository: string | null; commit: string | null; deploymentVersion: null };
  requirements: Array<{
    id: string;
    revision: number;
    description: string;
    sourceId: string;
    criteria: Array<{ id: string; description: string }>;
  }>;
  risks: Array<{ id: string; requirementId: string; priority: 'high' | 'medium'; rationale: string }>;
  conflicts: Array<{ requirementId: string; description: string }>;
  limitations: string[];
}

export interface IncomingContextSource {
  load(projectId: string): Promise<StaticContextFixture | null>;
}

/** A proposed consumer contract, not the existing Review service's export schema. */
export function createStaticContextFixture(
  projectId: string,
  scenario: StubScenario = 'normal',
): StaticContextFixture | null {
  if (!projectId.trim()) throw new Error('A project ID is required');
  if(!STUB_SCENARIOS.includes(scenario))throw new Error('Unknown mock scenario.');
  if (scenario === 'absent') return null;
  const context: StaticContextFixture = {
    schemaVersion: 1,
    provenance: 'mock-static',
    projectId,
    reviewId: 'mock-review-rwa',
    snapshotId: 'mock-snapshot-rwa-v1',
    approvalState: 'approved',
    sources: [{
      id: 'mock-source-rwa-requirements',
      version: 'fixture-v1',
      currency: 'current',
      uri: 'mock://rwa/requirements/v1',
    }],
    target: {
      repository: 'https://github.com/cypress-io/cypress-realworld-app',
      commit: '9dfcb9869533ce8a8963c556facc0d80457f9d39',
      deploymentVersion: null,
    },
    requirements: [{
      id: 'MOCK-RWA-AUTH-01', revision: 1,
      description: 'A seeded local user can sign in and then sign out.',
      sourceId: 'mock-source-rwa-requirements',
      criteria: [
        { id: 'MOCK-RWA-AUTH-01-C1', description: 'Valid seeded credentials open the authenticated application.' },
        { id: 'MOCK-RWA-AUTH-01-C2', description: 'After sign-out a protected page requires authentication.' },
      ],
    }, {
      id: 'MOCK-RWA-PAYMENT-01', revision: 1,
      description: 'A local payment submission requires an amount and note.',
      sourceId: 'mock-source-rwa-requirements',
      criteria: [
        { id: 'MOCK-RWA-PAYMENT-01-C1', description: 'An incomplete payment form cannot create a transaction.' },
        { id: 'MOCK-RWA-PAYMENT-01-C2', description: 'A valid payment includes the run-specific note in transaction history.' },
      ],
    }],
    risks: [{
      id: 'MOCK-RISK-01', requirementId: 'MOCK-RWA-PAYMENT-01', priority: 'high',
      rationale: 'Synthetic test priority: verify validation before creating local transactions; not an observed defect.',
    }],
    conflicts: [],
    limitations: ['Synthetic requirements authored for Dynamic development; no Static analysis or approval occurred.',
      'Criteria require baseline verification against the running app before evaluation; repository commit does not establish deployment version.'],
  };
  if(scenario!=='normal')context.snapshotId='mock-snapshot-rwa-'+scenario;
  switch (scenario) {
    case 'stale':
      context.sources[0].currency = 'stale';
      context.snapshotId = 'mock-snapshot-rwa-stale';
      break;
    case 'conflicting':
      context.conflicts.push({ requirementId: 'MOCK-RWA-PAYMENT-01', description: 'Synthetic conflict: an alternate source says payment notes are optional.' });
      break;
    case 'unapproved':
      context.approvalState = 'pending';
      break;
    case 'incomplete':
      context.requirements[1].criteria = [];
      context.sources[0].currency = 'unknown';
      context.limitations.push('Payment acceptance criteria were not supplied.');
      break;
  }
  return context;
}

/** Explicit injection for development/tests. No HTTP route, database writes or auth bypass. */
export function createStaticContextStub(scenario: StubScenario = 'normal'): IncomingContextSource {
  return { async load(projectId) { return createStaticContextFixture(projectId, scenario); } };
}
