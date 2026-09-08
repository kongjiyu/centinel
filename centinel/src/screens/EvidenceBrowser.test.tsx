import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceBrowser } from './EvidenceBrowser';
import { api } from '../api/client';
import type { DynamicEvidence, DynamicSession, Screen } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listDynamicSessions: vi.fn(),
    listDynamicEvidence: vi.fn(),
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

describe('EvidenceBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listDynamicSessions).mockResolvedValue([session]);
    vi.mocked(api.listDynamicEvidence).mockResolvedValue(evidence);
  });

  it('keeps visual evidence primary and technical filters disclosed', async () => {
    const user = userEvent.setup();
    render(<EvidenceBrowser projectId="project-1" onNavigate={() => {}} />);

    await waitFor(
      () => expect(screen.getByRole('button', { name: /Screenshots \(1\)/ })).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByRole('button', { name: /Overview \(2\)/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Screenshots \(1\)/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Screenshots \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Action trace \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('Technical filters').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: /Model responses/ })).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open screenshot: Checkout page' }));
    expect(screen.getByRole('dialog', { name: 'Checkout page' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    await user.click(screen.getByText('Technical filters'));
    expect(screen.getByRole('button', { name: /Model responses \(1\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Model responses \(1\)/ }));
    expect(screen.getByRole('button', { name: /Model responses \(1\)/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a clear next action when a project has no dynamic runs', async () => {
    vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
    const onNavigate = vi.fn<(screen: Screen) => void>();
    const user = userEvent.setup();

    render(<EvidenceBrowser projectId="project-1" onNavigate={onNavigate} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'No test runs yet' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New test' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'project-detail', projectId: 'project-1', initialAction: 'dynamic' });
  });

  it('shows a recoverable error when evidence loading fails', async () => {
    vi.mocked(api.listDynamicEvidence).mockRejectedValue(new Error('offline'));
    render(<EvidenceBrowser projectId="project-1" onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Evidence could not be loaded.'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
