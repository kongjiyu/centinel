import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import {
  extractRequirementCandidates,
  InMemoryGroundingRepository,
  ingestStandardRules,
  parseRequirementCandidateDrafts,
  parseStandardRules,
} from '../../src/review/grounding.js';
import { assessEvidenceSufficiency, type EvidenceSufficiencyInput } from '../../src/review/evidenceSufficiency.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';

const requirementArtifact: Artifact = {
  id: 'req-artifact', projectId: 'project-a', type: 'requirement', source: 'documents',
  fileName: 'requirements.md', filePath: 'requirements.md', originalPath: null,
  contentHash: 'req-hash-v1', createdAt: '2026-09-21T00:00:00.000Z',
};

const codeArtifact: Artifact = {
  id: 'code-artifact', projectId: 'project-a', type: 'source_code', source: 'repository',
  fileName: 'auth.ts', filePath: 'src/auth.ts', originalPath: 'src/auth.ts',
  contentHash: 'code-hash-v1', createdAt: '2026-09-21T00:00:00.000Z',
};

describe('Phase 2 requirement and standards grounding', () => {
  it('keeps extracted requirement and acceptance-criterion outputs pending human confirmation', async () => {
    const parsed = parseRequirementCandidateDrafts('project-a', requirementArtifact, 'rev-1', {
      requirements: [
        { title: 'Authentication required', statement: 'Every protected route requires an authenticated user.', confidence: 0.91, sourceLocator: { lineStart: 4 } },
        { title: 'Duplicate', statement: 'Every protected route requires an authenticated user.' },
      ],
      acceptanceCriteria: ['Unauthenticated requests receive a 401 response.'],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ kind: 'requirement', sourceVersion: 'rev-1', confidence: 0.91, sourceLocator: { lineStart: 4 } });
    expect(parsed[1].kind).toBe('acceptance_criterion');
    const secondSource = parseRequirementCandidateDrafts('project-a', { ...requirementArtifact, id: 'req-artifact-2' }, 'rev-1', {
      requirements: [{ statement: 'Every protected route requires an authenticated user.' }],
    });
    expect(secondSource[0].fingerprint).not.toBe(parsed[0].fingerprint);

    const repository = new InMemoryGroundingRepository();
    const provider = {
      analyze: async () => ({
        result: { requirements: [{ statement: 'Stored candidates require an explicit human confirmation step.' }] },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'test' },
      }),
    };
    const saved = await extractRequirementCandidates({ projectId: 'project-a', artifact: requirementArtifact, content: '...', sourceVersion: 'rev-1' }, provider, repository);
    expect(saved[0].status).toBe('pending_confirmation');
    expect(await repository.listConfirmedRequirements('project-a')).toEqual([]);
    const confirmed = await repository.confirmRequirementCandidate(saved[0].id, 'reviewer-1');
    expect(confirmed.sourceCandidateId).toBe(saved[0].id);
    expect((await repository.listRequirementCandidates('project-a'))[0]).toMatchObject({ status: 'confirmed', confirmedBy: 'reviewer-1' });
  });

  it('parses normative standard rules with stable IDs, source locations, versions, and enabled state', async () => {
    const standardArtifact = { ...requirementArtifact, id: 'standard-artifact', type: 'coding_standard' as const, fileName: 'CODE_STANDARD.md', filePath: 'CODE_STANDARD.md', contentHash: 'standard-hash' };
    const content = '# API Standard\nVersion: 4.2\n\nAll handlers must validate ownership before returning private data.\n\nExplanatory note without a normative keyword.';
    const first = parseStandardRules({ artifact: standardArtifact, content });
    const second = parseStandardRules({ artifact: standardArtifact, content });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ standardVersion: '4.2', sourceVersion: 'standard-hash', enabled: true, sourceLocator: { lineStart: 4, section: 'API Standard' } });
    expect(first[0].stableKey).toBe(second[0].stableKey);

    const repository = new InMemoryGroundingRepository();
    const [stored] = await ingestStandardRules({ projectId: 'project-a', artifact: standardArtifact, content }, repository);
    await repository.setStandardRuleEnabled(stored.id, false);
    const repeated = await ingestStandardRules({ projectId: 'project-a', artifact: standardArtifact, content }, repository);
    expect(repeated[0]).toMatchObject({ id: stored.id, enabled: false, standardVersion: '4.2' });
    const revised = await ingestStandardRules({
      projectId: 'project-a', artifact: { ...standardArtifact, contentHash: 'standard-hash-v2' },
      content: content.replace('4.2', '4.3'), sourceVersion: 'standard-hash-v2',
    }, repository);
    expect(revised[0]).toMatchObject({ standardVersion: '4.3', sourceVersion: 'standard-hash-v2', enabled: true });
    expect(revised[0].id).not.toBe(stored.id);
    expect((await repository.listStandardRules('project-a')).map(item => item.id)).toEqual([revised[0].id]);
  });
});

