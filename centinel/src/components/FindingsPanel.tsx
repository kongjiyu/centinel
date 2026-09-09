import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, ChevronDown, Search } from 'lucide-react';
import { api } from '../api/client';
import type { Finding } from '../types';
import { Select } from './Select';

type Props = {
  projectId: string;
  refreshKey?: string;
  /** Project Detail uses numbered pages; other consumers retain the existing "show more" behavior. */
  presentation?: 'default' | 'project';
  pageSize?: number;
};

const FINDINGS_BATCH_SIZE = 50;
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity.toLowerCase()}`}>{severity}</span>;
}

function sourceLabel(source: Finding['source']) {
  return source === 'static' ? 'Review' : 'Dynamic Testing';
}

function statusLabel(status: Finding['status']) {
  if (status === 'carryover') return 'Carryover';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function updatedTime(finding: Finding) {
  return finding.updatedAt || finding.createdAt;
}

export function FindingsPanel({ projectId, refreshKey, presentation = 'default', pageSize = FINDINGS_BATCH_SIZE }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'static' | 'dynamic'>('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(FINDINGS_BATCH_SIZE);
  const [page, setPage] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFindings(await api.listFindings(projectId));
    } catch (cause) {
      setFindings([]);
      setLoadError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadFindings(); }, [loadFindings, refreshKey]);
  useEffect(() => {
    setVisibleCount(FINDINGS_BATCH_SIZE);
    setPage(0);
  }, [filterSource, filterSeverity, filterStatus, filterPriority, searchQuery]);

  const hasPriorityFilter = presentation === 'project' || findings.some(finding => Boolean(finding.priority));
  const priorityOptions = useMemo(() => Array.from(new Set(findings.map(finding => finding.priority).filter(Boolean) as string[])).sort((a, b) => (SEVERITY_ORDER[a] ?? 99) - (SEVERITY_ORDER[b] ?? 99)), [findings]);
  const hasFilters = Boolean(searchQuery.trim()) || filterSource !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all' || filterPriority !== 'all';

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
        if (filterStatus !== 'all' && finding.status !== filterStatus) return false;
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

  useEffect(() => {
    setPage(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (presentation === 'project' && selectedId && !sorted.some(finding => finding.id === selectedId)) {
      setSelectedId(null);
    }
  }, [presentation, selectedId, sorted]);

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSource('all');
    setFilterSeverity('all');
    setFilterStatus('all');
    setFilterPriority('all');
    setExpandedId(null);
  };

  if (loading) return <div className="panel-loading" role="status">Loading findings...</div>;

  if (presentation === 'project') {
    const selectedFinding = sorted.find(finding => finding.id === selectedId) ?? null;
    const pageStart = page * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, sorted.length);

    return (
      <div className="findings-panel findings-panel-project">
        <div className="panel-header findings-project-header">
          <h3>Findings</h3>
          <strong className="findings-project-total">{findings.length} total</strong>
        </div>

        {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
        {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}

        {findings.length > 0 && (
          <div className="findings-filters" role="search" aria-label="Finding filters">
            <label className="finding-filter-search">
              <span>Search findings</span>
              <span className="finding-search-control"><Search size={15} aria-hidden="true" /><input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Title, source, or location" /></span>
            </label>
            <label className="finding-filter-field" htmlFor="finding-source-filter"><span>Source</span><Select id="finding-source-filter" aria-label="Source" value={filterSource} onChange={value => setFilterSource(value as 'all' | 'static' | 'dynamic')} options={[{ value: 'all', label: 'All sources' }, { value: 'static', label: 'Review' }, { value: 'dynamic', label: 'Dynamic Testing' }]} /></label>
            <label className="finding-filter-field" htmlFor="finding-severity-filter"><span>Severity</span><Select id="finding-severity-filter" aria-label="Severity" value={filterSeverity} onChange={setFilterSeverity} options={[{ value: 'all', label: 'All severities' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'info', label: 'Info' }]} /></label>
            <label className="finding-filter-field" htmlFor="finding-status-filter"><span>Status</span><Select id="finding-status-filter" aria-label="Status" value={filterStatus} onChange={setFilterStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'new', label: 'New' }, { value: 'carryover', label: 'Carryover' }, { value: 'accepted', label: 'Accepted' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'fixed', label: 'Fixed' }]} /></label>
            <label className="finding-filter-field" htmlFor="finding-priority-filter"><span>Priority</span><Select id="finding-priority-filter" aria-label="Priority" value={filterPriority} onChange={setFilterPriority} options={[{ value: 'all', label: 'All priorities' }, ...priorityOptions.map(priority => ({ value: priority, label: priority.charAt(0).toUpperCase() + priority.slice(1) }))]} /></label>
            {hasFilters && <button type="button" className="findings-clear-filters" onClick={clearFilters}>Clear filters</button>}
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="findings-empty-state">
            <p className="card-empty">{findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p>
            {findings.length > 0 && hasFilters && <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <div className="project-findings-workspace">
            <section className="project-findings-table-region" aria-label="Findings table">
              <table className="project-findings-table">
                <thead>
                  <tr><th scope="col">Priority</th><th scope="col">Severity</th><th scope="col">Description</th><th scope="col">Status</th></tr>
                </thead>
                <tbody>
                  {pagedFindings.map(finding => (
                    <tr
                      key={finding.id}
                      tabIndex={0}
                      aria-selected={selectedId === finding.id}
                      className={selectedId === finding.id ? 'selected' : undefined}
                      onClick={() => setSelectedId(finding.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(finding.id);
                        }
                      }}
                    >
                      <td><span className="project-finding-priority">{finding.priority || '—'}</span></td>
                      <td><SeverityBadge severity={finding.severity} /></td>
                      <td><span className="project-finding-description"><strong>{finding.title}</strong><small>{finding.filePath || finding.description || 'No location supplied'}</small></span></td>
                      <td><span className={`finding-status finding-status-${finding.status}`}>{statusLabel(finding.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="findings-result-summary" aria-live="polite">Showing {pageStart + 1}–{pageEnd} of {sorted.length} matching finding{sorted.length === 1 ? '' : 's'} ({findings.length} total)</p>
              {pageCount > 1 && <div className="findings-pagination" aria-label="Finding pages">
                <button type="button" className="btn-secondary" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0}>Previous</button>
                <span>Page {page + 1} of {pageCount}</span>
                <button type="button" className="btn-secondary" onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>Next</button>
              </div>}
            </section>

            <aside className="project-finding-details" aria-label="Finding details">
              {selectedFinding ? (
                <>
                  <div className="project-finding-details-header">
                    <span className={`badge badge-severity-${selectedFinding.severity.toLowerCase()}`}>{selectedFinding.severity}</span>
                    <span className={`finding-status finding-status-${selectedFinding.status}`}>{statusLabel(selectedFinding.status)}</span>
                  </div>
                  <h4>{selectedFinding.title}</h4>
                  <dl className="project-finding-facts">
                    <div><dt>Priority</dt><dd>{selectedFinding.priority || 'Not set'}</dd></div>
                    <div><dt>Source</dt><dd>{sourceLabel(selectedFinding.source)}</dd></div>
                    {selectedFinding.filePath && <div><dt>Location</dt><dd className="finding-location-path">{selectedFinding.filePath}{selectedFinding.lineNumber != null ? `:${selectedFinding.lineNumber}` : ''}</dd></div>}
                  </dl>
                  <section><h5>Description</h5><p>{selectedFinding.description || 'No description was supplied.'}</p></section>
                  {selectedFinding.evidenceText && <section><h5>Evidence</h5><pre>{selectedFinding.evidenceText}</pre></section>}
                  {selectedFinding.recommendation && <section><h5>Recommendation</h5><p>{selectedFinding.recommendation}</p></section>}
                  {selectedFinding.confidence && <p className="project-finding-confidence">Confidence: {selectedFinding.confidence}</p>}
                  <div className="finding-actions" aria-label="Finding actions">
                    {selectedFinding.status !== 'accepted' && <button className="btn-accept" disabled={updatingId === selectedFinding.id} onClick={() => void handleUpdateStatus(selectedFinding.id, 'accepted')}>Accept</button>}
                    {selectedFinding.status !== 'dismissed' && <button className="btn-dismiss" disabled={updatingId === selectedFinding.id} onClick={() => void handleUpdateStatus(selectedFinding.id, 'dismissed')}>Dismiss</button>}
                    {selectedFinding.status !== 'fixed' && <button className="btn-fix" disabled={updatingId === selectedFinding.id} onClick={() => void handleUpdateStatus(selectedFinding.id, 'fixed')}>{updatingId === selectedFinding.id ? 'Updating…' : 'Mark fixed'}</button>}
                  </div>
                </>
              ) : (
                <div className="project-finding-details-empty">Select Finding to review the details</div>
              )}
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="findings-panel">
      <div className="panel-header">
        <div>
          <h3>Findings</h3>
          <p className="panel-description">Triage issues from Review and Dynamic Testing in one list.</p>
        </div>
        <span className="findings-total-count">{findings.length} total</span>
      </div>

      {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
      {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}

      {findings.length > 0 && (
        <div className="findings-filters" role="search" aria-label="Finding filters">
          <label className="finding-filter-search">
            <span>Search findings</span>
            <span className="finding-search-control"><Search size={15} aria-hidden="true" /><input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Title, source, or location" /></span>
          </label>
          <label className="finding-filter-field" htmlFor="finding-source-filter"><span>Source</span><Select id="finding-source-filter" aria-label="Source" value={filterSource} onChange={value => setFilterSource(value as 'all' | 'static' | 'dynamic')} options={[{ value: 'all', label: 'All sources' }, { value: 'static', label: 'Review' }, { value: 'dynamic', label: 'Dynamic Testing' }]} /></label>
          <label className="finding-filter-field" htmlFor="finding-severity-filter"><span>Severity</span><Select id="finding-severity-filter" aria-label="Severity" value={filterSeverity} onChange={setFilterSeverity} options={[{ value: 'all', label: 'All severities' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'info', label: 'Info' }]} /></label>
          <label className="finding-filter-field" htmlFor="finding-status-filter"><span>Status</span><Select id="finding-status-filter" aria-label="Status" value={filterStatus} onChange={setFilterStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'new', label: 'New' }, { value: 'carryover', label: 'Carryover' }, { value: 'accepted', label: 'Accepted' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'fixed', label: 'Fixed' }]} /></label>
          {hasPriorityFilter && <label className="finding-filter-field" htmlFor="finding-priority-filter"><span>Priority</span><Select id="finding-priority-filter" aria-label="Priority" value={filterPriority} onChange={setFilterPriority} options={[{ value: 'all', label: 'All priorities' }, ...priorityOptions.map(priority => ({ value: priority, label: priority.charAt(0).toUpperCase() + priority.slice(1) }))]} /></label>}
          {hasFilters && <button type="button" className="findings-clear-filters" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="findings-empty-state">
          <p className="card-empty">{findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p>
          {findings.length > 0 && hasFilters && <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          <p className="findings-result-summary" aria-live="polite">Showing {Math.min(visibleCount, sorted.length)} of {sorted.length} matching finding{sorted.length === 1 ? '' : 's'} ({findings.length} total)</p>
          <div className="findings-list">
            {pagedFindings.map(finding => {
              const expanded = expandedId === finding.id;
              const detailId = `finding-detail-${finding.id}`;
              return (
                <div key={finding.id} className={`finding-row finding-${finding.status}`}>
                  <button type="button" className="finding-header" onClick={() => setExpandedId(expanded ? null : finding.id)} aria-expanded={expanded} aria-controls={detailId}>
                    <SeverityBadge severity={finding.severity} />
                    <span className="finding-title">{finding.title}</span>
                    <span className={`badge badge-source-${finding.source}`}>{sourceLabel(finding.source)}</span>
                    <span className={`finding-status finding-status-${finding.status}`}>{statusLabel(finding.status)}</span>
                    <time dateTime={updatedTime(finding)} title={`Updated ${new Date(updatedTime(finding)).toLocaleString()}`}>{new Date(updatedTime(finding)).toLocaleDateString()}</time>
                    <ChevronDown className="finding-disclosure" size={16} aria-hidden="true" />
                  </button>

                  {expanded && (
                    <div className="finding-detail" id={detailId} role="region" aria-label={`${finding.title} details`}>
                      <div className="finding-expanded-main">
                        <section><h4>Description</h4><p className="finding-description">{finding.description || 'No description was supplied.'}</p></section>
                        {finding.evidenceText && <section className="finding-evidence"><h4>Evidence</h4><pre>{finding.evidenceText}</pre></section>}
                        {finding.filePath && <section className="finding-location"><h4>Location</h4><span className="finding-location-path">{finding.filePath}</span>{finding.lineNumber != null && <span className="finding-location-line">:{finding.lineNumber}</span>}</section>}
                        {finding.recommendation && <section className="finding-recommendation"><h4>Recommendation</h4><p>{finding.recommendation}</p></section>}
                      </div>
                      <aside className="finding-expanded-side">
                        <dl className="finding-facts">
                          <div><dt>Status</dt><dd>{statusLabel(finding.status)}</dd></div>
                          {finding.priority && <div><dt>Priority</dt><dd>{finding.priority}</dd></div>}
                          <div><dt>Provenance</dt><dd>{finding.fromRemarks ? 'Reviewer feedback' : sourceLabel(finding.source)}</dd></div>
                          {finding.confidence && <div><dt>Confidence</dt><dd>{finding.confidence}</dd></div>}
                          <div><dt>Updated</dt><dd>{new Date(updatedTime(finding)).toLocaleString()}</dd></div>
                        </dl>
                        <div className="finding-actions" aria-label="Finding actions">
                          {finding.status !== 'accepted' && <button className="btn-accept" disabled={updatingId === finding.id} onClick={() => void handleUpdateStatus(finding.id, 'accepted')}>Accept</button>}
                          {finding.status !== 'dismissed' && <button className="btn-dismiss" disabled={updatingId === finding.id} onClick={() => void handleUpdateStatus(finding.id, 'dismissed')}>Dismiss</button>}
                          {finding.status !== 'fixed' && <button className="btn-fix" disabled={updatingId === finding.id} onClick={() => void handleUpdateStatus(finding.id, 'fixed')}>{updatingId === finding.id ? 'Updating…' : 'Mark fixed'}</button>}
                        </div>
                      </aside>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {visibleCount < sorted.length && <div className="findings-more"><button className="btn-secondary" type="button" onClick={() => setVisibleCount(count => count + FINDINGS_BATCH_SIZE)}>Show {Math.min(FINDINGS_BATCH_SIZE, sorted.length - visibleCount)} more</button></div>}
        </>
      )}
    </div>
  );
}
