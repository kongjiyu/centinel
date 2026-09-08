import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { Project, Screen } from '../types';

const projects: Project[] = [
  {
    id: 'project-1',
    name: 'Website refresh',
    description: 'Office website',
    workspacePath: 'C:/work/website-refresh',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'project-2',
    name: 'Banking portal',
    description: 'Payment verification',
    workspacePath: 'C:/work/banking-portal',
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
];

function renderShell(screenState: Screen, onNavigate: (screen: Screen) => void, projectList = projects) {
  return render(
    <AppShell
      screen={screenState}
      onNavigate={onNavigate}
      projects={projectList}
      aiSettings={[]}
      sidecarOnline
    >
      <p>Screen content</p>
    </AppShell>,
  );
}

describe('AppShell module launch', () => {
  it('opens the dedicated Review entry flow from global navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    const reviewButton = screen.getByRole('button', { name: 'Review' });
    await user.click(reviewButton);

    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-entry' });
  });

  it('keeps Dynamic Testing in the same selection dialog and restores focus on cancel', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    const dynamicButton = screen.getByRole('button', { name: 'Dynamic Testing' });
    await user.click(dynamicButton);
    expect(await screen.findByRole('dialog', { name: 'Start Dynamic Testing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(dynamicButton).toHaveFocus());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('launches directly when the current screen has a real project context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'project-detail', projectId: 'project-2' }, onNavigate);

    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(onNavigate).toHaveBeenCalledWith({
      name: 'review-entry',
      projectId: 'project-2',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('routes to Projects when a global module has no available project', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate, []);

    await user.click(screen.getByRole('button', { name: 'Dynamic Testing' }));

    expect(onNavigate).toHaveBeenCalledWith({ name: 'projects' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
