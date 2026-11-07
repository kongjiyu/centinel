import { useEffect, useMemo, useState } from 'react';
import { Select } from '../components/Select';
import { formatActivityTime } from '../hooks/useProjectSummaries';
import {
  filterRuns,
  RUN_HISTORY_PAGE_SIZE,
  RUN_OUTCOME_FILTERS,
  savedTestName,
  type RunOutcomeFilter,
  type SavedTestEntry,
} from '../dynamic/savedTests';
import type { DynamicRun } from '../dynamic/types';

type Props = {
  runs: DynamicRun[];
  savedTests: SavedTestEntry[];
  selectedRunId: string;
  loading: boolean;
  stateLabel(run: DynamicRun): string;
  verdictLabel(value: string): string;
  onOpen(runId: string): void;
};

/** Immutable Run history with result and saved-test filters. Runs of archived tests remain listed. */
export function DynamicRunHistory({ runs, savedTests, selectedRunId, loading, stateLabel, verdictLabel, onOpen }: Props) {
  const [outcome, setOutcome] = useState<RunOutcomeFilter>('all');
  const [missionId, setMissionId] = useState('all');
  const [visibleCount, setVisibleCount] = useState(RUN_HISTORY_PAGE_SIZE);
  useEffect(() => setVisibleCount(RUN_HISTORY_PAGE_SIZE), [outcome, missionId]);
  const testOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const { mission, revision } of savedTests)
      options.set(mission.id, savedTestName(mission, revision) + (mission.archivedAt ? ' (archived)' : ''));
    // History may hold Runs whose saved test is not loaded; their recorded name still identifies them.
    for (const run of runs) if (!options.has(run.missionId)) options.set(run.missionId, run.revision.name);
    return [...options].map(([value, label]) => ({ value, label }));
  }, [runs, savedTests]);
  const filtered = filterRuns(runs, outcome, missionId);
  const shown = filtered.slice(0, visibleCount);
  const filtering = outcome !== 'all' || missionId !== 'all';
  return (
    <>
      <h3>Run history</h3>
      {!loading && !runs.length && <p className="dw-muted">Run a saved test to begin its history.</p>}
      {runs.length > 0 && (
        <div className="dw-history-filters">
          <div className="dw-field">
            <label htmlFor="dw-run-outcome">
              Result
            </label>
            <Select
              id="dw-run-outcome"
              value={outcome}
              options={RUN_OUTCOME_FILTERS}
              onChange={(value) => setOutcome(value as RunOutcomeFilter)}
            />
          </div>
          <div className="dw-field">
            <label htmlFor="dw-run-test">
              Saved test
            </label>
            <Select
              id="dw-run-test"
              value={missionId}
              options={[{ value: 'all', label: 'All saved tests' }, ...testOptions]}
              onChange={setMissionId}
            />
          </div>
        </div>
      )}
      {runs.length > 0 && (
        <p className="dw-muted dw-history-summary" aria-live="polite">
          Showing {shown.length} of {filtered.length} {filtered.length === 1 ? 'run' : 'runs'}
          {filtering ? ` (filtered from ${runs.length})` : ''}
          {filtering && (
            <>
              {' '}
              <button
                type="button"
                className="dw-link-button"
                onClick={() => {
                  setOutcome('all');
                  setMissionId('all');
                }}
              >
                Clear filters
              </button>
            </>
          )}
        </p>
      )}
      {runs.length > 0 && !filtered.length && <p className="dw-muted">No runs match these filters.</p>}
      <div className="dw-run-list">
        {shown.map((run) => (
          <button
            type="button"
            key={run.id}
            className={selectedRunId === run.id ? 'selected' : ''}
            onClick={() => onOpen(run.id)}
          >
            <strong>{run.revision.name}</strong>
            <span className="dw-run-outcome">
              <span>{stateLabel(run)}</span>
              <span className={`dw-verdict dw-${run.verdict}`}>{verdictLabel(run.verdict)}</span>
            </span>
            <small>
              Revision {run.revision.revision} · {formatActivityTime(run.createdAt)}
            </small>
          </button>
        ))}
      </div>
      {filtered.length > shown.length && (
        <button
          type="button"
          className="btn-secondary dw-show-more"
          onClick={() => setVisibleCount((count) => count + RUN_HISTORY_PAGE_SIZE)}
        >
          Show {Math.min(RUN_HISTORY_PAGE_SIZE, filtered.length - shown.length)} more
        </button>
      )}
    </>
  );
}
