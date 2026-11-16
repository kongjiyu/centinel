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
      [{ name: 'dashboard' }, ['Details', 'Overview']],
      [{ name: 'projects' }, ['Details', 'Projects']],
      [{ name: 'project-detail', projectId: project.id }, ['Details', 'Projects', project.name]],
      [{ name: 'review-entry', projectId: project.id }, ['Activities', 'Review']],
      [{ name: 'review-activity', projectId: project.id, sessionId: 'review-1', reviewName: 'Release review' }, ['Details', 'Projects', project.name, 'Review', 'Release review']],
      [{ name: 'dynamic-session', projectId: project.id, sessionId: 'test-1' }, ['Details', 'Dynamic Testing', 'Test run']],
      [{ name: 'evidence-browser', projectId: project.id }, ['Details', 'Dynamic Testing', 'Evidence']],
      [{ name: 'requirements', projectId: project.id }, ['Details', 'Review', 'Requirements']],
      [{ name: 'settings' }, ['Settings']],
      [{ name: 'help' }, ['Settings', 'Help']],
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

    const product = screen.getByRole('link', { name: 'Details' });
    expect(product).toHaveAttribute('title', 'Details');
    await user.click(product);
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
