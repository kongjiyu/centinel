import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { resetCheckStore, saveCheck, getCheck } from '../../check/store';
import type { CheckRecord } from '../../check/types';
import { CheckScreen, formatDuration, formatElapsed } from './CheckScreen';

vi.mock('../../api/client', () => ({
  api: {
    getStaticSession: vi.fn(), listStaticFindings: vi.fn(), getReviewHarness: vi.fn(), autoTest: vi.fn(), listRequirements: vi.fn(),
    cancelStaticSession: vi.fn(), cancelAutoTest: vi.fn(), startAutoTest: vi.fn(), answerAutoTestStartup: vi.fn(), exportProjectReport: vi.fn(),
  },
}));
vi.mock('../../autotest/liveStream', () => ({ openLiveStream: vi.fn() }));

const record = (patch: Partial<CheckRecord> = {}): CheckRecord => ({
  id: 'c1', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', projectId: 'p1', projectName: 'sample-shop',
  documents: [], focus: '', mode: 'both', phase: 'running', reviewId: 'r1', autoTestId: 'a1', notes: [], ...patch,
});

const reviewSession = (status: string, progress: Record<string, unknown> = {}) => ({ id: 'r1', projectId: 'p1', status, progressJson: JSON.stringify(progress), updatedAt: '2026-11-12T10:05:40.000Z', failureReason: '' });
const failedTest = {
  id: 't1', name: 'Unknown email uses the generic sign-in error', goal: '', rationale: '', requirementRef: 'REQ-1', sourceRefs: [{ path: 'docs/requirements.md', line: 7 }],
  checks: [{ id: 'k1', criterionId: 'REQ-1', description: 'The same generic message is shown.', required: true, kind: 'visible_text' }], startPath: '/', state: 'failed', runId: 'run-1',
  checkResults: [{ checkId: 'k1', criterionId: 'REQ-1', verdict: 'failed', observed: 'Expected visible text absent.', reason: '', evidenceIds: [] }], explanation: 'The `server.js` handler returns a specific message.',
};
const autoSession = (stage: string, tests: unknown[] = [failedTest]) => ({ schemaVersion: 1, id: 'a1', projectId: 'p1', stage, error: null, lanes: [], tests, summary: { passed: 0, failed: 1, uncertain: 0, blocked: 0, notTested: 0, limitations: [] }, launch: null, laneNote: null, updatedAt: '' });
const finding = { id: 'f1', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'high', priority: 'high', riskLevel: 'critical', title: 'Orders open without sign-in', description: 'The route never checks the user.', status: 'new', createdAt: '', artifactId: null, category: '', evidenceText: '', recommendation: '', confidence: '', fromRemarks: false, filePath: 'server.js', lineNumber: 76 };

