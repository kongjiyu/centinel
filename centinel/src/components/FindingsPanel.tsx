import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, FileSearch, Filter, Search, X } from 'lucide-react';
import { api } from '../api/client';
import type { Finding } from '../types';
import { Select } from './Select';

type Props = {
  projectId: string;
  /** Optional review scope. When supplied, the shared project presentation
   * reads only findings produced by that review session. */
  sessionId?: string;
  onLoadStateChange?: (findings: Finding[], error: string | null) => void;
  refreshKey?: string;
  /** Project Detail uses numbered pages; other consumers retain the existing "show more" behavior. */
  presentation?: 'default' | 'project';
  pageSize?: number;
};

const FINDINGS_BATCH_SIZE = 50;
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export type FindingPresentationStatus = 'unresolved' | 'resolved' | 'dismissed';

/** Map persisted statuses to the deliberately smaller user-facing lifecycle. */
export function findingPresentationStatus(status: Finding['status']): FindingPresentationStatus {
  if (status === 'fixed') return 'resolved';
  if (status === 'dismissed') return 'dismissed';
  return 'unresolved';
}

export function findingStatusLabel(status: Finding['status'] | FindingPresentationStatus): string {
  const normalized = status === 'unresolved' || status === 'resolved' || status === 'dismissed'
    ? status
    : findingPresentationStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity.toLowerCase()}`}>{severity}</span>;
}

function sourceLabel(source: Finding['source']) {
  return source === 'static' ? 'Review' : 'Dynamic Testing';
}

function updatedTime(finding: Finding) {
  return finding.updatedAt || finding.createdAt;
}

function locationLabel(finding: Finding): string {
  if (!finding.filePath) return 'Not supplied';
  return `${finding.filePath}${finding.lineNumber != null ? `:${finding.lineNumber}` : ''}`;
}

function FindingActions({
  finding,
  updatingId,
  onUpdate,
}: {
  finding: Finding;
  updatingId: string | null;
  onUpdate: (findingId: string, status: Finding['status']) => void;
}) {
  const presentationStatus = findingPresentationStatus(finding.status);
  return (
    <div className="finding-actions" aria-label="Finding actions">
      {presentationStatus !== 'dismissed' && <button type="button" className="btn-dismiss" disabled={updatingId === finding.id} onClick={() => onUpdate(finding.id, 'dismissed')}>Dismiss</button>}
      {presentationStatus !== 'resolved' && <button type="button" className="btn-fix" disabled={updatingId === finding.id} onClick={() => onUpdate(finding.id, 'fixed')}>{updatingId === finding.id ? 'Updating…' : 'Mark as resolved'}</button>}
    </div>
  );
}

export function FindingsPanel({ projectId, sessionId, refreshKey, presentation = 'default', pageSize = FINDINGS_BATCH_SIZE, onLoadStateChange }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'static' | 'dynamic'>('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | FindingPresentationStatus>('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(FINDINGS_BATCH_SIZE);
  const [page, setPage] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const loadFindings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const nextFindings = sessionId
        ? await api.listStaticFindings(projectId, sessionId)
        : await api.listFindings(projectId);
      setFindings(nextFindings);
      onLoadStateChange?.(nextFindings, null);
    } catch (cause) {
      setFindings([]);
      setLoadError(String(cause));
      onLoadStateChange?.([], String(cause));
    } finally {
      setLoading(false);
    }
  }, [onLoadStateChange, projectId, sessionId]);

  useEffect(() => { void loadFindings(); }, [loadFindings, refreshKey]);
  useEffect(() => {
    setVisibleCount(FINDINGS_BATCH_SIZE);
    setPage(0);
  }, [filterSource, filterSeverity, filterStatus, filterPriority, searchQuery]);

  const hasPriorityFilter = presentation === 'project' || findings.some(finding => Boolean(finding.priority));
  const priorityOptions = useMemo(() => Array.from(new Set(findings.map(finding => finding.priority).filter(Boolean) as string[])).sort((a, b) => (SEVERITY_ORDER[a.toLowerCase()] ?? 99) - (SEVERITY_ORDER[b.toLowerCase()] ?? 99)), [findings]);
  const activeFilters = [
    filterSource !== 'all' ? { key: 'source', label: 'Source', value: sourceLabel(filterSource as Finding['source']) } : null,
    filterSeverity !== 'all' ? { key: 'severity', label: 'Severity', value: filterSeverity } : null,
    filterStatus !== 'all' ? { key: 'status', label: 'Status', value: findingStatusLabel(filterStatus) } : null,
    filterPriority !== 'all' ? { key: 'priority', label: 'Priority', value: filterPriority } : null,
  ].filter((entry): entry is { key: string; label: string; value: string } => Boolean(entry));

  const handleUpdateStatus = async (findingId: string, status: Finding['status']) => {
    setUpdatingId(findingId);
    setActionError(null);
    try {
      await api.updateFinding(projectId, findingId, status);
      setFindings(previous => previous.map(finding => finding.id === findingId ? { ...finding, status } : finding));
    } catch (cause) {
      setActionError(`Finding could not be updated. Your previous state is still shown. ${String(cause)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const sorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return findings
      .filter(finding => {
        if (filterSource !== 'all' && finding.source !== filterSource) return false;
        if (filterSeverity !== 'all' && finding.severity.toLowerCase() !== filterSeverity) return false;
        if (filterStatus !== 'all' && findingPresentationStatus(finding.status) !== filterStatus) return false;
        if (filterPriority !== 'all' && finding.priority !== filterPriority) return false;
        if (query && ![finding.title, finding.description, finding.filePath, finding.category, sourceLabel(finding.source)].some(value => value?.toLowerCase().includes(query))) return false;
        return true;
      })
      .sort((a, b) => (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 99) - (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 99) || Date.parse(updatedTime(b)) - Date.parse(updatedTime(a)) || a.title.localeCompare(b.title));
  }, [filterPriority, filterSeverity, filterSource, filterStatus, findings, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pagedFindings = presentation === 'project'
    ? sorted.slice(page * pageSize, page * pageSize + pageSize)
    : sorted.slice(0, visibleCount);

  useEffect(() => { setPage(current => Math.min(current, pageCount - 1)); }, [pageCount]);
  useEffect(() => {
    if (presentation === 'project' && selectedId && !sorted.some(finding => finding.id === selectedId)) setSelectedId(null);
  }, [presentation, selectedId, sorted]);

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSource('all');
    setFilterSeverity('all');
    setFilterStatus('all');
    setFilterPriority('all');
    setExpandedId(null);
  };

  const clearFilter = (key: string) => {
    if (key === 'source') setFilterSource('all');
    if (key === 'severity') setFilterSeverity('all');
    if (key === 'status') setFilterStatus('all');
    if (key === 'priority') setFilterPriority('all');
    setExpandedId(null);
  };

  const filterPrefix = presentation === 'project' ? 'project-' : '';
  const filterToolbar = (includeSource: boolean) => (
    <div className="findings-filter-shell">
      <div className="findings-filters" role="search" aria-label="Finding filters">
        <label className="finding-filter-search">
          <span className="visually-hidden">Search findings</span>
          <span className="finding-search-control"><Search size={15} aria-hidden="true" /><input aria-label="Search findings" type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Title, source, or location" /></span>
        </label>
        <button type="button" className="findings-filter-toggle" aria-expanded={filtersOpen} aria-controls={`${filterPrefix}finding-filter-options`} onClick={() => setFiltersOpen(open => !open)}>
          <Filter size={15} aria-hidden="true" /> Filters {activeFilters.length > 0 && <span className="findings-filter-count">{activeFilters.length}</span>}
        </button>
      </div>
      {activeFilters.length > 0 && <div className="findings-active-filters" aria-label="Active finding filters">
        {activeFilters.map(entry => <button key={entry.key} type="button" className="findings-active-filter" onClick={() => clearFilter(entry.key)} aria-label={`Remove ${entry.label} filter`}><span>{entry.label}: {entry.value}</span><X size={13} aria-hidden="true" /></button>)}
        <button type="button" className="findings-clear-filters" onClick={clearFilters}>Clear filters</button>
      </div>}
      {filtersOpen && <div id={`${filterPrefix}finding-filter-options`} className="findings-filter-options">
        {includeSource && <label className="finding-filter-field" htmlFor="finding-source-filter"><span>Source</span><Select id="finding-source-filter" aria-label="Source" value={filterSource} onChange={value => setFilterSource(value as 'all' | 'static' | 'dynamic')} options={[{ value: 'all', label: 'All sources' }, { value: 'static', label: 'Review' }, { value: 'dynamic', label: 'Dynamic Testing' }]} /></label>}
        <label className="finding-filter-field" htmlFor="finding-severity-filter"><span>Severity</span><Select id="finding-severity-filter" aria-label="Severity" value={filterSeverity} onChange={setFilterSeverity} options={[{ value: 'all', label: 'All severities' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'info', label: 'Info' }]} /></label>
        <label className="finding-filter-field" htmlFor="finding-status-filter"><span>Status</span><Select id="finding-status-filter" aria-label="Status" value={filterStatus} onChange={value => setFilterStatus(value as 'all' | FindingPresentationStatus)} options={[{ value: 'all', label: 'All statuses' }, { value: 'unresolved', label: 'Unresolved' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }]} /></label>
        {hasPriorityFilter && <label className="finding-filter-field" htmlFor="finding-priority-filter"><span>Priority</span><Select id="finding-priority-filter" aria-label="Priority" value={filterPriority} onChange={setFilterPriority} options={[{ value: 'all', label: 'All priorities' }, ...priorityOptions.map(priority => ({ value: priority, label: priority }))]} /></label>}
      </div>}
    </div>
  );

  if (loading) return <div className="panel-loading" role="status">Loading findings...</div>;

  if (presentation === 'project') {
    const selectedFinding = sorted.find(finding => finding.id === selectedId) ?? null;
    return (
      <div className="project-findings-layout">
        <section className="card detail-card findings-card findings-panel findings-panel-project" aria-labelledby="project-findings-heading">
          <div className="panel-header findings-project-header"><h3 id="project-findings-heading"><FileSearch size={18} aria-hidden="true" /> Findings</h3><strong className="findings-project-total">{findings.length} total</strong></div>
          {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
          {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}
          {findings.length > 0 && filterToolbar(false)}
          {sorted.length === 0 ? <div className="findings-empty-state"><p className="card-empty">{findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p></div> : (
            <section className="project-findings-table-region" aria-label="Findings table">
              <table className="project-findings-table" aria-label="Review findings"><thead><tr><th scope="col">Priority</th><th scope="col">Severity</th><th scope="col">Description</th><th scope="col">Status</th></tr></thead><tbody>
                {pagedFindings.map(finding => <tr key={finding.id} tabIndex={0} aria-selected={selectedId === finding.id} className={selectedId === finding.id ? 'selected' : undefined} onClick={() => setSelectedId(finding.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(finding.id); } }}>
                  <td><span className="project-finding-priority">{finding.priority || '—'}</span></td><td><SeverityBadge severity={finding.severity} /></td><td><span className="project-finding-description"><strong>{finding.title}</strong><small>{finding.filePath || finding.description || 'No location supplied'}</small></span></td><td><span className={`finding-status finding-status-${findingPresentationStatus(finding.status)}`}>{findingStatusLabel(finding.status)}</span></td>
                </tr>)}
              </tbody></table>
              {pageCount > 1 && <div className="findings-pagination" aria-label="Finding pages"><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>Next</button></div>}
            </section>
          )}
        </section>

        <aside className="card detail-card project-finding-details" aria-label="Finding details">
          {selectedFinding ? <>
            <div className="project-finding-source-status"><strong>{sourceLabel(selectedFinding.source)}</strong><span className={`finding-status finding-status-${findingPresentationStatus(selectedFinding.status)}`}>{findingStatusLabel(selectedFinding.status)}</span></div>
            <div className="project-finding-title-status"><h4>{selectedFinding.title}</h4></div>
            <dl className="project-finding-facts">
              <div><dt>Priority</dt><dd>{selectedFinding.priority || 'Not set'}</dd></div>
              <div><dt>Severity</dt><dd><SeverityBadge severity={selectedFinding.severity} /></dd></div>
              <div><dt>Location</dt><dd className="finding-location-path">{locationLabel(selectedFinding)}</dd></div>
            </dl>
            <section><h5>Description</h5><p>{selectedFinding.description || 'No description was supplied.'}</p></section>
            {selectedFinding.recommendation && <section><h5>Recommendation</h5><p>{selectedFinding.recommendation}</p></section>}
            {selectedFinding.evidenceText && <section><h5>Evidence</h5><pre>{selectedFinding.evidenceText}</pre></section>}
            <FindingActions finding={selectedFinding} updatingId={updatingId} onUpdate={(id, status) => void handleUpdateStatus(id, status)} />
          </> : <div className="project-finding-details-empty">Select a finding to review its details</div>}
        </aside>
      </div>
    );
  }

  return (
    <div className="findings-panel">
      <div className="panel-header"><div><h3>Findings</h3><p className="panel-description">Triage issues from Review and Dynamic Testing in one list.</p></div><span className="findings-total-count">{findings.length} total</span></div>
      {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
      {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}
      {findings.length > 0 && filterToolbar(true)}
      {sorted.length === 0 ? <div className="findings-empty-state"><p className="card-empty">{findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p></div> : <>
        <div className="findings-list">
          {pagedFindings.map(finding => {
            const expanded = expandedId === finding.id;
            const detailId = `finding-detail-${finding.id}`;
            return <div key={finding.id} className={`finding-row finding-${findingPresentationStatus(finding.status)}`}>
              <button type="button" className="finding-header" onClick={() => setExpandedId(expanded ? null : finding.id)} aria-expanded={expanded} aria-controls={detailId}>
                <SeverityBadge severity={finding.severity} /><span className="finding-title">{finding.title}</span><span className={`badge badge-source-${finding.source}`}>{sourceLabel(finding.source)}</span><span className={`finding-status finding-status-${findingPresentationStatus(finding.status)}`}>{findingStatusLabel(finding.status)}</span><time dateTime={updatedTime(finding)} title={`Updated ${new Date(updatedTime(finding)).toLocaleString()}`}>{new Date(updatedTime(finding)).toLocaleDateString()}</time><ChevronDown className="finding-disclosure" size={16} aria-hidden="true" />
              </button>
              {expanded && <div className="finding-detail" id={detailId} role="region" aria-label={`${finding.title} details`}>
                <div className="finding-detail-content">
                  <div className="finding-source-status"><strong>{sourceLabel(finding.source)}</strong><span className={`finding-status finding-status-${findingPresentationStatus(finding.status)}`}>{findingStatusLabel(finding.status)}</span></div>
                  <div className="finding-detail-title-status"><h4>{finding.title}</h4></div>
                  <dl className="finding-facts"><div><dt>Priority</dt><dd>{finding.priority || 'Not set'}</dd></div><div><dt>Severity</dt><dd><SeverityBadge severity={finding.severity} /></dd></div><div><dt>Location</dt><dd className="finding-location-path">{locationLabel(finding)}</dd></div></dl>
                  <section><h4>Description</h4><p className="finding-description">{finding.description || 'No description was supplied.'}</p></section>
                  {finding.recommendation && <section className="finding-recommendation"><h4>Recommendation</h4><p>{finding.recommendation}</p></section>}
                  {finding.evidenceText && <section className="finding-evidence"><h4>Evidence</h4><pre>{finding.evidenceText}</pre></section>}
                </div>
                <FindingActions finding={finding} updatingId={updatingId} onUpdate={(id, status) => void handleUpdateStatus(id, status)} />
              </div>}
            </div>;
          })}
        </div>
        {visibleCount < sorted.length && <div className="findings-more"><button className="btn-secondary" type="button" onClick={() => setVisibleCount(count => count + FINDINGS_BATCH_SIZE)}>Show {Math.min(FINDINGS_BATCH_SIZE, sorted.length - visibleCount)} more</button></div>}
      </>}
    </div>
  );
}
