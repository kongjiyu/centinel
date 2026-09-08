import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDetailScreen } from './ProjectDetailScreen';
import { api } from '../api/client';
import type { Project, Screen } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listDynamicSessions: vi.fn(),
    listStaticSessions: vi.fn(),
    listArtifacts: vi.fn(),
    listFindings: vi.fn(),
  },
}));

vi.mock('../context/ActiveReviewContext', () => ({
  useActiveReviewState: () => ({
    state: null,
    controls: {
      setExpanded: vi.fn(),
      setDismissed: vi.fn(),
      trackSession: vi.fn(),
      retry: vi.fn(),
    },
  }),
}));

const project: Project = {
  id: 'project-1',
  name: 'Website refresh',
  description: 'Office website',
  workspacePath: 'C:/work/website-refresh',
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function renderProject(onNavigate: (screen: Screen) => void = vi.fn()) {
  vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
  vi.mocked(api.listStaticSessions).mockResolvedValue([]);
  vi.mocked(api.listArtifacts).mockResolvedValue([]);
  vi.mocked(api.listFindings).mockResolvedValue([]);

  return render(<ProjectDetailScreen project={project} onNavigate={onNavigate} />);
}

describe('ProjectDetailScreen capability boundaries', () => {
  it('shows only persisted project facts and an honest unavailable settings state', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const settingsSection = screen.getByRole('heading', { name: 'Project settings' }).closest('section');
    expect(settingsSection).not.toBeNull();
    const settings = within(settingsSection as HTMLElement);
    expect(settings.getByText(project.name)).toBeInTheDocument();
    expect(settings.getByText(project.workspacePath)).toBeInTheDocument();
    expect(settings.getByText(new Date(project.createdAt).toLocaleDateString())).toBeInTheDocument();
    expect(settings.getByText('Editable project policies are not available')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('90')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Low, Medium, High, Critical')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove project' })).not.toBeInTheDocument();
  });

  it('does not represent collaborator identities or roles when the service is unavailable', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Collaborations' }));

    expect(screen.getByRole('heading', { name: 'Collaborations' })).toBeInTheDocument();
    expect(screen.getByText('Collaboration data is not connected')).toBeInTheDocument();
    expect(screen.getByText('This build does not connect to a collaboration service, so no invitations or roles are represented here.')).toBeInTheDocument();
    expect(screen.queryByText('You · Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned reviewers')).not.toBeInTheDocument();
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite collaborator' })).not.toBeInTheDocument();
  });

  it('opens Dynamic Testing setup in the shared dialog shell without a duplicate form header', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'New test' }));

    const dialog = await screen.findByRole('dialog', { name: 'New test' });
    expect(dialog).toContainElement(screen.getByLabelText('Website address'));
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Close test form' })).not.toBeInTheDocument();
    expect(dialog.querySelector('.panel-header')).not.toBeInTheDocument();
  });
});
