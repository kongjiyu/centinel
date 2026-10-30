import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, FileSearch, Filter, Search, X } from 'lucide-react';
import { api } from '../api/client';
import { mergeReviewFindings } from '../reviewEvidenceFindings';
import { effectiveFindingStatus } from '../findingStatus';
import type { Finding } from '../types';
import { entityIdTitle, formatEntityId } from '../utils/entityId';
import { userFacingError } from '../utils/userFacingError';
import { deriveRiskLevelWithFallback, priorityRank, riskLevelRank } from '../riskPolicy';
import { Select } from './Select';
import { findingDomain, findingGroupDomains, findingSourceReferences, groupFindings, groupStatus } from '../findingGroups';
import { FindingEvidence, FindingOccurrences } from './FindingEvidence';
import { FindingDocument } from './FindingDocument';
import { LoadingSkeleton } from './LoadingSkeleton';
import './FindingsPanel.css';

type Props = {
  projectId: string;
  supplementalFindings?: Finding[];
  supplementalUnavailableMessage?: string | null;
  readOnly?: boolean;
  /** Optional review scope. When supplied, the shared project presentation
   * reads only findings produced by that review session. */
  sessionId?: string;
  onLoadStateChange?: (findings: Finding[], error: string | null) => void;
  refreshKey?: string;
  /** Project Detail uses numbered pages; other consumers retain the existing "show more" behavior. */
  presentation?: 'default' | 'project';
  pageSize?: number;
  /** Optional finding to select when another evidence view links into the table. */
  focusFindingId?: string | null;
  /** Opens a Review that supplied validated lineage or resolution evidence. */
  onOpenReview?: (reviewId: string) => void;
  /** Optional navigation context supplied by Assessment/Overview links. */
  initialFilter?: {
    riskLevel?: 'all' | 'critical' | 'high' | 'medium' | 'low' | 'critical_or_high';
    status?: 'all' | FindingPresentationStatus;
    category?: string;
    search?: string;
  } | null;
};

const FINDINGS_BATCH_SIZE = 50;
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function findingRiskLevel(finding: Finding): string | null {
  return finding.riskLevel ?? deriveRiskLevelWithFallback(finding.severity, finding.priority);
}

export type FindingPresentationStatus = 'unresolved' | 'resolved' | 'dismiss';

/** Map persisted statuses to the deliberately smaller user-facing lifecycle. */
export function findingPresentationStatus(status: Finding['status']): FindingPresentationStatus {
  if (status === 'fixed') return 'resolved';
  if (status === 'dismissed') return 'dismiss';
  return 'unresolved';
}

function displayedFindingStatus(finding: Finding): FindingPresentationStatus {
  return findingPresentationStatus(effectiveFindingStatus(finding));
}

