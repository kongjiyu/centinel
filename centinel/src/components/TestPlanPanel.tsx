/**
 * TestPlanPanel (Group 2c).
 *
 * Renders the per-module test plan for the project's most recent
 * completed review. Collapsible module cards show the rollup counts
 * (proposed / accepted / in_progress / passed / failed) and the
 * individual test items with status pills and Accept / Reject
 * buttons. A "Regenerate" button re-runs the generator on demand.
 *
 * For the FYP scope the "Run" hand-off to the dynamic runner is a
 * follow-up; the items themselves are the deliverable here.
 */

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, RotateCcw, Check, X, RefreshCw, ChevronDown, ChevronRight, FileText, GitBranch } from 'lucide-react';
import { api } from '../api/client';
import type { TestItem, TestItemRollup, TestItemStatus } from '../types';

type Props = {
  projectId: string;
  /** When set, only items from this session are shown. Otherwise the
   *  panel aggregates across all sessions for the project (per-module
   *  rollups + the items that landed in the latest session per module). */
  sessionId?: string;
};

const STATUS_LABEL: Record<TestItemStatus, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  in_progress: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
};

const STATUS_CLASS: Record<TestItemStatus, string> = {
  proposed: 'test-item-status-proposed',
  accepted: 'test-item-status-accepted',
  rejected: 'test-item-status-rejected',
  in_progress: 'test-item-status-in_progress',
  passed: 'test-item-status-passed',
  failed: 'test-item-status-failed',
};