function evidenceInput(overrides: Partial<EvidenceSufficiencyInput> = {}): EvidenceSufficiencyInput {
  return {
    reviewId: 'review-1', projectId: 'project-a', reviewType: 'code_review',
    artifacts: [{ artifact: codeArtifact, content: 'The service validates ownership before returning account data.' }],
    now: new Date('2026-09-21T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deterministic evidence sufficiency', () => {
  it('returns ready for sufficient frozen code evidence', () => {
    expect(assessEvidenceSufficiency(evidenceInput()).readiness).toBe('ready');
  });

  it('blocks missing required evidence and unavailable selected sources', () => {
    const missing = assessEvidenceSufficiency(evidenceInput({ artifacts: [{ artifact: requirementArtifact, content: 'Requirement evidence.' }] }));
    expect(missing.readiness).toBe('blocked');
    expect(missing.gaps.map(item => item.code)).toContain('required_artifact_type_missing');

    const inaccessible = assessEvidenceSufficiency(evidenceInput({ artifacts: [{ artifact: codeArtifact, state: 'inaccessible', detail: 'Access denied.' }] }));
    expect(inaccessible.readiness).toBe('blocked');
    expect(inaccessible.gaps.map(item => item.code)).toContain('source_inaccessible');
  });

  it('reports contradictory claims as a blocking gap and stale evidence as a warning', () => {
    const contradictory = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'claim-a', text: 'All API requests must require user authentication.' },
      { id: 'claim-b', text: 'All API requests must not require user authentication.' },
    ] }));
    expect(contradictory.readiness).toBe('blocked');
    expect(contradictory.contradictions).toHaveLength(1);
    const dispositioned = assessEvidenceSufficiency(evidenceInput({
      claims: [
        { id: 'claim-a', text: 'All API requests must require user authentication.' },
        { id: 'claim-b', text: 'All API requests must not require user authentication.' },
      ],
      dispositions: [{
        contradictionId: contradictory.contradictions[0].id,
        decision: 'authoritative_left', rationale: 'The approved security standard requires sign-in.',
        actorId: 'reviewer-1', updatedAt: '2026-09-23T00:00:00Z',
      }],
    }));
    expect(dispositioned.readiness).toBe('ready');
    expect(dispositioned.gaps.some(item => item.code === 'contradictory_evidence')).toBe(false);
    expect(dispositioned.contradictions[0].disposition?.decision).toBe('authoritative_left');
    const stateContradiction = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'enabled', text: 'The audit feature is enabled for every user account.' },
      { id: 'disabled', text: 'The audit feature is disabled for every user account.' },
    ] }));
    expect(stateContradiction.contradictions).toHaveLength(1);

    const stale = assessEvidenceSufficiency(evidenceInput({ artifacts: [{ artifact: codeArtifact, state: 'stale', detail: 'Remote revision advanced.', content: 'The current frozen revision is readable.' }] }));
    expect(stale.readiness).toBe('ready_with_warnings');
    expect(stale.gaps.map(item => item.code)).toContain('source_stale');
  });

  it('flags incompatible numeric bounds as a possible conflict without treating stricter compatible bounds as a conflict', () => {
    const conflict = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'minimum-timeout', text: 'The account timeout must be at least 10 seconds.' },
      { id: 'maximum-timeout', text: 'The account timeout must be at most 5 seconds.' },
    ] }));
    expect(conflict.readiness).toBe('blocked');
    expect(conflict.contradictions).toHaveLength(1);
    expect(conflict.contradictions[0].detail).toContain('reviewer must confirm');

    const compatible = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'maximum-ten', text: 'The account timeout must be at most 10 seconds.' },
      { id: 'maximum-five', text: 'The account timeout must be at most 5 seconds.' },
      { id: 'other-subject', text: 'The session duration must be at least 20 seconds.' },
    ] }));
    expect(compatible.contradictions).toHaveLength(0);

    const percentage = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'minimum-coverage', text: 'The branch coverage must be at least 90%.' },
      { id: 'maximum-coverage', text: 'The branch coverage must be at most 80%.' },
    ] }));
    expect(percentage.contradictions).toHaveLength(1);
  });

  it('flags explicit opposing action order while ignoring compatible and ambiguous timing claims', () => {
    const opposite = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'validate-first', text: 'The service must validate user identity before reading private account records.' },
      { id: 'validate-later', text: 'The service must validate user identity after reading private account records.' },
    ] }));
    expect(opposite.readiness).toBe('blocked');
    expect(opposite.contradictions).toHaveLength(1);
    expect(opposite.contradictions[0].detail).toContain('incompatible ordering');
    expect(opposite.contradictions[0].detail).toContain('reviewer must confirm');

    const compatible = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'validate-before', text: 'The service must validate user identity before reading private account records.' },
      { id: 'read-after', text: 'Reading private account records must occur after validating user identity.' },
      { id: 'other-actions', text: 'The service must record audit events after updating public project metadata.' },
      { id: 'ambiguous', text: 'The service must validate user identity before reading records and after opening the session.' },
    ] }));
    expect(compatible.contradictions).toHaveLength(0);
  });

  it.each([
    {
      label: 'explicit presence state',
      left: 'The recovery code must be present in every account record.',
      right: 'The recovery code must be absent in every account record.',
      conflict: true,
    },
    {
      label: 'explicit access state',
      left: 'Guest users must be allowed access to public project records.',
      right: 'Guest users must be blocked from access to public project records.',
      conflict: true,
    },
    {
      label: 'equivalent time limits in different units',
      left: 'The account timeout must be exactly 1 second.',
      right: 'The account timeout must be exactly 1000 milliseconds.',
      conflict: false,
    },
    {
      label: 'incompatible time limits in different units',
      left: 'The account timeout must be at least 2 seconds.',
      right: 'The account timeout must be at most 1500 milliseconds.',
      conflict: true,
    },
    {
      label: 'different deployment context',
      left: 'The recovery code must be present in every production account record.',
      right: 'The recovery code must be absent in every staging account record.',
      conflict: false,
    },
    {
      label: 'different subject',
      left: 'Guest users must be allowed access to public project records.',
      right: 'Admin users must be blocked from access to private project records.',
      conflict: false,
    },
  ])('evaluates a representative $label pair conservatively', ({ left, right, conflict }) => {
    const result = assessEvidenceSufficiency(evidenceInput({ claims: [
      { id: 'claim-left', text: left }, { id: 'claim-right', text: right },
    ] }));
    expect(result.contradictions).toHaveLength(conflict ? 1 : 0);
    if (conflict) {
      expect(result.readiness).toBe('blocked');
      expect(result.contradictions[0].detail).toContain('reviewer must confirm');
    }
  });

  it('retains cross-artifact provenance and stable identity for an ordering conflict', () => {
    const artifacts = [
      { artifact: requirementArtifact, content: '# Account access\nThe service must validate user identity before reading private account records.' },
      {
        artifact: { ...requirementArtifact, id: 'standard-artifact', type: 'coding_standard' as const, filePath: 'standards/account.md' },
        content: '# Account policy\nThe service must validate user identity after reading private account records.',
      },
    ];
    const input = evidenceInput({ reviewType: 'cross_artifact_consistency', artifacts });
    const first = assessEvidenceSufficiency(input);
    const repeated = assessEvidenceSufficiency(input);
    expect(first.readiness).toBe('blocked');
    expect(first.contradictions).toHaveLength(1);
    expect(first.contradictions[0].id).toBe(repeated.contradictions[0].id);
    expect([first.contradictions[0].left.locator?.filePath, first.contradictions[0].right.locator?.filePath].sort())
      .toEqual(['requirements.md', 'standards/account.md']);
    expect(first.contradictions[0].left.locator?.lineStart).toBe(2);
    expect(first.contradictions[0].right.locator?.lineStart).toBe(2);
    const reordered = assessEvidenceSufficiency(evidenceInput({ ...input, artifacts: [...artifacts].reverse() }));
    expect(reordered.contradictions[0].id).toBe(first.contradictions[0].id);
    expect(reordered.contradictions[0].left.id).toBe(first.contradictions[0].left.id);
    expect(reordered.contradictions[0].right.id).toBe(first.contradictions[0].right.id);
  });
});

