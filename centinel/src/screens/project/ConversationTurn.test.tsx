import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConversationRequest } from '../../check/conversationTypes';
import { api } from '../../api/client';
import { ConversationTurn } from './ConversationTurn';

const createdAt = '2026-11-21T00:00:00.000Z';
const request: ConversationRequest = {
  id: 'request', projectId: 'project', ownerId: 'owner', revision: 4, createdAt, updatedAt: createdAt,
  input: { id: 'request', text: 'Current message', mode: 'browser', permission: 'ask', references: [{ artifactId: 'internal-artifact' }] },
  inputHash: 'internal-input-hash', state: 'completed', action: 'browser', policyVersion: 'local-test',
  context: [{ id: 'internal-evidence', hash: 'internal-context-hash', unavailable: true }],
  recall: { turns: 2, status: 'limited' },
  citations: ['conversation:internal-turn'],
  verificationBindings: [{ evidenceId: 'internal-evidence', paths: ['private.ts'], criteriaHash: 'internal-criteria-hash' }],
  autoTestId: 'internal-session',
  events: [{ stage: 'accepted', at: createdAt }, { stage: 'criteria_bound', at: '2026-11-21T00:00:01.250Z' },
    { stage: 'internal-stage', at: createdAt }],
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('keeps the attachment by the sent message and renders Markdown and saved excerpts inline', () => {
  render(<ConversationTurn request={{ ...request, input: { ...request.input, references: [{ reviewId: 'review', findingId: 'finding' }] },
    reply: '**Still open**\n\n- Check the saved result.\n\n| Field | Value |\n| --- | --- |\n| Status | `new` |\n\n```ts\nconst count = 1;\n```\n\n[Untrusted link](https://example.test) ![External image](https://example.test/image.png)',
    replyFormat: 'markdown',
    explanation: { sections: [{ evidenceId: 'finding:finding', title: 'Saved checkout problem', excerpt: 'return total;', points: ['Cite the saved condition.'] }] },
  }} />);
  expect(within(screen.getByRole('list', { name: 'Message attachments' })).getByText('Saved checkout problem')).toBeInTheDocument();
  expect(screen.getByText('Still open').tagName).toBe('STRONG');
  const card = screen.getByRole('region', { name: 'Saved checkout problem' });
  expect(card.compareDocumentPosition(screen.getByText('Still open')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('const count = 1;').closest('pre')).toBeInTheDocument();
  expect(screen.getByText('return total;').closest('pre')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('loads older or failed-turn evidence in chat by its original request ID', async () => {
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  const getEvidence = vi.spyOn(api, 'conversationEvidence').mockResolvedValue({ unavailable: 0, sections: [{
    evidenceId: 'finding:finding', title: 'Historical checkout problem', sourceWindow: { text: 'return savedTotal;', firstLine: 10, citedLine: 12 },
  }] });
  render(<ConversationTurn request={{ ...request, state: 'failed', input: { ...request.input, references: [{ reviewId: 'review', findingId: 'finding' }] } }} />);
  expect(within(screen.getByRole('list', { name: 'Message attachments' })).getByText('Code problem')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show saved evidence in chat' }));
  expect(await screen.findByText('return savedTotal;')).toBeInTheDocument();
  expect(getEvidence).toHaveBeenCalledWith('project', 'request');
  expect(within(screen.getByRole('list', { name: 'Message attachments' })).getByText('Historical checkout problem')).toBeInTheDocument();
});

it('shows the saved Browser assertion and opens its recorded snapshot directly in the turn', async () => {
  vi.spyOn(api, 'dynamicRuns').mockResolvedValue([{ id: 'run', evidence: [{ id: 'snapshot', kind: 'screenshot' }] }] as never);
  vi.spyOn(api, 'dynamicEvidenceCopies').mockResolvedValue([]);
  const read = vi.spyOn(api, 'dynamicRecordedEvidenceBlob').mockResolvedValue(new Blob(['saved'], { type: 'image/png' }));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:snapshot', revokeObjectURL: vi.fn() }));
  try {
    render(<ConversationTurn request={{ ...request, explanation: { sections: [{ title: 'Saved Browser check', checks: [{
      test: 'Sign-in', check: 'Show the error', expected: 'Invalid password', observed: 'Blank', verdict: 'failed', runId: 'run',
    }] }] } }} />);
    expect(within(screen.getByRole('table')).getByText('Invalid password')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show snapshot for Sign-in' }));
    expect(await screen.findByRole('img', { name: 'Saved Browser snapshot for Sign-in' })).toHaveAttribute('src', 'blob:snapshot');
    expect(read).toHaveBeenCalledWith('project', 'run', 'snapshot', 'local');
    cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:snapshot');
  } finally { vi.unstubAllGlobals(); }
});

it('shows only allowlisted stages and metadata counts in the owner’s development trace', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_CENTINEL_HARNESS_TRACE', '1');
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  render(<ConversationTurn request={request} />);
  const summary = screen.getByText('Harness trace');
  await userEvent.click(summary);
  const trace = summary.closest('details')!;
  expect(trace.open).toBe(true);
  expect(within(trace).getByText('1 total, 1 unavailable')).toBeInTheDocument();
  expect(within(trace).getByText('2 (limit reached)')).toBeInTheDocument();
  expect(within(trace).getByText('Browser session recorded')).toBeInTheDocument();
  expect(within(trace).getByText('+1.25 s')).toBeInTheDocument();
  expect(trace.textContent).not.toMatch(/internal-|private\.ts|Current message/);
});

it.each([
  ['owner without opt-in', true, '0', 'owner'],
  ['production owner', false, '1', 'owner'],
  ['project member', true, '1', 'member'],
] as const)('hides the trace for %s', (_name, dev, flag, owner) => {
  vi.stubEnv('DEV', dev);
  vi.stubEnv('VITE_CENTINEL_HARNESS_TRACE', flag);
  sessionStorage.setItem('centinel:supabase-user-id', owner);
  render(<ConversationTurn request={request} />);
  expect(screen.queryByText('Harness trace')).toBeNull();
});

it('shows the selected earlier reply beside the message and offers the normal Reply to action', async () => {
  const user = userEvent.setup();
  const onReplyTo = vi.fn();
  render(<ConversationTurn request={{ ...request, input: { ...request.input, replyToTurnId: 'source-turn' },
    replyTo: { turnId: 'source-turn', status: 'resolved' }, reply: 'Follow-up answer', replyFormat: 'markdown' }}
    onReplyTo={onReplyTo} replySourceExcerpt="The earlier saved answer." />);
  const attribution = screen.getByText('In reply to ORIN');
  expect(attribution.parentElement).toHaveTextContent('The earlier saved answer.');
  await user.click(screen.getByRole('button', { name: 'Reply to' }));
  expect(onReplyTo).toHaveBeenCalledOnce();
});
