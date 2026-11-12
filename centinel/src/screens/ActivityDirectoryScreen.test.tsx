import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { Project, StaticSession } from '../types';
import { ActivityDirectoryScreen } from './ActivityDirectoryScreen';

vi.mock('../api/client', () => ({ api: { listStaticSessions: vi.fn(), listDynamicSessions: vi.fn(), dynamicRuns: vi.fn(), dynamicMissions: vi.fn() } }));
const date = '2026-11-10T12:00:00Z';
const projects: Project[] = ['North Shop', 'South Shop'].map((name, index) => ({
  id: `project-${index}`, name, description: '', workspacePath: '', createdAt: date, updatedAt: date,
}));

it('lists reviews across projects and searches by either name', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  vi.mocked(api.listStaticSessions).mockImplementation(async projectId => [{
    id: `review-${projectId}`, name: projectId === 'project-0' ? 'Checkout review' : 'Inventory review',
    status: 'approved', projectId, createdAt: date, updatedAt: date,
  } as StaticSession]);
  render(<ActivityDirectoryScreen kind="review" projects={projects} onNavigate={navigate} />);
  expect(screen.getByRole('status', { name: 'Loading reviews' })).toHaveAttribute('aria-busy', 'true');
  const table = await screen.findByRole('table', { name: 'Reviews' });
  expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading reviews' })).not.toBeInTheDocument();
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  const search = screen.getByRole('searchbox', { name: 'Search by project or review' });
  await user.type(search, 'south');
  expect(within(table).queryByText('Checkout review')).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'checkout');
  expect(within(table).queryByText('Inventory review')).not.toBeInTheDocument();
  const row = within(table).getByRole('row', { name: 'Open Checkout review in North Shop' });
  expect(within(row).queryByRole('link', { name: 'Checkout review' })).not.toBeInTheDocument();
  await user.click(within(row).getByRole('link', { name: 'North Shop' }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ name: 'project-detail', projectId: 'project-0' });
  navigate.mockClear();
  row.focus();
  await user.keyboard('{Enter}');
  expect(navigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: 'project-0', sessionId: 'review-project-0', reviewName: 'Checkout review' });
});

it('opens a saved Dynamic test that has never been run', async () => {
  const navigate = vi.fn();
  vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
  vi.mocked(api.dynamicRuns).mockResolvedValue([]);
  vi.mocked(api.dynamicMissions).mockResolvedValue([{
    id: 'mission-1', projectId: projects[0].id, currentRevisionId: 'revision-1',
    createdBy: 'owner', createdAt: date, displayName: 'Sign-in smoke',
  }]);
  render(<ActivityDirectoryScreen kind="dynamic" projects={[projects[0]]} onNavigate={navigate} />);
  expect(screen.getByRole('status', { name: 'Loading dynamic tests' })).toHaveAttribute('aria-busy', 'true');
  const row = await screen.findByRole('row', { name: 'Open Sign-in smoke in North Shop' });
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await userEvent.click(within(row).getByText('Sign-in smoke'));
  expect(navigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: projects[0].id, missionId: 'mission-1' });
});
