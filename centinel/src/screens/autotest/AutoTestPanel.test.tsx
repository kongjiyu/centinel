import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { parseSseChunk, type LiveMessage } from '../../autotest/liveStream';
import { actionCaption, boxRect, cursorPoint, stageStatus } from '../../autotest/presentation';
import type { AutoTestSession } from '../../autotest/types';

const apiMock = vi.hoisted(() => ({ autoTests: vi.fn(), autoTest: vi.fn(), startAutoTest: vi.fn(), cancelAutoTest: vi.fn() }));
vi.mock('../../api/client', () => ({ api: apiMock }));
vi.mock('@tauri-apps/api/dialog', () => ({ open: vi.fn() }));
import { AutoTestPanel } from './AutoTestPanel';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const session = (overrides: Partial<AutoTestSession> = {}): AutoTestSession => ({
  schemaVersion: 1, id: '22222222-2222-4222-8222-222222222222', projectId: PROJECT, ownerId: 'u', folder: '/Users/me/shop',
  createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:01:00Z', stage: 'completed', error: null,
  repository: { fingerprint: 'f', files: 6, routes: 4, forms: 1, requirements: true, truncated: false, persistence: [] },
  launch: { recipeId: 'node-entry:server.js', label: 'node server.js', framework: 'node', url: 'http://localhost:5000', portHonored: true, installing: false, log: '' },
  exploration: { pages: [{ path: '/', controls: 8 }], controls: 8 },
  lanes: [{ id: 'lane-1', url: 'http://localhost:5000', environmentId: 'e', state: 'stopped', currentTestId: null }], laneLimit: 3, laneNote: null,
  tests: [
    { id: 't1', name: 'Demo shopper can sign in', goal: 'Sign in.', rationale: '', requirementRef: 'REQ-1', sourceRefs: [], checks: [{ id: 'c1', criterionId: 'REQ-1', description: 'Signed in', required: true, kind: 'visible_text', expected: 'Signed in as Demo Shopper' }], startPath: '/', state: 'passed', laneId: 'lane-1', runId: 'r1' },
    { id: 't2', name: 'Unknown email gets the generic error', goal: 'Type nobody@example.com.', rationale: '', requirementRef: 'REQ-1', sourceRefs: [{ path: 'server.js', line: 45 }],
      checks: [{ id: 'c2', criterionId: 'REQ-1', description: 'Generic error', required: true, kind: 'visible_text', expected: 'Email or password is incorrect.' }], startPath: '/', state: 'failed', laneId: 'lane-1', runId: 'r2',
      checkResults: [{ checkId: 'c2', criterionId: 'REQ-1', verdict: 'failed', observed: 'No account uses this email.', reason: '', evidenceIds: ['e'] }], explanation: 'The server reveals whether an email is registered (likely server.js:45).' },
  ],
  dropped: [{ name: 'Admin page', reason: 'Used controls Centinel did not find in the app.' }],
  summary: { passed: 1, failed: 1, uncertain: 0, blocked: 0, notTested: 0, limitations: ['Only the journeys listed were tested; this is not a complete test of the app.'] },
  ...overrides,
});

describe('Auto test presentation helpers', () => {
  it('parses SSE frames, actions and end records across chunk boundaries', () => {
    const seen: LiveMessage[] = [];
    let rest = parseSseChunk('retry: 2000\n\nevent: action\ndata: {"laneId":"lane-1","step":1,"action":"click","targetLabel":"Sign in","box":null,"viewport":{"width":1280,"height":720},"phase":"move"}\n\nevent: fra', message => seen.push(message));
    rest = parseSseChunk(rest + 'me\ndata: {"laneId":"lane-1","seq":1,"data":"AA=="}\n\nevent: end\ndata: {}\n\n', message => seen.push(message));
    expect(rest).toBe('');
    expect(seen.map(message => message.type)).toEqual(['action', 'frame', 'end']);
  });

  it('places the cursor at the target centre as a percentage and captions the action', () => {
    const event = { laneId: 'lane-1', step: 2, action: 'click', targetLabel: 'Sign in', box: { x: 600, y: 300, width: 80, height: 40 }, viewport: { width: 1280, height: 720 }, phase: 'move' as const };
    expect(cursorPoint(event)).toEqual({ x: 50, y: 44.44444444444444 });
    expect(boxRect(event)).toMatchObject({ left: 46.875, width: 6.25 });
    expect(actionCaption(event)).toBe('Clicking Sign in');
    expect(actionCaption({ ...event, action: 'type_secret', targetLabel: 'Password' })).toBe('Typing a private value into Password');
    expect(cursorPoint({ ...event, box: null })).toBeNull();
  });

  it('marks the stage a stopped session failed in', () => {
    const failed = session({ stage: 'failed', summary: null, exploration: null, tests: [], error: { reason: 'exited', message: 'The app stopped while starting.' } });
    expect(stageStatus(failed, 'reading')).toBe('done');
    expect(stageStatus(failed, 'exploring')).toBe('failed');
    expect(stageStatus(failed, 'planning')).toBe('upcoming');
  });
});

