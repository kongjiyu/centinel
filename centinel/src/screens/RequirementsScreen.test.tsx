import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { Artifact, RequirementCandidate, StandardRule } from '../types';
import { RequirementsScreen } from './RequirementsScreen';

vi.mock('../api/client', () => ({
  api: {
    listRequirements: vi.fn(),
    listArtifacts: vi.fn(),
    listRequirementCandidates: vi.fn(),
    extractRequirementCandidates: vi.fn(),
    confirmRequirementCandidate: vi.fn(),
    rejectRequirementCandidate: vi.fn(),
    listStandardRules: vi.fn(),
    ingestStandardRules: vi.fn(),
    setStandardRuleEnabled: vi.fn(),
    createRequirement: vi.fn(),
    updateRequirement: vi.fn(),
    deleteRequirement: vi.fn(),
    mapRequirement: vi.fn(),
    listRequirementMappings: vi.fn(),
  },
}));

const artifacts: Artifact[] = [
  { id: 'requirements-doc', projectId: 'project-1', type: 'requirement', source: 'documents', fileName: 'requirements.md', filePath: 'artifacts/requirements.md', originalPath: null, contentHash: 'req-hash', createdAt: '2026-09-22T00:00:00.000Z' },
  { id: 'standards-doc', projectId: 'project-1', type: 'coding_standard', source: 'documents', fileName: 'coding-standard.md', filePath: 'artifacts/coding-standard.md', originalPath: null, contentHash: 'std-hash', createdAt: '2026-09-22T00:00:00.000Z' },
];

const candidate: RequirementCandidate = {
  id: 'candidate-1', projectId: 'project-1', kind: 'requirement', title: 'Require MFA', statement: 'Administrators must use multi-factor authentication.',
  sourceLocator: { artifactId: 'requirements-doc', filePath: 'requirements.md', lineStart: 12 }, sourceVersion: 'req-hash', confidence: .92,
  fingerprint: 'candidate-fingerprint', status: 'pending_confirmation', confirmedRequirementId: null, confirmedBy: null, confirmedAt: null,
  createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
};

const rule: StandardRule = {
  id: 'rule-1', projectId: 'project-1', standardId: 'standard-1', stableKey: 'no-secrets', title: 'Do not commit secrets',
  statement: 'Secrets must be loaded from an approved credential store.', category: 'security', severity: 'high', recommendation: 'Use the configured vault.',
  sourceArtifactId: 'standards-doc', sourceLocator: { artifactId: 'standards-doc', filePath: 'coding-standard.md', lineStart: 8 },
  sourceVersion: 'std-hash', standardVersion: '1.0', enabled: true, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
};

describe('RequirementsScreen grounding workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listRequirements).mockResolvedValue([]);
    vi.mocked(api.listArtifacts).mockResolvedValue(artifacts);
    vi.mocked(api.listRequirementCandidates).mockResolvedValue([candidate]);
    vi.mocked(api.listStandardRules).mockResolvedValue([rule]);
    vi.mocked(api.extractRequirementCandidates).mockResolvedValue([candidate]);
    vi.mocked(api.confirmRequirementCandidate).mockResolvedValue({ id: 'requirement-1' } as never);
    vi.mocked(api.rejectRequirementCandidate).mockResolvedValue({ ...candidate, status: 'rejected' });
    vi.mocked(api.ingestStandardRules).mockResolvedValue([rule]);
    vi.mocked(api.setStandardRuleEnabled).mockResolvedValue({ ...rule, enabled: false });
  });

  it('keeps extracted requirements non-authoritative until the reviewer confirms them', async () => {
    const user = userEvent.setup();
    render(<RequirementsScreen projectId="project-1" onNavigate={vi.fn()} />);

    expect(await screen.findByText('Require MFA')).toBeInTheDocument();
    expect(screen.getByText('pending confirmation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(api.confirmRequirementCandidate).toHaveBeenCalledWith('project-1', 'candidate-1'));
  });

  it('extracts requirement candidates from the selected artifact', async () => {
    const user = userEvent.setup();
    render(<RequirementsScreen projectId="project-1" onNavigate={vi.fn()} />);

    await user.click(await screen.findByRole('combobox', { name: 'Requirements artifact' }));
    await user.click(screen.getByRole('option', { name: 'requirements.md' }));
    await user.click(screen.getByRole('button', { name: 'Extract candidates' }));

    await waitFor(() => expect(api.extractRequirementCandidates).toHaveBeenCalledWith('project-1', 'requirements-doc'));
  });

  it('makes enabled coding standards visible and lets reviewers disable them', async () => {
    const user = userEvent.setup();
    render(<RequirementsScreen projectId="project-1" onNavigate={vi.fn()} />);

    expect(await screen.findByText('Do not commit secrets')).toBeInTheDocument();
    expect(screen.getByText('1 enabled')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api.setStandardRuleEnabled).toHaveBeenCalledWith('project-1', 'rule-1', false));
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });
});
