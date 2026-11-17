import type { Project, Screen } from '../types';

type BreadcrumbItem = {
  label: string;
  target?: Screen;
};

type Props = {
  screen: Screen;
  projects: Project[];
  onNavigate: (screen: Screen) => void;
};

function projectLabel(projects: Project[], projectId: string): string {
  return projects.find(project => project.id === projectId)?.name || 'Project';
}

function breadcrumbHref(screen: Screen): string {
  switch (screen.name) {
    case 'new-check': return '#/new-check';
    case 'project': return `#/project?projectId=${encodeURIComponent(screen.projectId)}`;
    case 'check': return `#/check?checkId=${encodeURIComponent(screen.checkId)}`;
    case 'dashboard': return '#dashboard';
    case 'projects': return '#projects';
    case 'project-detail': return `#project-${encodeURIComponent(screen.projectId)}`;
    case 'review-directory': return '#/review-directory';
    case 'dynamic-directory': return '#/dynamic-directory';
    case 'review-entry':
    case 'review-finding':
    case 'review-activity':
    case 'reviews':
    case 'requirements': return '#review';
    case 'dynamic-testing':
    case 'dynamic-session':
    case 'evidence-browser': return '#dynamic-testing';
    case 'settings': return '#settings';
    case 'help': return '#help';
    case 'review-playground': return '#review-playground';
    case 'profile': return '#profile';
  }
}

/** Build the shell's semantic route trail without coupling it to a router. */
export function getBreadcrumbItems(screen: Screen, projects: Project[]): BreadcrumbItem[] {
  const product: BreadcrumbItem = { label: 'New Check', target: { name: 'new-check' } };

  switch (screen.name) {
    case 'new-check':
      return [{ label: 'New Check' }];
    case 'project':
      return [product, { label: projectLabel(projects, screen.projectId) }];
    case 'check':
      return [{ label: 'Checks', target: { name: 'new-check' } }, { label: 'Check' }];
    case 'dashboard':
      return [product, { label: 'Workspace details' }];
    case 'projects':
      return [product, { label: 'Projects' }];
    case 'project-detail': {
      const project = projectLabel(projects, screen.projectId);
      const trail: BreadcrumbItem[] = [product, { label: project }];
      if (screen.initialAction === 'static') trail.push({ label: 'Review setup' });
      if (screen.initialAction === 'dynamic') trail.push({ label: 'Dynamic Testing setup' });
      return trail;
    }
    case 'review-directory': return [{ label: 'Activities' }, { label: 'Reviews' }];
    case 'dynamic-directory': return [{ label: 'Activities' }, { label: 'Dynamic Testing' }];
    case 'review-entry':
      return [{ label: 'Activities' }, { label: 'Review' }];
    case 'review-finding':
    case 'review-activity': {
      const project = projectLabel(projects, screen.projectId);
      return [
        product,
        { label: project, target: { name: 'project-detail', projectId: screen.projectId } },
        { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } },
        ...(screen.name === 'review-finding'
          ? [{ label: 'Findings', target: { name: 'review-activity', projectId: screen.projectId, sessionId: screen.sessionId, reviewName: screen.reviewName, initialTab: 'Findings' } as const }, { label: 'Finding detail' }]
          : [{ label: screen.reviewName || 'Review' }]),
      ];
    }
    case 'reviews':
      return [
        product,
        { label: projectLabel(projects, screen.projectId), target: { name: 'project-detail', projectId: screen.projectId } },
        { label: 'Reviews' },
      ];
    case 'dynamic-testing':
      return screen.projectId ? [product, { label: projectLabel(projects, screen.projectId), target: { name: 'project-detail', projectId: screen.projectId } }, { label: 'Dynamic testing' }] : [{ label: 'Activities' }, { label: 'Dynamic testing' }];
    case 'dynamic-session':
      return [
        product,
        { label: 'Dynamic Testing', target: { name: 'project-detail', projectId: screen.projectId, initialAction: 'dynamic' } },
        { label: 'Test run' },
      ];
    case 'evidence-browser':
      return [
        product,
        { label: 'Dynamic Testing', target: { name: 'project-detail', projectId: screen.projectId, initialAction: 'dynamic' } },
        { label: 'Evidence' },
      ];
    case 'requirements':
      return [
        product,
        { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } },
        { label: 'Requirements' },
      ];
    case 'settings':
      return [{ label: 'Settings' }];
    case 'help':
      return [{ label: 'Settings', target: { name: 'settings' } }, { label: 'Help' }];
    case 'review-playground':
      return [{ label: 'Activities' }, { label: 'Playground' }];
    case 'profile':
      return [{ label: 'Profile' }];
  }
}

export function PageBreadcrumbs({ screen, projects, onNavigate }: Props) {
  const items = getBreadcrumbItems(screen, projects);

  return (
    <div className="page-breadcrumb-bar">
      <nav className="page-breadcrumbs" aria-label="Breadcrumb">
        <ol>
          {items.map((item, index) => {
            const isCurrent = index === items.length - 1;
            return (
              <li key={`${item.label}-${index}`}>
                {item.target && !isCurrent ? (
                  <a
                    href={breadcrumbHref(item.target)}
                    className="page-breadcrumb-link"
                    title={item.label}
                    onClick={event => {
                      event.preventDefault();
                      onNavigate(item.target!);
                    }}
                  >
                    <span className="page-breadcrumb-label">{item.label}</span>
                  </a>
                ) : (
                  <span
                    className="page-breadcrumb-current"
                    aria-current={isCurrent ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="page-breadcrumb-label">{item.label}</span>
                  </span>
                )}
                {!isCurrent && <span className="page-breadcrumb-separator" aria-hidden="true">&gt;</span>}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
