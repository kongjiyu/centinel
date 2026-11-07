import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import { DynamicSavedTestActions, DynamicSavedTestList } from './DynamicSavedTests';
import { DynamicRunHistory } from './DynamicRunHistory';
import { filterRuns, savedTestEntries, savedTestName } from '../dynamic/savedTests';
import type { DynamicRun, Mission, MissionRevision } from '../dynamic/types';

vi.mock('../api/client', () => ({ api: { renameDynamicMission: vi.fn(), setDynamicMissionArchived: vi.fn() } }));

const revision = (id: string, missionId: string, name: string): MissionRevision => ({
  id,
  missionId,
  projectId: 'project-a',
  revision: 1,
  createdBy: 'actor',
  createdAt: '2026-11-01T00:00:00Z',
  name,
  goal: 'Goal',
  targetUrl: 'http://localhost:3000',
  maxSteps: 5,
  context: null,
  contextAcknowledged: false,
  checks: [{ id: 'c', criterionId: 'manual-c', description: 'Check', kind: 'visible_text', expected: 'Ok', required: true }],
});
const mission = (id: string, revisionId: string, extra: Partial<Mission> = {}): Mission => ({
  id,
  projectId: 'project-a',
  currentRevisionId: revisionId,
  createdBy: 'actor',
  createdAt: '2026-11-01T00:00:00Z',
  ...extra,
});
const revisions = [revision('r1', 'm1', 'Sign-in smoke'), revision('r2', 'm2', 'Old checkout')];
const missions = [mission('m1', 'r1'), mission('m2', 'r2', { archivedAt: '2026-11-05T10:00:00Z', archivedBy: 'actor' })];
const run = (id: string, missionId: string, state: DynamicRun['state'], verdict: DynamicRun['verdict']): DynamicRun => ({
  id,
  projectId: 'project-a',
  missionId,
  revision: revisions.find((item) => item.missionId === missionId)!,
  idempotencyKey: id,
  createdBy: 'actor',
  createdAt: '2026-11-02T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  state,
  verdict,
  checks: [],
  evidence: [],
  reason: null,
  legacySessionId: null,
});
const label = (value: string) => value;

beforeEach(() => vi.clearAllMocks());

describe('saved test helpers', () => {
  it('groups runs by result and saved test', () => {
    const runs = [
      run('a', 'm1', 'completed', 'passed'),
      run('b', 'm1', 'completed', 'failed'),
      run('c', 'm2', 'blocked', 'not_tested'),
      run('d', 'm2', 'interrupted', 'not_tested'),
      run('e', 'm1', 'running', 'not_tested'),
      run('f', 'm1', 'queued', 'not_tested'),
      run('g', 'm1', 'completed', 'uncertain'),
      run('h', 'm1', 'cancelled', 'not_tested'),
    ];
    expect(filterRuns(runs, 'passed', 'all').map((item) => item.id)).toEqual(['a']);
    expect(filterRuns(runs, 'failed', 'all').map((item) => item.id)).toEqual(['b']);
    expect(filterRuns(runs, 'blocked', 'all').map((item) => item.id)).toEqual(['c', 'd']);
    expect(filterRuns(runs, 'running', 'all').map((item) => item.id)).toEqual(['e', 'f']);
    expect(filterRuns(runs, 'uncertain', 'all').map((item) => item.id)).toEqual(['g']);
    expect(filterRuns(runs, 'all', 'm2').map((item) => item.id)).toEqual(['c', 'd']);
    expect(filterRuns(runs, 'all', 'all')).toHaveLength(8);
  });
  it('prefers a rename over the revision name', () => {
    expect(savedTestName(mission('m1', 'r1', { displayName: 'Renamed' }), revisions[0])).toBe('Renamed');
    expect(savedTestName(missions[0], revisions[0])).toBe('Sign-in smoke');
    expect(savedTestEntries(missions, [revisions[0]])).toHaveLength(1);
  });
});

