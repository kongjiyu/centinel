import { useEffect, useState } from 'react';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ChevronLeft, ChevronRight, FileCheck2, FolderOpen, MonitorPlay, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { dynamicActivityScreen, loadDynamicActivity } from '../dynamic/runActivity';
import { formatActivityTime, timestamp } from '../hooks/useProjectSummaries';
import { screenToHash } from '../navigation/screenHash';
import { projectActivityLifecycle, projectActivityLifecycleTone, type ProjectActivityLifecycle } from '../reviewViewModel';
import type { Project, Screen } from '../types';
import '../components/ProjectSummaryTable.css';
import './ProjectsScreen.css';

type Kind = 'review' | 'dynamic';
type Entry = {
  id: string;
  project: Project;
  name: string;
  date: string;
  state: ProjectActivityLifecycle | 'Saved';
  label?: 'Saved test' | 'Test run';
  target: Screen;
};

async function projectEntries(project: Project, kind: Kind): Promise<{ entries: Entry[]; unavailable: boolean }> {
  if (kind === 'review') {
    const reviews = await api.listStaticSessions(project.id, { summary: true });
    return {
      unavailable: false,
      entries: reviews.map(review => ({
        id: review.id, project, name: review.name || 'Untitled Review', date: review.createdAt,
        state: projectActivityLifecycle(review, 'review'),
        target: { name: 'review-activity', projectId: project.id, sessionId: review.id, reviewName: review.name },
      })),
    };
  }

  const [activity, missions] = await Promise.allSettled([loadDynamicActivity(project.id), api.dynamicMissions(project.id)]);
  const sessions = activity.status === 'fulfilled' ? activity.value.sessions : [];
  const entries: Entry[] = sessions.map(session => ({
    id: session.id, project, name: session.name || 'Untitled test', date: session.createdAt,
    state: projectActivityLifecycle(session, 'dynamic'), label: 'Test run', target: dynamicActivityScreen(project.id, session),
  }));
  let unavailable = activity.status === 'rejected' || activity.value.unavailable || missions.status === 'rejected';
  if (missions.status === 'fulfilled') {
    for (const mission of missions.value) {
      if (mission.archivedAt) continue;
      let name = mission.displayName;
      if (!name) {
        try { name = (await api.dynamicRevision(project.id, mission.currentRevisionId)).name; }
        catch { unavailable = true; }
      }
      entries.push({
        id: mission.id, project, name: name || 'Saved test', date: mission.createdAt, state: 'Saved', label: 'Saved test',
        target: { name: 'dynamic-testing', projectId: project.id, missionId: mission.id },
      });
    }
  }
  return { entries, unavailable };
}

const PAGE_SIZE = 5;

