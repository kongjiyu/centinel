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
    case 'profile': return '#profile';
  }
}

/** Build the shell's semantic route trail without coupling it to a router. */
export function getBreadcrumbItems(screen: Screen, projects: Project[]): BreadcrumbItem[] {
  const product: BreadcrumbItem = { label: 'Product', target: { name: 'dashboard' } };
  const projectsItem: BreadcrumbItem = { label: 'Projects', target: { name: 'projects' } };

  switch (screen.name) {
    case 'dashboard':
      return [product, { label: 'Home' }];
    case 'projects':
      return [product, { label: 'Projects' }];
    case 'project-detail': {
      const project = projectLabel(projects, screen.projectId);
      const trail: BreadcrumbItem[] = [product, projectsItem, { label: project }];
      if (screen.initialAction === 'static') trail.push({ label: 'Review setup' });
      if (screen.initialAction === 'dynamic') trail.push({ label: 'Dynamic Testing setup' });
      return trail;
    }
    case 'review-entry':
      return [{ label: 'Activities' }, { label: 'Review' }];
    case 'review-activity': {
      const project = projectLabel(projects, screen.projectId);
      return [
        product,
        projectsItem,
        { label: project, target: { name: 'project-detail', projectId: screen.projectId } },
        { label: 'Review', target: { name: 'review-entry', projectId: screen.projectId } },
        { label: screen.reviewName || 'Review' },
      ];
    }
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