describe('grounding in Model Provider static analysis', () => {
  it('injects confirmed requirements and enabled standards, then validates model citations before persistence', async () => {
    const grounding = new InMemoryGroundingRepository();
    const candidate = (await grounding.saveRequirementCandidates([{
      projectId: 'project-a', kind: 'requirement', title: 'Tenant isolation',
      statement: 'Account reads must be limited to the active tenant.',
      sourceLocator: { artifactId: requirementArtifact.id, filePath: requirementArtifact.filePath, lineStart: 7 },
      sourceVersion: 'req-v1', confidence: 0.95, fingerprint: 'tenant-requirement-fingerprint',
    }]))[0];
    const requirement = await grounding.confirmRequirementCandidate(candidate.id, 'reviewer-1');
    const standardArtifact = { ...requirementArtifact, id: 'standard-source', type: 'coding_standard' as const, fileName: 'API.md', filePath: 'standards/API.md', contentHash: 'standard-v1' };
    const [rule] = await ingestStandardRules({
      projectId: 'project-a', artifact: standardArtifact,
      content: '# API\nVersion: 1.0\n\nHandlers must validate tenant ownership before returning private data.',
    }, grounding);
    const repository = new InMemoryStaticReviewRepository();
    const prompts: string[] = [];
    const model: StaticAnalysisModelProvider = {
      analyze: async request => {
        prompts.push(request.prompt);
        return {
          result: { findings: [
            { title: 'Tenant validation missing', description: 'The handler returns data without ownership validation.', severity: 'high', category: 'security', filePath: codeArtifact.filePath, lineNumber: 12, evidence: 'return account before validation', recommendation: 'Validate tenant ownership.', confidence: 'high', requirementId: requirement.id, standardId: rule.standardId, standardRuleId: rule.id, sourceLocator: { filePath: 'invented/path', lineStart: 999 } },
            { title: 'Untrusted standard citation', severity: 'medium', category: 'security', filePath: codeArtifact.filePath, lineNumber: 15, evidence: 'unverified', recommendation: 'Review.', confidence: 'medium', requirementId: 'invented-requirement', standardId: 'invented-standard', standardRuleId: 'invented-rule' },
          ] },
          settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' },
        };
      },
    };
    const orchestrator = createStaticReviewOrchestrator({
      repository, groundingRepository: grounding, modelProvider: model,
      modelMetadata: async () => ({ provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' }),
      deterministic: async () => [],
      artifacts: async () => [codeArtifact],
      readArtifactContent: async () => 'The handler returns private account data.',
    });
    const started = await orchestrator.start({
      projectId: 'project-a', reviewType: 'general_review', artifacts: [codeArtifact],
      scope: { requirementIds: [requirement.id], standardIds: [rule.standardId] },
    });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(prompts[0]).toContain(`requirementId=${requirement.id}`);
    expect(prompts[0]).toContain(`standardRuleId=${rule.id}`);
    expect(repository.findings[0]).toMatchObject({ requirementId: requirement.id, standardId: rule.standardId, standardRuleId: rule.id, sourceLocator: { filePath: 'standards/API.md', lineStart: 4, standardVersion: '1.0' } });
    expect(repository.findings[1]).toMatchObject({ requirementId: null, standardId: null, standardRuleId: null, sourceLocator: null });
    expect(repository.audits.some(event => event.event === 'model_grounding_references_rejected')).toBe(true);
  });
});