export function ActivityDirectoryScreen({ kind, projects, onNavigate }: {
  kind: Kind;
  projects: Project[];
  onNavigate: (screen: Screen) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let nextProject = 0;
    let partial = false;
    const loaded: Entry[] = [];
    setLoading(true);
    setUnavailable(false);
    setEntries([]);
    const worker = async () => {
      while (!cancelled && nextProject < projects.length) {
        const project = projects[nextProject++];
        try {
          const result = await projectEntries(project, kind);
          loaded.push(...result.entries);
          partial ||= result.unavailable;
        } catch { partial = true; }
      }
    };
    void Promise.all(Array.from({ length: Math.min(projects.length, 4) }, worker)).then(() => {
      if (cancelled) return;
      setEntries(loaded.sort((a, b) => timestamp(b.date) - timestamp(a.date) || a.id.localeCompare(b.id)));
      setUnavailable(partial);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [kind, projects, refresh]);

  const title = kind === 'review' ? 'Reviews' : 'Dynamic Testing';
  const itemLabel = kind === 'review' ? 'Review' : 'Dynamic test';
  const ActivityIcon = kind === 'review' ? FileCheck2 : MonitorPlay;
  const normalized = query.trim().toLowerCase();
  const results = entries.filter(entry => entry.name.toLowerCase().includes(normalized) || entry.project.name.toLowerCase().includes(normalized));
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;

  return <div className="screen command-projects activity-directory animate-fade-in">
    <CommandPageHeader eyebrow="Workspace" title={title} actions={
      <button type="button" className="btn-primary" disabled={kind === 'dynamic' && !projects.length}
        onClick={() => onNavigate(kind === 'review' ? { name: 'review-entry' } : { name: 'dynamic-testing' })}>
        <Plus size={14} aria-hidden="true" /> {kind === 'review' ? 'Start Review' : 'Start Dynamic Test'}
      </button>
    } />
    <section className="projects-directory" aria-labelledby="activity-directory-heading">
      <div className="projects-directory-heading"><h2 id="activity-directory-heading">All {kind === 'review' ? 'reviews' : 'dynamic tests'}</h2></div>
      <div className={`project-filters${kind === 'review' ? ' review-directory-filters' : ''}`} role="search" aria-label={`Search ${title}`}>
        <label className="project-filter-search">
          <span className="project-search-control"><Search size={16} aria-hidden="true" />
            <input type="search" aria-label={`Search by project or ${itemLabel.toLowerCase()}`} placeholder={`Search by project or ${itemLabel.toLowerCase()}`}
              value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
          </span>
        </label>
        {kind === 'dynamic' && <button className="btn-secondary" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>}
      </div>
      {unavailable && <p className="projects-data-warning" role="status">Some activity could not be loaded. {kind === 'review'
        ? <button type="button" className="btn-link" onClick={() => setRefresh(value => value + 1)}>Retry</button>
        : 'Refresh to try again.'}</p>}
      {loading ? <LoadingSkeleton variant="rows" rows={PAGE_SIZE} className="activity-directory-placeholder" label={kind === 'review' ? 'Loading reviews' : 'Loading dynamic tests'} />
        : !results.length ? <p className="projects-directory-message" role="status">{normalized ? 'No activity matches your search.' : 'No activity to show yet.'}</p>
        : <>
          <div className="project-summary-container"><div className="project-summary-table-shell">
            <table className="project-summary-table project-summary-table-dashboard" aria-label={title}>
              <colgroup><col className="activity-directory-col-name" /><col className="activity-directory-col-state" /><col className="activity-directory-col-date" /></colgroup>
              <thead className="project-summary-table-head-dashboard"><tr>
                <th scope="col">{itemLabel}</th><th scope="col">Current state</th><th scope="col">Created</th>
              </tr></thead>
              <tbody>{results.slice(offset, offset + PAGE_SIZE).map(entry => {
                const projectTarget = { name: 'project-detail', projectId: entry.project.id } as const;
                return <tr key={`${entry.project.id}:${entry.label ?? 'Review'}:${entry.id}`} className="project-summary-row"
                  tabIndex={0} aria-label={`Open ${entry.name} in ${entry.project.name}`}
                  onClick={event => {
                    if (!event.defaultPrevented && !(event.target instanceof Element && event.target.closest('a'))) onNavigate(entry.target);
                  }}
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    onNavigate(entry.target);
                  }}>
                  <td data-label={itemLabel}>
                    <div className="project-activity-stack">
                      <div className="activity-directory-title">
                        <ActivityIcon size={14} aria-hidden="true" />
                        <strong>{entry.name}</strong>
                        {entry.label && <span className="project-activity-meta">{entry.label}</span>}
                      </div>
                      <a className="activity-directory-link" href={screenToHash(projectTarget)} onClick={event => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        onNavigate(projectTarget);
                      }}><FolderOpen size={14} aria-hidden="true" />{entry.project.name}</a>
                    </div>
                  </td>
                  <td data-label="Current state"><StatusBadge label={entry.state} tone={entry.state === 'Saved' ? 'neutral' : projectActivityLifecycleTone(entry.state)} /></td>
                  <td data-label="Created"><time dateTime={entry.date}>{formatActivityTime(entry.date)}</time></td>
                </tr>;
              })}</tbody>
            </table>
          </div></div>
          <nav className="project-pagination" aria-label={`${title} pages`}>
            <span aria-live="polite">{offset + 1}–{Math.min(offset + PAGE_SIZE, results.length)} of {results.length}</span>
            <div>
              <button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
              <strong>Page {currentPage} of {pageCount}</strong>
              <button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
            </div>
          </nav>
        </>}
    </section>
  </div>;
}
