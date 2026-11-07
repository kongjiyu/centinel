import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { api } from '../api/client';
import { formatActivityTime } from '../hooks/useProjectSummaries';
import { userFacingError } from '../utils/userFacingError';
import { savedTestName, type SavedTestEntry } from '../dynamic/savedTests';
import type { Mission, MissionRevision } from '../dynamic/types';

type ListProps = {
  entries: SavedTestEntry[];
  selectedMissionId: string | null;
  loading: boolean;
  disabled: boolean;
  onOpen(revision: MissionRevision): void;
};

/** Saved tests list. Archived tests stay out of the default list until the tester asks to see them. */
export function DynamicSavedTestList({ entries, selectedMissionId, loading, disabled, onOpen }: ListProps) {
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = entries.filter((entry) => entry.mission.archivedAt).length;
  const visible = showArchived ? entries : entries.filter((entry) => !entry.mission.archivedAt);
  return (
    <>
      <div className="dw-list-heading">
        <h3>Saved tests</h3>
        {archivedCount > 0 && (
          <label className="dw-required">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{' '}
            Show archived ({archivedCount})
          </label>
        )}
      </div>
      {!loading && !entries.length && <p className="dw-muted">Your saved tests will appear here.</p>}
      {!loading && entries.length > 0 && !visible.length && (
        <p className="dw-muted">All saved tests are archived. Select Show archived to open one.</p>
      )}
      <div className="dw-saved-list">
        {visible.map(({ mission, revision }) => (
          <button
            type="button"
            className={selectedMissionId === mission.id ? 'selected' : ''}
            key={mission.id}
            disabled={disabled}
            onClick={() => onOpen(revision)}
          >
            <strong>{savedTestName(mission, revision)}</strong>
            <span>
              Revision {revision.revision} · {revision.checks.length} checks
              {mission.archivedAt ? ' · Archived' : ''}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

type ActionProps = {
  projectId: string;
  mission: Mission;
  revision: MissionRevision | undefined;
  disabled: boolean;
  onBusy(busy: boolean): void;
  onChanged(mission: Mission, message: string): void;
  onError(message: string): void;
};

/** Rename and archive act on the saved test only. Revisions, Runs and evidence are kept unchanged. */
export function DynamicSavedTestActions({ projectId, mission, revision, disabled, onBusy, onChanged, onError }: ActionProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [working, setWorking] = useState(false);
  const currentName = savedTestName(mission, revision);
  const run = async (action: () => Promise<Mission>, message: (mission: Mission) => string) => {
    setWorking(true);
    onBusy(true);
    try {
      const updated = await action();
      setRenaming(false);
      onChanged(updated, message(updated));
    } catch (error) {
      onError(userFacingError(error, 'The saved test could not be updated. Refresh to see its current state.'));
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  const archived = Boolean(mission.archivedAt);
  return (
    <div className="dw-saved-test-actions">
      {renaming ? (
        <form
          className="dw-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => api.renameDynamicMission(projectId, mission.id, draftName),
              (updated) =>
                `Renamed to “${updated.displayName ?? draftName.trim()}”. Earlier runs keep the name they were recorded with.`,
            );
          }}
        >
          <div className="dw-field">
            <label htmlFor="dw-rename-input">Saved test name</label>
            <input
              id="dw-rename-input"
              required
              maxLength={120}
              value={draftName}
              disabled={working || disabled}
              onChange={(event) => setDraftName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="dw-actions">
            <button type="submit" className="btn-secondary" disabled={working || disabled || !draftName.trim()}>
              {working ? 'Saving name…' : 'Save name'}
            </button>
            <button type="button" className="btn-secondary" disabled={working} onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="dw-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={working || disabled}
            onClick={() => {
              setDraftName(currentName);
              setRenaming(true);
            }}
          >
            <Pencil size={16} /> Rename
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={working || disabled}
            onClick={() =>
              void run(
                () => api.setDynamicMissionArchived(projectId, mission.id, !archived),
                () =>
                  archived
                    ? `Unarchived “${currentName}”. It can be edited and run again.`
                    : `Archived “${currentName}”. Its runs and evidence stay in history.`,
              )
            }
          >
            {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {working ? (archived ? ' Unarchiving…' : ' Archiving…') : archived ? ' Unarchive' : ' Archive'}
          </button>
        </div>
      )}
      {archived && mission.archivedAt && (
        <p className="dw-notice">
          Archived {formatActivityTime(mission.archivedAt)}. It is hidden from saved tests and cannot be edited or run
          until you unarchive it. Its runs and evidence remain in history.
        </p>
      )}
    </div>
  );
}
