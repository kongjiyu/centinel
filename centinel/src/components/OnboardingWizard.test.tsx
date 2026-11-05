import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingWizard, SAMPLE_REVIEW_GOAL, readOnboarding, shouldShowOnboarding } from './OnboardingWizard';
import { api } from '../api/client';
import type { AiProviderSetting, Project } from '../types';

vi.mock('../api/client', () => ({
  api: {
    codexStatus: vi.fn(), codexLogin: vi.fn(), codexCancelLogin: vi.fn(), codexModels: vi.fn(), updateAiSetting: vi.fn(),
    prepareSampleShop: vi.fn(), createProject: vi.fn(),
    listRequirements: vi.fn(), listRequirementCandidates: vi.fn(), listArtifacts: vi.fn(),
    extractRequirementCandidates: vi.fn(), confirmRequirementCandidate: vi.fn(),
    createStaticSession: vi.fn(), saveDynamicMission: vi.fn(), startDynamicRun: vi.fn(),
    getStaticSession: vi.fn(), exportProjectReport: vi.fn(),
  },
}));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn(async () => true) }));

const codexSetting = (id: 'text' | 'vision', model: string): AiProviderSetting => ({
  id, label: id, provider: 'codex', apiFormat: 'codex-app-server', hasApiKey: false, apiKeyPreview: '', baseUrl: '', model, updatedAt: '2026-11-01T00:00:00.000Z',
});
const ready = [codexSetting('text', 'gpt-x'), codexSetting('vision', 'gpt-x')];
const sampleProject: Project = { id: 'p1', name: 'Sample Shop', description: '', workspacePath: '/home/samples/sample-shop', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' };
const candidate = (id: string, title: string) => ({
  id, projectId: 'p1', kind: 'requirement' as const, title, statement: `${title} statement`, sourceLocator: {} as never, sourceVersion: 'v1', confidence: 0.9,
  fingerprint: id, status: 'pending_confirmation' as const, confirmedRequirementId: null, confirmedBy: null, confirmedAt: null, createdAt: '', updatedAt: '',
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(api.codexStatus).mockResolvedValue({ available: true, connected: true, accountLabel: 'ada@example.com', message: '' });
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.listRequirementCandidates).mockResolvedValue([]);
});