describe('Saved test list', () => {
  it('hides archived tests until Show archived is selected', async () => {
    const user = userEvent.setup();
    render(
      <DynamicSavedTestList
        entries={savedTestEntries(missions, revisions)}
        selectedMissionId={null}
        loading={false}
        disabled={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Sign-in smoke/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Old checkout/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show archived (1)' }));
    expect(screen.getByRole('button', { name: /Old checkout/ })).toHaveTextContent('Archived');
    await user.click(screen.getByRole('checkbox', { name: 'Show archived (1)' }));
    expect(screen.queryByRole('button', { name: /Old checkout/ })).not.toBeInTheDocument();
  });
  it('omits the toggle when nothing is archived', () => {
    render(
      <DynamicSavedTestList
        entries={savedTestEntries([missions[0]], revisions)}
        selectedMissionId={null}
        loading={false}
        disabled={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: /Show archived/ })).not.toBeInTheDocument();
  });
});

describe('Saved test actions', () => {
  const renderActions = (target: Mission, onChanged = vi.fn(), onError = vi.fn()) =>
    render(
      <DynamicSavedTestActions
        projectId="project-a"
        mission={target}
        revision={revisions.find((item) => item.missionId === target.id)}
        disabled={false}
        onBusy={vi.fn()}
        onChanged={onChanged}
        onError={onError}
      />,
    );
  it('renames the saved test only', async () => {
    vi.mocked(api.renameDynamicMission).mockResolvedValue(mission('m1', 'r1', { displayName: 'Login smoke' }));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderActions(missions[0], onChanged);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Saved test name');
    expect(input).toHaveValue('Sign-in smoke');
    await user.clear(input);
    await user.type(input, 'Login smoke');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(api.renameDynamicMission).toHaveBeenCalledWith('project-a', 'm1', 'Login smoke'));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Login smoke' }), expect.stringContaining('Earlier runs keep'));
  });
  it('archives and unarchives without deleting', async () => {
    vi.mocked(api.setDynamicMissionArchived).mockResolvedValue(missions[1]);
    const user = userEvent.setup();
    const { unmount } = renderActions(missions[0]);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.setDynamicMissionArchived).toHaveBeenCalledWith('project-a', 'm1', true));
    unmount();
    renderActions(missions[1]);
    expect(screen.getByText(/cannot be edited or run until you unarchive it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(api.setDynamicMissionArchived).toHaveBeenCalledWith('project-a', 'm2', false));
  });
  it('reports failures without changing local state', async () => {
    vi.mocked(api.setDynamicMissionArchived).mockRejectedValue(new Error('Forbidden'));
    const onChanged = vi.fn();
    const onError = vi.fn();
    const user = userEvent.setup();
    renderActions(missions[0], onChanged, onError);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Run history filters', () => {
  const renderHistory = (runs: DynamicRun[]) =>
    render(
      <DynamicRunHistory
        runs={runs}
        savedTests={savedTestEntries(missions, revisions)}
        selectedRunId=""
        loading={false}
        stateLabel={(item) => item.state}
        verdictLabel={label}
        onOpen={vi.fn()}
      />,
    );
  const list = () => document.querySelector('.dw-run-list') as HTMLElement;
  it('filters by result and by saved test, including archived tests', async () => {
    const user = userEvent.setup();
    renderHistory([
      run('a', 'm1', 'completed', 'passed'),
      run('b', 'm1', 'completed', 'failed'),
      run('c', 'm2', 'completed', 'failed'),
    ]);
    expect(within(list()).getAllByRole('button')).toHaveLength(3);
    await user.click(screen.getByRole('combobox', { name: 'Result' }));
    await user.click(screen.getByRole('option', { name: 'Failed' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText(/Showing 2 of 2 runs/)).toHaveTextContent('filtered from 3');
    await user.click(screen.getByRole('combobox', { name: 'Saved test' }));
    await user.click(screen.getByRole('option', { name: 'Old checkout (archived)' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
    expect(within(list()).getByRole('button')).toHaveTextContent('Old checkout');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(3);
  });
  it('explains when no runs match', async () => {
    const user = userEvent.setup();
    renderHistory([run('a', 'm1', 'completed', 'passed')]);
    await user.click(screen.getByRole('combobox', { name: 'Result' }));
    await user.click(screen.getByRole('option', { name: 'Queued or running' }));
    expect(screen.getByText('No runs match these filters.')).toBeInTheDocument();
  });
  it('pages long histories with Show more', async () => {
    const user = userEvent.setup();
    renderHistory(Array.from({ length: 45 }, (_, index) => run(`run-${index}`, 'm1', 'completed', 'passed')));
    expect(within(list()).getAllByRole('button')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
  });
});