describe('Check screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCheckStore();
    vi.mocked(api.listRequirements).mockResolvedValue([]);
    vi.mocked(api.getReviewHarness).mockResolvedValue(null as never);
  });

  it('formats elapsed and finished durations', () => {
    expect(formatElapsed(185_000)).toBe('3:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatDuration(340_000)).toBe('5 min 40 s');
    expect(formatDuration(9_000)).toBe('9 s');
  });

  it('shows Live while a part runs, with validated titles appearing in the code column', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running', { stage: 'model_analysis' }) as never);
    vi.mocked(api.getReviewHarness).mockResolvedValue({ events: [{ reviewId: 'r1', event: 'review_live_finding_titles', detail: { titles: ['Order Ownership Bypass'] }, createdAt: '' }], analysisMap: null } as never);
    vi.mocked(api.autoTest).mockResolvedValue(autoSession('testing', []) as never);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: /Checking sample-shop/ })).toBeInTheDocument();
    expect(await screen.findByText('Order Ownership Bypass')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Progress' })).toHaveTextContent('Find and prove problems');
  });

  it('stops both running parts', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running') as never);
    vi.mocked(api.autoTest).mockResolvedValue(autoSession('testing', []) as never);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(api.cancelStaticSession).toHaveBeenCalledWith('p1', 'r1');
    expect(api.cancelAutoTest).toHaveBeenCalledWith('p1', 'a1');
  });

  it('adds validated code and browser findings as polling returns new evidence', async () => {
    vi.useFakeTimers();
    try {
      saveCheck(record());
      vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running') as never);
      const issue = { title: 'Orders check is incomplete', filePath: 'server.js', lineNumber: 76 };
      const event = { reviewId: 'r1', event: 'review_live_finding_titles', createdAt: '' };
      vi.mocked(api.getReviewHarness)
        .mockResolvedValueOnce({ events: [{ ...event, detail: { issues: [issue], provisional: true } }], analysisMap: null } as never)
        .mockResolvedValue({ events: [{ ...event, detail: { issues: [issue, issue] } }], analysisMap: null } as never);
      vi.mocked(api.autoTest)
        .mockResolvedValueOnce(autoSession('testing', []) as never)
        .mockResolvedValue(autoSession('testing', [failedTest, { ...failedTest, id: 't2', name: 'Other journey', state: 'blocked', reason: 'Typing into this control was not approved.' }]) as never);
      await act(async () => { render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />); });
      const code = within(screen.getByRole('region', { name: 'Found in the code' }));
      const browser = within(screen.getByRole('region', { name: 'Proving in the browser' }));
      expect(code.queryByText(issue.title)).not.toBeInTheDocument();
      expect(browser.queryByRole('heading', { name: /Found in the browser/ })).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(code.getByText(issue.title)).toHaveTextContent('server.js:76');
      expect(code.getByText('· 1')).toBeInTheDocument();
      expect(browser.getByRole('heading', { name: 'Found in the browser · 1' })).toBeInTheDocument();
      expect(browser.getByText('Typing into this control was not approved.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the saved pause reason while the browser lane is still live', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue({
      ...reviewSession('blocked', { stage: 'provider_paused' }), failureReason: 'Paused: the Model Provider reached its usage limit.',
    } as never);
    vi.mocked(api.listStaticFindings).mockResolvedValue([]);
    vi.mocked(api.autoTest).mockResolvedValue(autoSession('testing', []) as never);
    const navigate = vi.fn();
    render(<CheckScreen checkId="c1" onNavigate={navigate} />);
    expect(await screen.findByText('Code review paused')).toBeInTheDocument();
    expect(screen.getByText('Paused: the Model Provider reached its usage limit.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: 'p1', sessionId: 'r1' });
  });

  it('shows the browser startup error while code review continues', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running') as never);
    vi.mocked(api.autoTest).mockResolvedValue({
      ...autoSession('failed', []), error: { reason: 'exited', message: 'The app stopped while starting (exit code 1).' },
    } as never);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    expect(await screen.findByText('Browser check blocked before startup')).toBeInTheDocument();
    expect(screen.getByText('The app stopped while starting (exit code 1).')).toBeInTheDocument();
    expect(await screen.findByText('This check switched to Code only.')).toBeInTheDocument();
    expect(getCheck('c1')).toMatchObject({ mode: 'code', requestedMode: 'both', phase: 'running', reviewId: 'r1', autoTestId: 'a1' });
    expect(api.cancelStaticSession).not.toHaveBeenCalled();
  });

  it('pauses a browser-only check after a startup failure and keeps manual retry available', async () => {
    saveCheck(record({ mode: 'browser', reviewId: undefined, folder: 'C:/work/shop' }));
    vi.mocked(api.autoTest).mockImplementation(async (_, id) => (id === 'a1'
      ? { ...autoSession('failed', []), error: { reason: 'tool_missing', message: 'Python is missing.' } }
      : { ...autoSession('starting', []), id }) as never);
    vi.mocked(api.startAutoTest).mockResolvedValue({ ...autoSession('starting', []), id: 'a2' } as never);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'The check is paused.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry browser startup' }));
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { folder: 'C:/work/shop', startupPermission: 'auto' });
    expect(getCheck('c1')).toMatchObject({ autoTestId: 'a2', phase: 'running' });
  });

  it('retries an interrupted browser lane without restarting the code review', async () => {
    saveCheck(record({ folder: 'C:/work/shop' }));
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running') as never);
    vi.mocked(api.autoTest).mockImplementation(async (_, id) => (id === 'a1'
      ? { ...autoSession('failed', []), launch: { url: 'http://localhost:3000' }, error: { reason: 'interrupted', message: 'The browser run was interrupted.' } }
      : { ...autoSession('starting', []), id }) as never);
    vi.mocked(api.startAutoTest).mockResolvedValue({ ...autoSession('starting', []), id: 'a2' } as never);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry browser tests' }));
    expect(api.startAutoTest).toHaveBeenCalledExactlyOnceWith('p1', { folder: 'C:/work/shop', startupPermission: 'auto' });
    expect(getCheck('c1')).toMatchObject({ autoTestId: 'a2', phase: 'running', reviewId: 'r1', mode: 'both' });
    expect(api.cancelStaticSession).not.toHaveBeenCalled();
  });

  it('shows the discovered command and sends the selected startup answer', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('running') as never);
    vi.mocked(api.autoTest).mockResolvedValue({ ...autoSession('starting', []),
      startupQuestion: { id: 'q1', command: 'npm ci', packages: ['vite', 'react'], packageCount: 2 },
    } as never);
    vi.mocked(api.answerAutoTestStartup).mockResolvedValue({ accepted: true });
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    const dialog = within(await screen.findByRole('dialog', { name: 'Install dependencies to start the app?' }));
    expect(dialog.getByText(/npm ci/)).toHaveTextContent('vite react');
    expect(dialog.getByRole('radio', { name: /recommended/ })).toBeChecked();
    await userEvent.click(dialog.getByRole('radio', { name: 'Pause browser testing' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Continue' }));
    expect(api.answerAutoTestStartup).toHaveBeenCalledWith('p1', 'a1', 'q1', 'skip');
    expect(getCheck('c1')).toMatchObject({ phase: 'running', reviewId: 'r1' });
  });

  it('switches to Result when both parts finish, opens the top problem and records the outcome', async () => {
    saveCheck(record());
    vi.mocked(api.getStaticSession).mockResolvedValue(reviewSession('completed') as never);
    vi.mocked(api.listStaticFindings).mockResolvedValue([finding] as never);
    vi.mocked(api.autoTest).mockResolvedValue(autoSession('completed') as never);
    const onNavigate = vi.fn();
    render(<CheckScreen checkId="c1" onNavigate={onNavigate} />);

    expect(await screen.findByRole('heading', { name: '2 problems found. 1 proven in the browser.' })).toBeInTheDocument();
    const proven = screen.getByRole('region', { name: 'Proven in the browser' });
    expect(within(proven).getByText('This was not shown on the page.')).toBeInTheDocument();
    expect(within(proven).getByText('server.js', { selector: 'code' })).toBeInTheDocument();
    expect(within(proven).getByText('AI explanation')).toBeInTheDocument();
    await userEvent.click(within(proven).getByRole('button', { name: 'Replay the test' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: 'p1', runId: 'run-1' });

    const code = screen.getByRole('region', { name: 'Found in code' });
    expect(within(code).getByText('Critical')).toBeInTheDocument();
    expect(within(code).queryByText('Browser')).not.toBeInTheDocument();
    expect(getCheck('c1')).toMatchObject({ phase: 'done', problemCount: 2 });
  });

  it('keeps the blocking reason visible above the final measurements', async () => {
    saveCheck(record({ mode: 'code', autoTestId: undefined }));
    vi.mocked(api.getStaticSession).mockResolvedValue({
      ...reviewSession('blocked'), failureReason: 'The required repository snapshot is missing.',
    } as never);
    vi.mocked(api.listStaticFindings).mockResolvedValue([]);
    render(<CheckScreen checkId="c1" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'The check stopped before it finished.' })).toBeInTheDocument();
    expect(screen.getByText('Code review blocked')).toBeInTheDocument();
    expect(screen.getByText('The required repository snapshot is missing.', { exact: true })).toBeInTheDocument();
  });

  it('explains a check that could not start and offers a new one', async () => {
    saveCheck(record({ phase: 'failed', reviewId: undefined, autoTestId: undefined, error: 'No readable files were found in the project, so nothing could be reviewed.' }));
    const onNavigate = vi.fn();
    render(<CheckScreen checkId="c1" onNavigate={onNavigate} />);
    expect(screen.getByRole('heading', { name: 'The check could not start.' })).toBeInTheDocument();
    expect(screen.getByText('No readable files were found in the project, so nothing could be reviewed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a new check' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'new-check' });
  });

  it('says when the check is not on this device', () => {
    render(<CheckScreen checkId="missing" onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'This check is not on this device' })).toBeInTheDocument();
  });
});
