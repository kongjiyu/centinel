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
    exportDynamicSessionReport: vi.fn(),
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
    expect(screen.getByRole('heading', { name: 'Failure reason' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Screenshots (1)' })).toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Open screenshot: Checkout page' }));
    expect(screen.getByRole('dialog', { name: 'Checkout page' })).toBeInTheDocument();
  });

  it('offers retry guidance when the run cannot be loaded', async () => {
    vi.mocked(api.getDynamicSession).mockRejectedValue(new Error('offline'));
    vi.mocked(api.listDynamicEvidence).mockRejectedValue(new Error('offline'));
    render(<DynamicSessionScreen projectId="project-1" sessionId={session.id} onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test run unavailable' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText(/saved run and evidence have not been changed/i)).toBeInTheDocument();
  });
});