export function TestPlanPanel({ projectId, sessionId }: Props) {
  const [rollups, setRollups] = useState<TestItemRollup[]>([]);
  const [items, setItems] = useState<TestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, i] = await Promise.all([
        api.listTestItemRollups(projectId),
        api.listTestItems(projectId, sessionId ? { sessionId } : {}),
      ]);
      setRollups(r);
      setItems(i);
      // Auto-open the first 3 modules so the panel isn't an empty
      // wall of closed cards on first load.
      if (openModules.size === 0 && r.length > 0) {
        setOpenModules(new Set(r.slice(0, 3).map(x => x.module)));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionId, openModules.size]);

  useEffect(() => { void load(); }, [load]);

  const handleStatus = useCallback(async (itemId: string, status: TestItemStatus) => {
    try {
      const updated = await api.updateTestItemStatus(projectId, itemId, status);
      setItems(prev => prev.map(i => (i.id === itemId ? updated : i)));
      // Bump the rollup too so the module totals stay in sync.
      setRollups(prev => prev.map(r => recomputeRollup(r, items, itemId, status)));
    } catch (e) {
      setError(String(e));
    }
  }, [projectId, items]);

  const handleRegenerate = useCallback(async () => {
    if (!sessionId) return;
    setRegenerating(true);
    setError(null);
    try {
      await api.regenerateTestPlan(projectId, sessionId);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRegenerating(false);
    }
  }, [projectId, sessionId, load]);

  const toggleModule = (m: string) => {
    setOpenModules(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  if (loading) return <div className="panel-loading">Loading test plan...</div>;

  const totalItems = rollups.reduce((sum, r) => sum + r.total, 0);
  const totalAccepted = rollups.reduce((sum, r) => sum + r.accepted + r.passed, 0);

  if (rollups.length === 0) {
    return (
      <div className="test-plan-panel">
        <div className="test-plan-panel-header">
          <h3><ClipboardList size={14} /> Test Plan</h3>
        </div>
        <p className="card-empty">No test items yet. Run a static review to generate one.</p>
      </div>
    );
  }

  return (
    <div className="test-plan-panel" data-testid="test-plan-panel">
      <div className="test-plan-panel-header">
        <h3>
          <ClipboardList size={14} /> Test Plan
          <span className="test-plan-panel-count">
            {rollups.length} module{rollups.length === 1 ? '' : 's'} · {totalItems} item{totalItems === 1 ? '' : 's'} · {totalAccepted} accepted
          </span>
        </h3>
        {sessionId && (
          <button
            className="btn-ghost"
            onClick={handleRegenerate}
            disabled={regenerating}
            data-testid="test-plan-regenerate"
            type="button"
          >
            <RotateCcw size={12} /> {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        )}
      </div>

      {error && <div className="review-decision-error" role="alert">{error}</div>}

      <div className="test-plan-modules">
        {rollups.map(r => {
          const moduleItems = items.filter(i => i.module === r.module);
          const isOpen = openModules.has(r.module);
          return (
            <div key={r.module} className="test-plan-module" data-testid={`test-plan-module-${r.module}`}>
              <button
                className="test-plan-module-header"
                onClick={() => toggleModule(r.module)}
                data-testid={`test-plan-module-toggle-${r.module}`}
                type="button"
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="test-plan-module-name">
                  <GitBranch size={11} /> {r.module}
                </span>
                <span className="test-plan-module-stats">
                  {r.proposed > 0 && <span className="test-plan-stat proposed">{r.proposed} proposed</span>}
                  {r.accepted > 0 && <span className="test-plan-stat accepted">{r.accepted} accepted</span>}
                  {r.inProgress > 0 && <span className="test-plan-stat in_progress">{r.inProgress} in progress</span>}
                  {r.passed > 0 && <span className="test-plan-stat passed">{r.passed} passed</span>}
                  {r.failed > 0 && <span className="test-plan-stat failed">{r.failed} failed</span>}
                  {r.rejected > 0 && <span className="test-plan-stat rejected">{r.rejected} rejected</span>}
                </span>
              </button>
              {isOpen && (
                <ul className="test-plan-items">
                  {moduleItems.map(item => (
                    <li key={item.id} className="test-plan-item" data-testid={`test-plan-item-${item.id}`}>
                      <div className="test-plan-item-main">
                        <span className={`test-plan-item-kind kind-${item.kind}`}>{item.kind}</span>
                        <span className="test-plan-item-title">{item.title}</span>
                        <span className={`test-item-status ${STATUS_CLASS[item.status]}`}>
                          {STATUS_LABEL[item.status]}
                        </span>
                      </div>
                      <p className="test-plan-item-desc">{item.description}</p>
                      {item.filePath && (
                        <div className="test-plan-item-location">
                          <FileText size={11} /> {item.filePath}{item.lineNumber ? ':' + item.lineNumber : ''}
                        </div>
                      )}
                      {item.rationale && (
                        <div className="test-plan-item-rationale">
                          Rationale: {item.rationale === 'smoke' ? 'module smoke test' : `finding ${item.rationale}`}
                        </div>
                      )}
                      <div className="test-plan-item-actions">
                        {item.status === 'proposed' && (
                          <>
                            <button
                              className="btn-decision btn-decision-approve"
                              onClick={() => handleStatus(item.id, 'accepted')}
                              data-testid={`test-plan-accept-${item.id}`}
                              type="button"
                            >
                              <Check size={12} /> Accept
                            </button>
                            <button
                              className="btn-decision btn-decision-changes"
                              onClick={() => handleStatus(item.id, 'rejected')}
                              data-testid={`test-plan-reject-${item.id}`}
                              type="button"
                            >
                              <X size={12} /> Reject
                            </button>
                          </>
                        )}
                        {item.status === 'accepted' && (
                          <span className="test-plan-item-accepted-note">Accepted — ready for the dynamic runner</span>
                        )}
                      </div>
                    </li>
                  ))}
                  {moduleItems.length === 0 && (
                    <li className="test-plan-item-empty">No items in this module.</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function recomputeRollup(
  r: TestItemRollup,
  items: TestItem[],
  itemId: string,
  newStatus: TestItemStatus
): TestItemRollup {
  const item = items.find(i => i.id === itemId);
  if (!item || item.module !== r.module) return r;
  // Re-derive from scratch to avoid drift. Small enough (per-module
  // count is bounded by the AI's per-finding cap of ~3 items) that
  // re-aggregation is cheap and correct.
  const others = items.filter(i => i.module === r.module && i.id !== itemId);
  const all = [...others, { ...item, status: newStatus }];
  const counts: TestItemRollup = {
    module: r.module,
    total: all.length,
    proposed: 0, accepted: 0, rejected: 0, inProgress: 0, passed: 0, failed: 0,
  };
  for (const i of all) {
    if (i.status === 'proposed') counts.proposed++;
    else if (i.status === 'accepted') counts.accepted++;
    else if (i.status === 'rejected') counts.rejected++;
    else if (i.status === 'in_progress') counts.inProgress++;
    else if (i.status === 'passed') counts.passed++;
    else if (i.status === 'failed') counts.failed++;
  }
  return counts;
}