describe('AutoTestPanel', () => {
  beforeEach(() => { Object.values(apiMock).forEach(fn => fn.mockReset()); });

  it('starts an Auto test for the project folder', async () => {
    apiMock.autoTests.mockResolvedValue([]);
    apiMock.startAutoTest.mockResolvedValue(session({ stage: 'reading', summary: null, tests: [], lanes: [], launch: null, exploration: null, repository: null }));
    apiMock.autoTest.mockResolvedValue(session());
    render(<AutoTestPanel projectId={PROJECT} defaultFolder="/Users/me/shop" />);
    fireEvent.click(screen.getByRole('button', { name: /Start Auto test/ }));
    await waitFor(() => expect(apiMock.startAutoTest).toHaveBeenCalledWith(PROJECT, { folder: '/Users/me/shop' }));
    expect(await screen.findByText('Reading the code', { selector: 'h3' })).toBeInTheDocument();
  });

  it('leads with failures: expected versus actual, the labelled AI explanation and source', async () => {
    apiMock.autoTests.mockResolvedValue([session()]);
    const onOpenRun = vi.fn();
    const { container } = render(<AutoTestPanel projectId={PROJECT} defaultFolder="/Users/me/shop" onOpenRun={onOpenRun} />);
    expect(await screen.findByText('Auto test finished')).toBeInTheDocument();
    expect(screen.getByText('“No account uses this email.”')).toBeInTheDocument();
    expect(screen.getByText('The page shows “Email or password is incorrect.”')).toBeInTheDocument();
    expect(screen.getByText('AI explanation')).toBeInTheDocument();
    expect(screen.getByText('server.js:45')).toBeInTheDocument();
    const rows = container.querySelectorAll('.at-test-summary');
    expect(rows[0]).toHaveTextContent('Unknown email gets the generic error');
    fireEvent.click(screen.getByRole('button', { name: 'Open run evidence' }));
    expect(onOpenRun).toHaveBeenCalledWith('r2');
  });

  it('shows why an app could not start, with its log', async () => {
    apiMock.autoTests.mockResolvedValue([session({ stage: 'failed', summary: null, tests: [], exploration: null, error: { reason: 'exited', message: 'The app stopped while starting (exit code 1).', log: 'Error: Missing DATABASE_URL' } })]);
    render(<AutoTestPanel projectId={PROJECT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The app stopped while starting (exit code 1).');
    expect(screen.getByText('Error: Missing DATABASE_URL')).toBeInTheDocument();
  });

  it('cancels a running session', async () => {
    apiMock.autoTests.mockResolvedValue([session({ stage: 'planning', summary: null, tests: [] })]);
    apiMock.autoTest.mockResolvedValue(session({ stage: 'planning', summary: null, tests: [] }));
    apiMock.cancelAutoTest.mockResolvedValue(session({ stage: 'cancelled', summary: null, tests: [] }));
    render(<AutoTestPanel projectId={PROJECT} defaultFolder="/x" />);
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(apiMock.cancelAutoTest).toHaveBeenCalled());
    expect(await screen.findByText('Auto test cancelled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Auto test/ })).toBeEnabled();
  });
});