export function findingStatusLabel(status: Finding['status'] | FindingPresentationStatus): string {
  const normalized = status === 'unresolved' || status === 'resolved' || status === 'dismiss'
    ? status
    : findingPresentationStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity.toLowerCase()}`}>{severity}</span>;
}

function RiskBadge({ finding }: { finding: Finding }) {
  const riskLevel = findingRiskLevel(finding);
  return <span className={`project-finding-risk ${riskLevel ? `project-risk-level-${riskLevel}` : 'project-risk-level-unclassified'}`} title={finding.riskLevel ? 'Recorded Risk Level' : 'Risk Level calculated from available finding data'}>{riskLevel ? riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1) : 'Not classified'}</span>;
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const label = priority?.trim() || 'Not set';
  const normalized = label.toLowerCase();
  const level = ['critical', 'high', 'medium', 'low'].includes(normalized) ? normalized : 'unclassified';
  return <span className={`project-finding-priority project-priority-level-${level}`}>{label}</span>;
}

function sourceLabel(source: Finding['source']) {
  return source === 'static' ? 'Review' : 'Dynamic Testing';
}

function originLabel(finding: Finding) {
  return finding.verifier === 'readiness' ? 'Project Readiness' : sourceLabel(finding.source);
}

function updatedTime(finding: Finding) {
  return finding.updatedAt || finding.createdAt;
}

function locationLabel(finding: Finding): string {
  if (finding.evidenceGap && finding.verifier !== 'readiness') return 'Review documents';
  if (!finding.filePath) return 'Not supplied';
  return `${finding.filePath}${finding.lineNumber != null ? `:${finding.lineNumber}` : ''}`;
}

function FindingActions({
  finding,
  readOnly,
  updatingId,
  onUpdate,
}: {
  finding: Finding;
  readOnly?: boolean;
  updatingId: string | null;
  onUpdate: (findingId: string, status: Finding['status']) => void;
}) {
  const presentationStatus = displayedFindingStatus(finding);
  if (readOnly) return <p>The review is still running. You can inspect this finding; updates become available when the review stops.</p>;
  if (finding.evidenceGap) return finding.verifier === 'readiness'
    ? <p>This issue is an immutable snapshot from Project Readiness. Update the project sources and start a new readiness assessment to check it again.</p>
    : <p>This document issue comes from the saved review. Update the documents and run a new review to check it again.</p>;
  return (
    <div className="finding-actions" aria-label="Finding actions">
      {presentationStatus !== 'dismiss' && <button type="button" className="btn-dismiss" disabled={updatingId === finding.id} onClick={() => onUpdate(finding.id, 'dismissed')}>Dismiss</button>}
      {presentationStatus !== 'resolved' && <button type="button" className="btn-fix" disabled={updatingId === finding.id} onClick={() => onUpdate(finding.id, 'fixed')}>{updatingId === finding.id ? 'Updating…' : 'Mark as resolved'}</button>}
    </div>
  );
}

export function FindingsPanel({ supplementalFindings, supplementalUnavailableMessage, readOnly = false, projectId, sessionId, refreshKey, presentation = 'default', pageSize = FINDINGS_BATCH_SIZE, focusFindingId = null, initialFilter = null, onLoadStateChange, onOpenReview }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'static' | 'dynamic'>('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | FindingPresentationStatus>('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterRiskLevel, setFilterRiskLevel] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(FINDINGS_BATCH_SIZE);
  const [page, setPage] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const listScrollContext = useRef<{ element: HTMLElement | null; scrollTop: number; windowTop: number } | null>(null);
  const loadedFindingsRef = useRef<{ loaded: boolean; findings: Finding[] }>({ loaded: false, findings: [] });

  const openFinding = (id: string, source: HTMLElement) => {
    const element = source.closest<HTMLElement>('.main-content') ?? document.querySelector<HTMLElement>('.main-content');
    listScrollContext.current = { element, scrollTop: element?.scrollTop ?? 0, windowTop: window.scrollY };
    setSelectedId(id);
  };
  const returnToFindings = (id: string) => {
    setSelectedId(null);
    window.requestAnimationFrame(() => {
      const context = listScrollContext.current;
      if (context?.element?.isConnected) context.element.scrollTop = context.scrollTop;
      else if (context) window.scrollTo({ top: context.windowTop, behavior: 'auto' });
      document.getElementById(`finding-row-${id}`)?.focus({ preventScroll: true });
    });
  };

  const loadFindings = useCallback(async () => {
    setLoading(true);
    try {
      const nextFindings = sessionId
        ? await api.listStaticFindings(projectId, sessionId)
        : await api.listFindings(projectId);
      const combined = mergeReviewFindings(nextFindings, supplementalFindings ?? []);
      loadedFindingsRef.current = { loaded: true, findings: combined };
      setFindings(combined);
      setLoadError(null);
      onLoadStateChange?.(combined, null);
    } catch (cause) {
      const message = userFacingError(cause, 'Findings could not be loaded.');
      if (!loadedFindingsRef.current.loaded) setFindings([]);
      setLoadError(message);
      onLoadStateChange?.(loadedFindingsRef.current.findings, message);
    } finally {
      setLoading(false);
    }
  }, [onLoadStateChange, projectId, sessionId, supplementalFindings]);

  useEffect(() => { void loadFindings(); }, [loadFindings, refreshKey]);
  useEffect(() => {
    setVisibleCount(FINDINGS_BATCH_SIZE);
    setPage(0);
  }, [filterSource, filterSeverity, filterStatus, filterPriority, filterRiskLevel, filterCategory, searchQuery]);

  useEffect(() => {
    setFilterRiskLevel(initialFilter?.riskLevel ?? 'all');
    setFilterStatus(initialFilter?.status ?? 'all');
    setFilterCategory(initialFilter?.category ?? 'all');
    setSearchQuery(initialFilter?.search ?? '');
  }, [initialFilter?.category, initialFilter?.riskLevel, initialFilter?.search, initialFilter?.status]);

  const hasPriorityFilter = presentation === 'project' || findings.some(finding => Boolean(finding.priority));
  const priorityOptions = useMemo(() => Array.from(new Set(findings.map(finding => finding.priority).filter(Boolean) as string[])).sort((a, b) => (SEVERITY_ORDER[a.toLowerCase()] ?? 99) - (SEVERITY_ORDER[b.toLowerCase()] ?? 99)), [findings]);
  const categoryOptions = useMemo(() => Array.from(new Set(findings.map(finding => finding.category?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [findings]);
  const activeFilters = [
    filterSource !== 'all' ? { key: 'source', label: 'Source', value: sourceLabel(filterSource as Finding['source']) } : null,
    filterSeverity !== 'all' ? { key: 'severity', label: 'Severity', value: filterSeverity } : null,
    filterStatus !== 'all' ? { key: 'status', label: 'Status', value: findingStatusLabel(filterStatus) } : null,
    filterPriority !== 'all' ? { key: 'priority', label: 'Priority', value: filterPriority } : null,
    filterRiskLevel !== 'all' ? { key: 'risk', label: 'Risk level', value: filterRiskLevel === 'critical_or_high' ? 'Critical + High' : filterRiskLevel } : null,
    filterCategory !== 'all' ? { key: 'category', label: 'Category', value: filterCategory } : null,
  ].filter((entry): entry is { key: string; label: string; value: string } => Boolean(entry));

  const handleUpdateStatus = async (findingId: string, status: Finding['status']) => {
    setUpdatingId(findingId);
    setActionError(null);
    try {
      await api.updateFinding(projectId, findingId, status);
      setFindings(previous => {
        const updated = previous.map(finding => finding.id === findingId ? { ...finding, status } : finding);
        loadedFindingsRef.current = { loaded: loadedFindingsRef.current.loaded, findings: updated };
        return updated;
      });
    } catch (cause) {
      setActionError(`Finding could not be updated. Your previous state is still shown. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const sorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const compareFindings = (a: Finding, b: Finding) => {
      if (presentation === 'project') {
        const riskComparison = riskLevelRank(findingRiskLevel(a)) - riskLevelRank(findingRiskLevel(b));
        if (riskComparison !== 0) return riskComparison;
        const priorityComparison = priorityRank(a.priority) - priorityRank(b.priority);
        if (priorityComparison !== 0) return priorityComparison;
      }
      const severityComparison = (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 99) - (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 99);
      if (severityComparison !== 0) return severityComparison;
      const recencyComparison = Date.parse(updatedTime(b)) - Date.parse(updatedTime(a));
      if (recencyComparison !== 0) return recencyComparison;
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    };
    return findings
      .filter(finding => {
        if (filterSource !== 'all' && finding.source !== filterSource) return false;
        if (filterSeverity !== 'all' && finding.severity.toLowerCase() !== filterSeverity) return false;
        if (filterStatus !== 'all' && displayedFindingStatus(finding) !== filterStatus) return false;
        if (filterPriority !== 'all' && finding.priority !== filterPriority) return false;
        if (filterRiskLevel !== 'all') {
          const level = findingRiskLevel(finding);
          if (filterRiskLevel === 'critical_or_high' ? level !== 'critical' && level !== 'high' : level !== filterRiskLevel) return false;
        }
        if (filterCategory !== 'all' && finding.category?.trim().toLowerCase() !== filterCategory.toLowerCase()) return false;
        if (query && ![finding.title, finding.description, finding.filePath, finding.category, finding.evidenceText, ...findingSourceReferences(finding).map(ref => ref.filePath), ...(finding.location?.logicFlow ?? []), findingDomain(finding), groupFindings([finding])[0].title, sourceLabel(finding.source)].some(value => value?.toLowerCase().includes(query))) return false;
        return true;
      })
      .sort(compareFindings);
  }, [filterCategory, filterPriority, filterRiskLevel, filterSeverity, filterSource, filterStatus, findings, presentation, searchQuery]);

  const grouped = useMemo(() => groupFindings(sorted), [sorted]);
  const pageCount = Math.max(1, Math.ceil(grouped.length / pageSize));
  const pagedFindings = (presentation === 'project'
    ? grouped.slice(page * pageSize, page * pageSize + pageSize)
    : grouped.slice(0, visibleCount)).map(group => ({ ...group.representative, title: group.title }));

  useEffect(() => { setPage(current => Math.min(current, pageCount - 1)); }, [pageCount]);
  useEffect(() => {
    if (presentation === 'project' && selectedId && !sorted.some(finding => finding.id === selectedId)) setSelectedId(null);
  }, [presentation, selectedId, sorted]);
  useEffect(() => {
    if (presentation !== 'project' || !focusFindingId) return;
    const index = grouped.findIndex(group => group.members.some(finding => finding.id === focusFindingId));
    if (index < 0) return;
    setPage(Math.floor(index / pageSize));
    setSelectedId(focusFindingId);
  }, [focusFindingId, pageSize, presentation, grouped]);

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSource('all');
    setFilterSeverity('all');
    setFilterStatus('all');
    setFilterPriority('all');
    setFilterRiskLevel('all');
    setFilterCategory('all');
    setExpandedId(null);
  };

  const clearFilter = (key: string) => {
    if (key === 'source') setFilterSource('all');
    if (key === 'severity') setFilterSeverity('all');
    if (key === 'status') setFilterStatus('all');
    if (key === 'priority') setFilterPriority('all');
    if (key === 'risk') setFilterRiskLevel('all');
    if (key === 'category') setFilterCategory('all');
    setExpandedId(null);
  };

  const filterPrefix = presentation === 'project' ? 'project-' : '';
  const isProjectFindings = presentation === 'project' && !sessionId;
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
        <label className="finding-filter-field" htmlFor="finding-status-filter"><span>Status</span><Select id="finding-status-filter" aria-label="Status" value={filterStatus} onChange={value => setFilterStatus(value as 'all' | FindingPresentationStatus)} options={[{ value: 'all', label: 'All statuses' }, { value: 'unresolved', label: 'Unresolved' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismiss', label: 'Dismiss' }]} /></label>
        {hasPriorityFilter && <label className="finding-filter-field" htmlFor="finding-priority-filter"><span>Priority</span><Select id="finding-priority-filter" aria-label="Priority" value={filterPriority} onChange={setFilterPriority} options={[{ value: 'all', label: 'All priorities' }, ...priorityOptions.map(priority => ({ value: priority, label: priority }))]} /></label>}
        {presentation === 'project' && <label className="finding-filter-field" htmlFor="finding-risk-filter"><span>Risk level</span><Select id="finding-risk-filter" aria-label="Risk level" value={filterRiskLevel} onChange={setFilterRiskLevel} options={[{ value: 'all', label: 'All risk levels' }, { value: 'critical_or_high', label: 'Critical + High' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /></label>}
        {categoryOptions.length > 0 && <label className="finding-filter-field" htmlFor="finding-category-filter"><span>Category</span><Select id="finding-category-filter" aria-label="Category" value={filterCategory} onChange={setFilterCategory} options={[{ value: 'all', label: 'All categories' }, ...categoryOptions.map(category => ({ value: category, label: category }))]} /></label>}
      </div>}
    </div>
  );

  if (loading && isProjectFindings && !loadedFindingsRef.current.loaded) return (
    <section className="card detail-card findings-card findings-panel findings-panel-project" aria-label="Project findings">
      <div className="panel-header findings-project-header"><h3>Findings</h3></div>
      {loadError && <div className="command-inline-alert" role="alert">{loadError}</div>}
      <LoadingSkeleton variant="rows" rows={5} label="Loading findings" />
    </section>
  );

  if (loading && !isProjectFindings) return <div className="panel-loading" role="status">Loading findings...</div>;

  if (presentation === 'project') {
    const selectedGroup = grouped.find(group => group.members.some(finding => finding.id === selectedId));
    const selectedFinding = selectedGroup?.members.find(finding => finding.id === selectedId) ?? null;
    if (selectedGroup && selectedFinding) return <><div>{actionError && <p role="alert">{actionError}</p>}</div><FindingDocument group={selectedGroup} selectedId={selectedFinding.id} onSelect={setSelectedId} onBack={() => returnToFindings(selectedGroup.representative.id)} onOpenReview={onOpenReview} actions={finding => <FindingActions readOnly={readOnly} finding={finding} updatingId={updatingId} onUpdate={(id,status) => void handleUpdateStatus(id,status)} />} /></>;
    return (
      <div className={`project-findings-layout findings-table-only${isProjectFindings ? ' project-findings-project-only' : ''}`}>
        <section className="card detail-card findings-card findings-panel findings-panel-project" aria-labelledby="project-findings-heading">
          <div className="panel-header findings-project-header"><h3 id="project-findings-heading"><FileSearch size={18} aria-hidden="true" /> Findings</h3><strong className="findings-project-total">{groupFindings(findings).length} issue types · {findings.length} flagged items</strong></div>
          {loading && loadedFindingsRef.current.loaded && <p className="findings-panel-refreshing" role="status">Refreshing findings…</p>}
          {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
          {supplementalUnavailableMessage && <p className="findings-supplemental-context" role="status">{supplementalUnavailableMessage}</p>}
          {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}
          {findings.length > 0 && filterToolbar(false)}
          {sorted.length === 0 ? <div className="findings-empty-state"><p className="card-empty">{findings.length === 0 && supplementalUnavailableMessage ? 'No current findings are available in this view. Some document evidence is unavailable; see the message above.' : findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p></div> : (
            <section className="project-findings-table-region" aria-label="Findings table">
              <table className={`project-findings-table${isProjectFindings ? ' project-findings-table-project' : ''}`} aria-label={sessionId ? 'Review findings' : 'Project findings'}><thead><tr>
                <th scope="col">ID</th>
                {isProjectFindings
                  ? <><th scope="col">Findings</th><th scope="col">Risk</th><th scope="col">Priority</th></>
                  : <><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Severity</th><th scope="col">Risk</th><th scope="col">Domain</th><th scope="col">Finding</th></>}
              </tr></thead><tbody>
                {pagedFindings.map(finding => { const group = grouped.find(item => item.representative.id === finding.id)!; return <tr id={`finding-row-${finding.id}`} key={finding.id} tabIndex={0} aria-selected={group.members.some(item => item.id === selectedId)} className={group.members.some(item => item.id === selectedId) ? 'selected' : undefined} onClick={event => openFinding(finding.id, event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFinding(finding.id, event.currentTarget); } }}>
                  <td><span className="finding-id-label" title={entityIdTitle('Finding ID:', finding.id)}>{formatEntityId(finding.id)}</span></td>
                  {isProjectFindings
                    ? <><td><span className="project-finding-description"><strong>{finding.title}</strong><small>{group.members.length > 1 ? `${group.members.length} affected occurrences` : finding.filePath || finding.description || 'No location supplied'}</small><button type="button" className="finding-see-more" onClick={event => { event.stopPropagation(); const row = event.currentTarget.closest<HTMLElement>('tr'); if (row) openFinding(finding.id, row); }} aria-label={`See more about ${finding.title}`}>… See more</button></span></td><td><RiskBadge finding={finding} /></td><td><PriorityBadge priority={finding.priority} /></td></>
                    : <><td><span className={`finding-status finding-status-${groupStatus(group).toLowerCase()}`}>{groupStatus(group)}</span></td><td aria-label={finding.priority || 'Not set'}><span className="project-finding-priority">{finding.priority || '—'}</span></td><td><SeverityBadge severity={finding.severity} /></td><td><RiskBadge finding={finding} /></td><td>{findingGroupDomains(group)}</td><td><span className="project-finding-description"><strong>{finding.title}</strong><small>{group.members.length > 1 ? `${group.members.length} affected occurrences` : finding.filePath || finding.description || 'No location supplied'}</small><button type="button" className="finding-see-more" onClick={event => { event.stopPropagation(); const row = event.currentTarget.closest<HTMLElement>('tr'); if (row) openFinding(finding.id, row); }} aria-label={`See more about ${finding.title}`}>… See more</button></span></td></>}
                </tr>; })}
              </tbody></table>
              {pageCount > 1 && <div className="findings-pagination" aria-label="Finding pages"><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>Next</button></div>}
            </section>
          )}
        </section>


      </div>
    );
  }

  return (
    <div className="findings-panel">
      <div className="panel-header"><div><h3>Findings</h3><p className="panel-description">Triage issues from Review and Dynamic Testing in one list.</p></div><span className="findings-total-count">{groupFindings(findings).length} issue types · {findings.length} flagged items</span></div>
      {loadError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> Findings could not be loaded. <button type="button" className="btn-link" onClick={() => void loadFindings()}>Retry</button></div>}
      {actionError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {actionError}</div>}
      {findings.length > 0 && filterToolbar(true)}
      {sorted.length === 0 ? <div className="findings-empty-state"><p className="card-empty">{findings.length === 0 ? 'No findings yet. Run a Review or Dynamic Testing activity to generate findings.' : 'No findings match the current filters.'}</p></div> : <>
        <div className="findings-list">
          {pagedFindings.map(row => {
            const group = grouped.find(item => item.representative.id === row.id)!;
            const finding = group.members.find(item => item.id === selectedId) ?? group.representative;
            const expanded = expandedId === row.id;
            const detailId = `finding-detail-${finding.id}`;
            return <div key={row.id} className={`finding-row finding-${displayedFindingStatus(finding)}`}>
              <button type="button" className="finding-header" onClick={() => setExpandedId(expanded ? null : row.id)} aria-expanded={expanded} aria-controls={detailId}>
                <span className="finding-id-label" title={entityIdTitle('Finding ID:', finding.id)}>{formatEntityId(finding.id)}</span><SeverityBadge severity={finding.severity} /><span className="finding-title">{group.title}{group.members.length > 1 && <small className="finding-group-count">{group.members.length} affected occurrences</small>}</span><span className={`badge badge-source-${finding.source}`}>{originLabel(finding)}</span><span className={`finding-status finding-status-${groupStatus(group).toLowerCase()}`}>{groupStatus(group)}</span><time dateTime={updatedTime(finding)} title={`Updated ${new Date(updatedTime(finding)).toLocaleString()}`}>{new Date(updatedTime(finding)).toLocaleDateString()}</time><ChevronDown className="finding-disclosure" size={16} aria-hidden="true" />
              </button>
              {expanded && <div className="finding-detail" id={detailId} role="region" aria-label={`${group.title} details`}>
                <div className="finding-detail-content">
                  <div className="finding-source-status">{(finding.source !== 'static' || finding.verifier === 'readiness') && <strong>{originLabel(finding)}</strong>}<span className={`finding-status finding-status-${displayedFindingStatus(finding)}`}>{findingStatusLabel(displayedFindingStatus(finding))}</span></div>
                  <div className="finding-detail-title-status"><h4>{group.title}</h4><span className="finding-id-label" title={entityIdTitle('Finding ID:', finding.id)}>{formatEntityId(finding.id)}</span></div>
                  <dl className="finding-facts"><div><dt>Priority</dt><dd>{finding.priority || 'Not set'}</dd></div><div><dt>Risk Level</dt><dd><RiskBadge finding={finding} /></dd></div><div><dt>Location</dt><dd className="finding-location-path">{locationLabel(finding)}</dd></div></dl>
                  <FindingOccurrences group={group} selectedId={finding.id} onSelect={setSelectedId} /><FindingEvidence key={finding.id} finding={finding} />
                  <section><h4>Description</h4><p className="finding-description">{finding.description || 'No description was supplied.'}</p></section>
                  {finding.recommendation && <section className="finding-recommendation"><h4>Recommendation</h4><p>{finding.recommendation}</p></section>}
                  {finding.evidenceText && <section className="finding-evidence"><h4>Evidence</h4><pre>{finding.evidenceText}</pre></section>}
                </div>
                <FindingActions readOnly={readOnly} finding={finding} updatingId={updatingId} onUpdate={(id, status) => void handleUpdateStatus(id, status)} />
              </div>}
            </div>;
          })}
        </div>
        {visibleCount < grouped.length && <div className="findings-more"><button className="btn-secondary" type="button" onClick={() => setVisibleCount(count => count + FINDINGS_BATCH_SIZE)}>Show {Math.min(FINDINGS_BATCH_SIZE, grouped.length - visibleCount)} more</button></div>}
      </>}
    </div>
  );
}
