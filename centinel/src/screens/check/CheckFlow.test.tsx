import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { listChecks, resetCheckStore, saveCheck } from '../../check/store';
import type { AiProviderSetting, Artifact, Screen, StaticSession } from '../../types';
import { CheckScreen } from './CheckScreen';
import { StartScreen } from './StartScreen';

vi.mock('../../api/client', () => ({ api: {
  listArtifacts: vi.fn(), listConnectedSources: vi.fn(), listStaticSessions: vi.fn(), autoTests: vi.fn(),
  listRequirements: vi.fn(), createStaticSession: vi.fn(), getStaticSession: vi.fn(),
  listStaticFindings: vi.fn(), getReviewHarness: vi.fn(), startAutoTest: vi.fn(),
} }));

const project = { id: 'shop', name: 'Fixture shop', description: '', workspacePath: '', createdAt: '', updatedAt: '' };
const projects = [project];
const settings = [{ id: 'text', provider: 'codex', model: 'gpt-5', hasApiKey: false }] as AiProviderSetting[];
const artifacts = ['orders', 'catalog'].map(id => ({
  id, projectId: project.id, fileName: id + '.js', filePath: 'src/' + id + '.js', type: 'source_code',
} as Artifact));

function Workspace() {
  const [route, navigate] = useState<Screen>({ name: 'new-check' });
  return route.name === 'check'
    ? <CheckScreen key={route.checkId} checkId={route.checkId} projects={projects} onNavigate={navigate} />
    : <StartScreen projects={projects} aiSettings={settings} onNavigate={navigate} onProjectCreated={vi.fn()} onCreateProject={vi.fn()} />;
}

beforeEach(() => {
  resetCheckStore();
  vi.resetAllMocks();
  vi.mocked(api.listArtifacts).mockResolvedValue(artifacts);
  vi.mocked(api.listConnectedSources).mockResolvedValue([]);
  vi.mocked(api.listStaticSessions).mockResolvedValue([]);
  vi.mocked(api.autoTests).mockResolvedValue([]);
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.listStaticFindings).mockResolvedValue([]);
  vi.mocked(api.getReviewHarness).mockResolvedValue(null as never);
  vi.mocked(api.getStaticSession).mockImplementation(async (projectId, id) => ({
    id, projectId, status: 'completed', progressJson: '{}', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }) as StaticSession);
});

it('carries a recent-check reference into a result and a library selection into its follow-up Review', async () => {
  saveCheck({
    id: 'prior', projectId: project.id, projectName: project.name, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    mode: 'code', phase: 'done', focus: '', documents: [], notes: [],
  });
  vi.mocked(api.createStaticSession).mockResolvedValueOnce({ id: 'first' } as StaticSession).mockResolvedValueOnce({ id: 'second' } as StaticSession);
  const user = userEvent.setup();
  render(<Workspace />);
  await user.type(screen.getByRole('textbox'), 'Review checkout @Fixture');
  const recent = within(screen.getByRole('region', { name: 'Recent Checks' }));
  await user.click(recent.getByRole('button', { name: /Fixture shop/ }));
  await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
  await user.click(screen.getByRole('option', { name: 'Code' }));
  await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));

  await screen.findByRole('navigation', { name: 'Referenced checks' });
  await waitFor(() => expect(listChecks()[0]).toMatchObject({ reviewId: 'first', phase: 'done', referenceCheckIds: ['prior'] }));
  const firstCheck = listChecks()[0].id;
  expect(api.createStaticSession).toHaveBeenNthCalledWith(1, project.id, expect.objectContaining({
    instructions: 'Review checkout', artifactIds: ['orders', 'catalog'], scopeMode: 'full',
  }));

  await user.click(screen.getByRole('button', { name: 'Add to check' }));
  const add = within(screen.getByRole('dialog', { name: 'Add to check' }));
  await user.click(await add.findByRole('button', { name: 'src/orders.js' }));
  expect(screen.getByRole('button', { name: 'Remove source orders.js' })).toBeInTheDocument();
  const followUp = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(followUp, 'Review order totals @Fixture');
  const mentions = within(screen.getByRole('region', { name: 'Recent Checks' }));
  await user.click(mentions.getByRole('button', { name: 'Fixture shop' }));
  expect(followUp).toHaveValue('Review order totals ');
  expect(screen.getByRole('button', { name: 'Remove check Fixture shop' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

  await waitFor(() => expect(listChecks()[0]).toMatchObject({ reviewId: 'second', phase: 'done', referenceCheckIds: [firstCheck, 'prior'], sourceArtifactIds: ['orders'] }));
  expect(api.createStaticSession).toHaveBeenNthCalledWith(2, project.id, expect.objectContaining({
    instructions: 'Review order totals', artifactIds: ['orders'], scopeMode: 'focused',
  }));
  expect(api.startAutoTest).not.toHaveBeenCalled();
});

it('preserves the draft and library selection when switching to an incompatible mode', async () => {
  const localProject = { ...project, workspacePath: '/fixture/shop' };
  saveCheck({
    id: 'prior', projectId: project.id, projectName: project.name, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    mode: 'both', phase: 'done', focus: '', documents: [], notes: [],
  });
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<CheckScreen checkId="prior" projects={[localProject]} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: 'Add to check' }));
  await user.click(await within(screen.getByRole('dialog', { name: 'Add to check' })).findByRole('button', { name: 'src/orders.js' }));
  const draft = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(draft, 'Review order totals');
  await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
  await user.click(screen.getByRole('option', { name: 'Browser' }));

  const send = screen.getByRole('button', { name: 'Send follow-up' });
  expect(send).toBeDisabled();
  expect(draft).toHaveValue('Review order totals');
  expect(screen.getByText(/remove the attached library files/)).toBeInTheDocument();
  expect(api.createStaticSession).not.toHaveBeenCalled();
  expect(api.startAutoTest).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Remove source orders.js' }));
  expect(send).toBeEnabled();
  expect(draft).toHaveValue('Review order totals');
});

it('starts a fresh draft for another project selected from a follow-up mention', async () => {
  const otherProject = { ...project, id: 'other', name: 'Other shop' };
  saveCheck({
    id: 'current', projectId: project.id, projectName: project.name, createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z', mode: 'code', phase: 'done', focus: '', documents: [], notes: [],
  });
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(<CheckScreen checkId="current" projects={[project, otherProject]} onNavigate={navigate} />);

  const prompt = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(prompt, 'Check checkout @');
  const menu = screen.getByRole('dialog', { name: 'Add to check' });
  expect(within(menu).getByRole('button', { name: 'Add Document' })).toHaveAttribute('data-mention-active');
  expect(prompt).toHaveFocus();
  await user.keyboard('Other{Enter}');
  expect(navigate).toHaveBeenCalledWith({ name: 'new-check', draft: {
    projectId: 'other', focus: 'Check checkout ', mode: 'code', documents: [],
  } });
  expect(api.createStaticSession).not.toHaveBeenCalled();
});
