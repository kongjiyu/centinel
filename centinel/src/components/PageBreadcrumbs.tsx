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
    case 'dashboard': return '#dashboard';
    case 'projects': return '#projects';
    case 'project-detail': return `#project-${encodeURIComponent(screen.projectId)}`;
    case 'review-entry':
    case 'review-activity':
    case 'requirements': return '#review';
    case 'dynamic-session':
    case 'evidence-browser': return '#dynamic-testing';
    case 'settings': return '#settings';
  }
}

/** Build the shell's semantic route trail without coupling it to a router. */
export function getBreadcrumbItems(screen: Screen, projects: Project[]): BreadcrumbItem[] {
  const home: BreadcrumbItem = { label: 'Home', target: { name: 'dashboard' } };
  const projectsItem: BreadcrumbItem = { label: 'Projects', target: { name: 'projects' } };

  switch (screen.name) {
    case 'dashboard':
      return [home, { label: 'Dashboard' }];
    case 'projects':
      return [home, { label: 'Projects' }];
    case 'project-detail': {
      const project = projectLabel(projects, screen.projectId);
      const trail: BreadcrumbItem[] = [home, projectsItem, { label: project }];
      if (screen.initialAction === 'static') trail.push({ label: 'Review setup' });
      if (screen.initialAction === 'dynamic') trail.push({ label: 'Dynamic Testing setup' });
      return trail;
    }
    case 'review-entry':
      return [home, { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } }, { label: 'Start review' }];
    case 'review-activity':
      return [
        home,
        { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } },
        { label: 'Review activity' },
      ];
    case 'dynamic-session':
      return [
        home,
        { label: 'Dynamic Testing', target: { name: 'project-detail', projectId: screen.projectId, initialAction: 'dynamic' } },
        { label: 'Test run' },
      ];
    case 'evidence-browser':
      return [
        home,
        { label: 'Dynamic Testing', target: { name: 'project-detail', projectId: screen.projectId, initialAction: 'dynamic' } },
        { label: 'Evidence' },
      ];
    case 'requirements':
      return [
        home,
        { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } },
        { label: 'Requirements' },
      ];
    case 'settings':
      return [home, { label: 'Settings' }];
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
