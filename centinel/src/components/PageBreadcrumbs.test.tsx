import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getBreadcrumbItems, PageBreadcrumbs } from './PageBreadcrumbs';
import type { Project, Screen } from '../types';

const project: Project = {
  id: 'project-1',
  name: 'A very long project name that still needs to remain accessible',
  description: '',
  workspacePath: 'C:/work/project-1',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

describe('PageBreadcrumbs', () => {
  it('builds route-aware trails for the shell screens', () => {
    const cases: Array<[Screen, string[]]> = [
      [{ name: 'dashboard' }, ['Home', 'Dashboard']],
      [{ name: 'projects' }, ['Home', 'Projects']],
      [{ name: 'project-detail', projectId: project.id }, ['Home', 'Projects', project.name]],
      [{ name: 'review-entry', projectId: project.id }, ['Home', 'Review', 'Start your review']],
      [{ name: 'review-activity', projectId: project.id, sessionId: 'review-1' }, ['Home', 'Review', 'Review activity']],
      [{ name: 'dynamic-session', projectId: project.id, sessionId: 'test-1' }, ['Home', 'Dynamic Testing', 'Test run']],
      [{ name: 'evidence-browser', projectId: project.id }, ['Home', 'Dynamic Testing', 'Evidence']],
      [{ name: 'requirements', projectId: project.id }, ['Home', 'Review', 'Requirements']],
      [{ name: 'settings' }, ['Home', 'Settings']],
    ];

    for (const [screenState, labels] of cases) {
      expect(getBreadcrumbItems(screenState, [project]).map(item => item.label)).toEqual(labels);
    }
  });

  it('keeps ancestor navigation actionable and exposes the current page', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <PageBreadcrumbs
        screen={{ name: 'project-detail', projectId: project.id }}
        projects={[project]}
        onNavigate={onNavigate}
      />,
    );

    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('title', 'Home');
    await user.click(home);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'dashboard' });
    expect(screen.getByTitle(project.name)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTitle(project.name)).toHaveTextContent(project.name);
  });

  it('keeps sidebar controls in the navigation panel header', () => {
    render(
      <PageBreadcrumbs
        screen={{ name: 'dashboard' }}
        projects={[]}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
  });
});
