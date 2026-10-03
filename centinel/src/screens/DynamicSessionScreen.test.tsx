import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicSessionScreen } from './DynamicSessionScreen';
import { api } from '../api/client';
import type { DynamicEvidence, DynamicSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getDynamicSession: vi.fn(),
    listDynamicEvidence: vi.fn(),
    cancelDynamicSession: vi.fn(),
  },
}));

const session: DynamicSession = {
  id: 'dynamic-1',
  projectId: 'project-1',
  type: 'dynamic',
  name: 'Checkout smoke test',
  status: 'failure',
  targetUrl: 'http://localhost:3000',
  goal: 'Complete checkout',
  missionType: 'smoke',
  browserMode: 'headed',
  maxSteps: 15,
  finalSummary: 'Checkout could not be completed.',
  failureReason: 'The payment form did not submit.',
  createdAt: '2026-09-04T01:00:00.000Z',
  updatedAt: '2026-09-04T01:02:00.000Z',
};

const evidence: DynamicEvidence[] = [
  {
    id: 'shot-1',
    type: 'screenshot',
    filePath: 'C:\\evidence\\checkout.png',
    summary: 'Checkout page',
    createdAt: '2026-09-04T01:01:00.000Z',
  },
  {
    id: 'trace-1',
    type: 'action_trace',
    filePath: 'C:\\evidence\\trace.json',
    summary: 'Clicked Pay now',
    createdAt: '2026-09-04T01:01:30.000Z',
  },
  {
    id: 'response-1',
    type: 'ai_response',
    filePath: 'C:\\evidence\\response.json',
    summary: 'Model response for step 3',
    createdAt: '2026-09-04T01:01:45.000Z',
  },
];

describe('DynamicSessionScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDynamicSession).mockResolvedValue(session);
    vi.mocked(api.listDynamicEvidence).mockResolvedValue(evidence);
  });

  it('leads with the outcome and keeps technical evidence under disclosure', async () => {
    const user = userEvent.setup();
    render(<DynamicSessionScreen projectId="project-1" sessionId={session.id} onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: session.name })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Failure reason' })).not.toBeInTheDocument();
    expect(screen.getByText('The test could not finish. Check the target website and test setup, then rerun the test.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Screenshots (1)' })).toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Open screenshot: Checkout page' }));
    expect(screen.getByRole('dialog', { name: 'Checkout page' })).toBeInTheDocument();
  });

  it('replaces raw browser-launch diagnostics with recovery guidance', async () => {
    const rawBrowserError = "Test failed at step 0: Error: browserType.launch: Executable doesn't exist at C:\\Users\\PREDATOR\\AppData\\Local\\ms-playwright\\chromium\\chrome.exe";
    vi.mocked(api.getDynamicSession).mockResolvedValue({ ...session, finalSummary: rawBrowserError, failureReason: rawBrowserError });
    render(<DynamicSessionScreen projectId="project-1" sessionId={session.id} onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: session.name })).toBeInTheDocument());
    expect(screen.getByText('Centinel could not start its test browser. Install or repair the Playwright browser, then rerun the test.')).toBeInTheDocument();
    expect(screen.queryByText(/browserType\.launch|ms-playwright|chrome\.exe/i)).not.toBeInTheDocument();
  });

  it('offers retry guidance when the run cannot be loaded', async () => {
    vi.mocked(api.getDynamicSession).mockRejectedValue(new Error('offline'));
    vi.mocked(api.listDynamicEvidence).mockRejectedValue(new Error('offline'));
    render(<DynamicSessionScreen projectId="project-1" sessionId={session.id} onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test run unavailable' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText(/saved run and evidence have not been changed/i)).toBeInTheDocument();
  });

  it('shows verifiable progress and recent activity while a test is running', async () => {
    vi.mocked(api.getDynamicSession).mockResolvedValue({ ...session, status: 'running', finalSummary: '', failureReason: '' });
    render(<DynamicSessionScreen projectId="project-1" sessionId={session.id} onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Testing the website' })).toBeInTheDocument());
    expect(screen.getByText('1 of up to 15')).toBeInTheDocument();
    expect(screen.getByText('Clicked Pay now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export report' })).not.toBeInTheDocument();
  });
});
