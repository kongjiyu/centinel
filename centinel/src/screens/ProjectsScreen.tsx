import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react';
import { CommandEmptyState, CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal, type ProjectCreateSource } from '../components/ProjectCreateModal';
import { ProjectSummaryTable } from '../components/ProjectSummaryTable';
import { Select } from '../components/Select';
import { usePinnedProjects } from '../hooks/usePinnedProjects';
import {
  matchesProjectSearch,
  matchesStateFilter,
  useProjectSummaries,
  type ProjectStateFilter,
} from '../hooks/useProjectSummaries';
import type { Project, Screen } from '../types';
import './ProjectsScreen.css';

type Props = {
  projects: Project[];
  onNavigate: (screen: Screen) => void;
  onCreate: (name: string, description: string, workspacePath: string, source: ProjectCreateSource) => Promise<Project | void>;
  onDelete: (id: string) => Promise<void>;
  initialSearch?: string;
  initialStateFilter?: ProjectStateFilter;
  initialCreate?: boolean;
};

const PROJECTS_PER_PAGE = 5;

export function ProjectsScreen({
  projects,
  onNavigate,
  onCreate,
  initialSearch = '',
  initialStateFilter = 'all',
  initialCreate = false,
}: Props) {
  const [showForm, setShowForm] = useState(initialCreate);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [stateFilter, setStateFilter] = useState<ProjectStateFilter>(initialStateFilter);
  const [page, setPage] = useState(1);
  const { summaries, loading: summariesLoading, unavailable, reload } = useProjectSummaries(projects);
  const { isPinned, togglePin } = usePinnedProjects(projects);

  useEffect(() => {
    if (initialCreate) setShowForm(true);
  }, [initialCreate]);

  const filteredSummaries = useMemo(() => summaries.filter(summary =>
    matchesProjectSearch(summary, searchQuery) &&
    matchesStateFilter(summary, stateFilter)), [searchQuery, stateFilter, summaries]);
  const hasActiveFilters = Boolean(searchQuery.trim()) || stateFilter !== 'all';
  const pageCount = Math.max(1, Math.ceil(filteredSummaries.length / PROJECTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PROJECTS_PER_PAGE;
  const pageSummaries = filteredSummaries.slice(pageStart, pageStart + PROJECTS_PER_PAGE);

  return (
    <div className="screen command-projects animate-fade-in">
      <CommandPageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Browse saved workspaces and open the next task."
        actions={(
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} />
            New project
          </button>
        )}
      />

      {projects.length === 0 && !showForm && (
        <CommandEmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="A project is required before you can start Review or Dynamic Testing."
          action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Create project</button>}
        />
      )}

      {projects.length > 0 && (
        <section className="projects-directory" aria-labelledby="projects-directory-title">
          <div className="projects-directory-heading">
            <div>
              <h2 id="projects-directory-title">All projects</h2>
            </div>
          </div>

          <div className="project-filters" role="search" aria-label="Project directory filters">
            <label className="project-filter-search" htmlFor="project-directory-search">
              <span className="visually-hidden">Search your projects</span>
              <span className="project-search-control">
                <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                <input
                  id="project-directory-search"
                  type="search"
                  value={searchQuery}
                  onChange={event => { setSearchQuery(event.target.value); setPage(1); }}
                  placeholder="Search your projects"
                />
              </span>
            </label>
            <label htmlFor="project-state-filter">
              <span>Current state</span>
              <Select id="project-state-filter" value={stateFilter} onChange={value => { setStateFilter(value as ProjectStateFilter); setPage(1); }} options={[{ value: 'all', label: 'All states' }, { value: 'needs_attention', label: 'Failed' }, { value: 'needs_approval', label: 'Need Approval' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'no_activity', label: 'No activity' }]} />
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                className="project-clear-filters"
                onClick={() => { setSearchQuery(''); setStateFilter('all'); setPage(1); }}
              >
                Clear filters
              </button>
            )}
          </div>

          {unavailable && (
            <div className="projects-data-warning" role="status">
              <span>Some project activity could not be loaded.</span>
              <button type="button" onClick={reload}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
            </div>
          )}

          {summariesLoading && summaries.length === 0 ? (
            <div className="projects-directory-message" role="status">Loading projects…</div>
          ) : filteredSummaries.length > 0 ? (
            <>
              <ProjectSummaryTable
                summaries={pageSummaries}
                onNavigate={onNavigate}
                isPinned={isPinned}
                onTogglePin={togglePin}
                ariaLabel="Projects"
                variant="directory-recent"
              />
              <nav className="project-pagination" aria-label="Project pages">
                <span aria-live="polite">
                  {pageStart + 1}–{Math.min(pageStart + PROJECTS_PER_PAGE, filteredSummaries.length)} of {filteredSummaries.length}
                </span>
                <div>
                  <button
                    type="button"
                    onClick={() => setPage(value => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                    aria-label="Previous project page"
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                  </button>
                  <strong>Page {currentPage} of {pageCount}</strong>
                  <button
                    type="button"
                    onClick={() => setPage(value => Math.min(pageCount, value + 1))}
                    disabled={currentPage === pageCount}
                    aria-label="Next project page"
                  >
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            </>
          ) : (
            <div className="projects-directory-message">
              <strong>No projects match these filters.</strong>
              <span>Change or clear the filters to see the full directory.</span>
            </div>
          )}
        </section>
      )}

      <ProjectCreateModal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onCreate={onCreate}
        onCreated={() => { setShowForm(false); void reload(); }}
      />

    </div>
  );
}