describe('first-run visibility', () => {
  it('shows for a new account, stays hidden for existing users, and remembers dismissal per account', async () => {
    expect(shouldShowOnboarding('user-a', [])).toBe(true);
    expect(shouldShowOnboarding('user-b', [sampleProject])).toBe(false);

    const onClose = vi.fn();
    render(<OnboardingWizard accountId="user-a" projects={[]} aiSettings={ready} onNavigate={vi.fn()} onDataChanged={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onClose).toHaveBeenCalled();
    expect(readOnboarding('user-a')?.status).toBe('dismissed');
    expect(shouldShowOnboarding('user-a', [])).toBe(false);
    expect(shouldShowOnboarding('user-c', [])).toBe(true);
  });
});

describe('Connect ChatGPT step', () => {
  it('signs in with ChatGPT and saves default models for both workflows', async () => {
    vi.mocked(api.codexStatus).mockResolvedValue({ available: true, connected: true, accountLabel: 'ada@example.com', message: '' });
    vi.mocked(api.codexModels).mockResolvedValue([
      { id: 'mini', label: 'Mini', supportsImages: false, isDefault: false },
      { id: 'gpt-x', label: 'GPT X', supportsImages: true, isDefault: true },
    ]);
    const onDataChanged = vi.fn();
    render(<OnboardingWizard accountId="user-a" projects={[]} aiSettings={[]} onNavigate={vi.fn()} onDataChanged={onDataChanged} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect ChatGPT' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledTimes(2));
    expect(api.updateAiSetting).toHaveBeenCalledWith('text', expect.objectContaining({ provider: 'codex', model: 'gpt-x' }));
    expect(api.updateAiSetting).toHaveBeenCalledWith('vision', expect.objectContaining({ provider: 'codex', model: 'gpt-x' }));
    expect(onDataChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Using GPT X for Review and Dynamic Testing/)).toBeInTheDocument();
  });
});

describe('Sample Shop walkthrough', () => {
  it('creates the project, confirms requirements, starts the Review with the browser test and exports the report', async () => {
    vi.mocked(api.prepareSampleShop).mockResolvedValue({ path: '/home/samples/sample-shop', url: 'http://localhost:4100', server: 'started' });
    vi.mocked(api.createProject).mockResolvedValue(sampleProject);
    const onDataChanged = vi.fn();
    const view = render(<OnboardingWizard accountId="user-a" projects={[]} aiSettings={ready} onNavigate={vi.fn()} onDataChanged={onDataChanged} onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create Sample Shop project' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('Sample Shop', expect.any(String), '/home/samples/sample-shop', { type: 'local-repository' }));
    expect(readOnboarding('user-a')?.projectId).toBe('p1');
    view.rerender(<OnboardingWizard accountId="user-a" projects={[sampleProject]} aiSettings={ready} onNavigate={vi.fn()} onDataChanged={onDataChanged} onClose={vi.fn()} />);

    vi.mocked(api.listArtifacts).mockResolvedValue([
      { id: 'a-server', projectId: 'p1', type: 'source_code', source: 'repository', fileName: 'server.js', filePath: 'server.js', originalPath: 'server.js', contentHash: 'h1', createdAt: '' },
      { id: 'a-req', projectId: 'p1', type: 'requirement', source: 'repository', fileName: 'requirements.md', filePath: 'docs/requirements.md', originalPath: 'docs/requirements.md', contentHash: 'h2', createdAt: '' },
    ] as never);
    vi.mocked(api.listRequirementCandidates).mockResolvedValue([candidate('c1', 'Sign-in'), candidate('c2', 'Checkout')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Extract requirements' }));
    expect(api.extractRequirementCandidates).toHaveBeenCalledWith('p1', 'a-req');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Checkout/ }));
    vi.mocked(api.listRequirements).mockResolvedValue([{ id: 'r1', projectId: 'p1', title: 'Sign-in', description: '', category: '', priority: '', createdAt: '' }]);
    vi.mocked(api.listRequirementCandidates).mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 1 requirement' }));
    expect(api.confirmRequirementCandidate).toHaveBeenCalledTimes(1);
    expect(api.confirmRequirementCandidate).toHaveBeenCalledWith('p1', 'c1');

    expect(await screen.findByLabelText('What should this Review verify?')).toHaveValue(SAMPLE_REVIEW_GOAL);
    vi.mocked(api.createStaticSession).mockResolvedValue({ id: 'rev1', status: 'queued' } as never);
    vi.mocked(api.saveDynamicMission).mockResolvedValue({ id: 'rev-m1' } as never);
    vi.mocked(api.startDynamicRun).mockResolvedValue({ id: 'run1' } as never);
    vi.mocked(api.getStaticSession).mockResolvedValue({ id: 'rev1', status: 'pending_approval' } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }));
    await waitFor(() => expect(api.startDynamicRun).toHaveBeenCalled());
    expect(api.createStaticSession).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'Pre-release review', instructions: SAMPLE_REVIEW_GOAL, artifactIds: ['a-server', 'a-req'], requirementIds: ['r1'],
    }));
    expect(api.saveDynamicMission).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'Sign-in page shows the login form', targetUrl: 'http://localhost:4100',
      checks: [expect.objectContaining({ kind: 'visible_text', expected: 'Sign in', required: true })],
    }));
    expect(readOnboarding('user-a')).toMatchObject({ reviewId: 'rev1', runId: 'run1' });

    vi.mocked(api.exportProjectReport).mockResolvedValue({
      reportId: 'rep1', generatedAt: '2026-11-05T00:00:00.000Z', generatorVersion: '1', riskPolicyVersion: '1', expiresAt: null, storage: 'private-supabase',
      downloads: { json: null, markdown: null, pdf: 'https://example.test/report.pdf' }, markdown: '', checksums: {} as never,
    } as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Create report' }));
    expect(api.exportProjectReport).toHaveBeenCalledWith('p1', { reviewId: 'rev1' });
    expect(await screen.findByRole('link', { name: /Download PDF/ })).toHaveAttribute('href', 'https://example.test/report.pdf');
  });
});
