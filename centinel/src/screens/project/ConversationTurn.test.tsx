import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConversationRequest } from '../../check/conversationTypes';
import { api } from '../../api/client';
import { ConversationTurn } from './ConversationTurn';
import { conversationTime } from './ConversationMessage';
import type { AutoTestSession } from '../../autotest/types';
import { BrowserWorkSection } from './CheckWorkActivity';

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

it('formats message timestamps using the local calendar and a 24-hour clock', () => {
  const local = (year: number, month: number, day: number) => new Date(year, month, day, 8, 5).toISOString();
  const today = new Date(2026, 10, 26);
  expect(conversationTime(local(2026, 10, 26), today)).toBe('8:05 AM');
  expect(conversationTime(local(2026, 10, 25), today)).toBe('25 Nov 8:05 AM');
  expect(conversationTime(local(2025, 10, 25), today)).toBe('25 Nov 2025 8:05 AM');
  expect(conversationTime(new Date(2026, 10, 26, 19, 18).toISOString(), today)).toBe('7:18 PM');
});

it('shows real work by default and opens authorized saved references inside the activity', async () => {
  const open = vi.fn();
  render(<ConversationTurn request={{ ...request, state: 'planning', autoTestId: undefined, events: [{ stage: 'context_resolved', at: createdAt,
    activity: { count: 2, references: [{ id: 'review:sample', label: 'Catalogue review' }] } }] }}
    onOpenActivity={id => id === 'review:sample' ? open : undefined} />);
  const work = screen.getByRole('button', { name: /Working for.*Opened Check Catalogue review/ });
  expect(work).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(work);
  await userEvent.click(screen.getByRole('button', { name: 'Catalogue review' }));
  expect(open).toHaveBeenCalledOnce();
});

it('shows named actions and a short quote while keeping the failure in the inline reply', async () => {
  const quote = '0123456789012345678901234567890123456789 extra';
  render(<ConversationTurn request={{ ...request, action: 'code', autoTestId: undefined, state: 'failed', validationReason: 'quote_unmatched',
    events: [{ stage: 'loading_quoted_reply', at: createdAt }, { stage: 'question_answered', at: createdAt },
      { stage: 'context_resolved', at: createdAt, activity: { references: [{ id: 'artifact:report', label: 'report.pdf' }] } },
      { stage: 'scope_validated', at: createdAt, activity: { scopePaths: ['src/orders.js'] } },
      { stage: 'preparing_answer', at: createdAt }, { stage: 'failed', at: createdAt }] }} replySourceExcerpt={quote} />);
  await userEvent.click(screen.getByRole('button', { name: /^Worked for/ }));
  const list = screen.getByRole('list', { name: 'Saved activity' });
  expect(within(list).getByText('report.pdf').parentElement).toHaveTextContent('Read report.pdf');
  expect(list).toHaveTextContent('Checking the quote · “0123456789012345678901234567890123456789…”');
  expect(list).toHaveTextContent('Checking for the review scope: src/orders.js');
  expect(list).toHaveTextContent('Received your answer');
  expect(list).not.toHaveTextContent('Preparing your answer');
  expect(screen.getAllByText('A quote did not match the saved evidence.')).toHaveLength(1);
  expect(screen.queryByText(/the request failed/i)).not.toBeInTheDocument();
});

it('nests Browser work on the start action and summarizes a run that stopped before testing', async () => {
  const session = { stage: 'failed', tests: [], dropped: [], exploration: { pages: [{ path: '/', controls: 9 }] } } as unknown as AutoTestSession;
  render(<ConversationTurn request={{ ...request, events: [{ stage: 'question_answered', at: createdAt }] }}
    executionCard={progress => progress({ browser: <BrowserWorkSection session={session} /> })} />);
  await userEvent.click(screen.getByRole('button', { name: /^Worked for/ }));
  const list = screen.getByRole('list', { name: 'Saved activity' });
  const start = within(list).getByText('Started the Browser Check');
  expect(within(list).getByText('Received your answer')).toBeVisible();
  expect(screen.getAllByText('Started the Browser Check')).toHaveLength(1);
  const branch = start.closest('details')!;
  expect(branch).not.toHaveAttribute('open');
  await userEvent.click(start);
  expect(branch).toHaveAttribute('open');
  expect(within(branch).getByText('I inspected 1 page. I stopped before any Browser tests ran.')).toBeVisible();
  expect(within(branch).getByText(/Inspected/)).toHaveTextContent('Inspected / · 9 controls');
});

it('only links an external destination present in the current user message', () => {
  render(<ConversationTurn request={{ ...request, input: { ...request.input, text: 'See https://example.org/docs.' }, replyFormat: 'markdown',
    reply: '[Read the docs](https://example.org/docs) and [Other docs](https://example.org/other).' }} />);
  expect(screen.getByRole('link', { name: 'Read the docs' })).toHaveAttribute('href', 'https://example.org/docs');
  expect(screen.queryByRole('link', { name: 'Other docs' })).toBeNull();
});

it('keeps the attachment by the sent message and renders Markdown and saved excerpts inline', () => {
  render(<ConversationTurn request={{ ...request, input: { ...request.input, references: [{ reviewId: 'review', findingId: 'finding' }] },
    reply: '**Still open**\n\n- Check the saved result.\n\n| Field | Value |\n| --- | --- |\n| Status | `new` |\n\n```ts\nconst count = 1;\n```\n\n[Untrusted link](https://example.test) ![External image](https://example.test/image.png)',
    replyFormat: 'markdown',
    explanation: { sections: [{ evidenceId: 'finding:finding', title: 'Saved checkout problem', excerpt: 'return total;', points: ['Cite the saved condition.'] }] },
  }} />);
  const attachments = screen.getByRole('list', { name: 'Message attachments' });
  expect(within(attachments).getByText('Saved checkout problem')).toBeInTheDocument();
  const bubble = screen.getByText('Current message').closest('.pc-msg')!;
  expect(bubble).not.toContainElement(attachments);
  expect(attachments.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Still open').tagName).toBe('STRONG');
  const card = screen.getByRole('region', { name: 'Saved checkout problem' });
  expect(card.compareDocumentPosition(screen.getByText('Still open')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('const count = 1;').closest('pre')).toBeInTheDocument();
  expect(screen.getByText('return total;').closest('pre')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('replaces the completed scope reply with the execution card at the request', () => {
  render(<ConversationTurn request={{ ...request, action: 'code', reviewId: 'review',
    reply: 'Code Review scope', replyFormat: 'markdown',
  }} executionCard={<section aria-label="Review result">I finished the Code Review.</section>} />);
  const message = screen.getByText('Current message');
  const card = screen.getByRole('region', { name: 'Review result' });
  expect(message.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('Code Review scope')).toBeNull();
});

it('copies the original user text and Markdown reply and quotes the reply explicitly', async () => {
  const user = userEvent.setup();
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const onQuote = vi.fn();
  const reply = '**Saved answer**\n\n- Keep the evidence attached.';
  render(<ConversationTurn request={{ ...request, reply, replyFormat: 'markdown' }} onQuote={onQuote} />);
  await user.click(screen.getByRole('button', { name: 'Copy message' }));
  await user.click(screen.getByRole('button', { name: 'Copy reply' }));
  expect(writeText).toHaveBeenNthCalledWith(1, request.input.text);
  expect(writeText).toHaveBeenNthCalledWith(2, reply);
  await user.click(screen.getByRole('button', { name: 'Quote reply' }));
  expect(onQuote).toHaveBeenCalledOnce();
  if (previous) Object.defineProperty(navigator, 'clipboard', previous);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

it('shows a brief saved Check overview directly below its evidence card', () => {
  render(<ConversationTurn request={{ ...request, action: 'explain', autoTestId: undefined,
    reply: 'The saved Browser Check recorded zero failed assertions.', replyFormat: 'markdown', replyOrigin: 'saved_evidence',
    explanation: { sections: [{ title: 'Saved Browser check', facts: [{ label: 'Failed Browser assertions', value: '0' }] }] },
  }} />);
  const card = screen.getByRole('region', { name: 'Saved Browser check' });
  const work = screen.getByText(/^Worked for/);
  expect(card.contains(work)).toBe(false);
  expect(work.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const reply = screen.getByText('The saved Browser Check recorded zero failed assertions.');
  expect(card.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  vi.spyOn(api, 'dynamicRunSteps').mockResolvedValue({ runId: 'run', state: 'completed', verdict: 'failed', reason: null,
    truncated: false, finalScreenshot: true, steps: [
      { step: 1, action: 'navigate', target: null, page: '/', result: 'success', error: null, typedLength: null, screenshot: false },
    ] });
  const read = vi.spyOn(api, 'dynamicRunStepScreenshot').mockResolvedValue(new Blob(['saved'], { type: 'image/png' }));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:snapshot', revokeObjectURL: vi.fn() }));
  try {
    render(<ConversationTurn request={{ ...request, explanation: { sections: [{ title: 'Saved Browser check', checks: [{
      test: 'Sign-in', check: 'Show the error', expected: 'Invalid password', observed: 'Blank', verdict: 'failed', runId: 'run',
    }] }] } }} />);
    expect(within(screen.getByRole('table')).getByText('Invalid password')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Screenshot of the checked page' }));
    expect(await screen.findByRole('img', { name: 'The page when the test was checked' })).toHaveAttribute('src', 'blob:snapshot');
    expect(read).toHaveBeenCalledWith('project', 'run', 'final');
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

it('shows an explicit quote above the message and offers a Quote action', async () => {
  const user = userEvent.setup();
  const onQuote = vi.fn();
  render(<ConversationTurn request={{ ...request, input: { ...request.input, replyToTurnId: 'source-turn' },
    replyTo: { turnId: 'source-turn', status: 'resolved' }, reply: 'Follow-up answer', replyFormat: 'markdown' }}
    onQuote={onQuote} replySourceExcerpt="The earlier saved answer." />);
  const attribution = screen.getByText('Quoted reply');
  expect(attribution.parentElement).toHaveTextContent('The earlier saved answer.');
  await user.click(screen.getByRole('button', { name: 'Quote reply' }));
  expect(onQuote).toHaveBeenCalledOnce();
});

it('puts the reply time before its actions and keeps an actual failure warning', () => {
  const onQuote = vi.fn();
  render(<ConversationTurn request={{ ...request, reply: 'Saved answer', replyFormat: 'markdown' }} onQuote={onQuote} />);
  const actions = screen.getByRole('group', { name: 'Reply actions' });
  const timestamp = actions.querySelector('time');
  const copy = within(actions).getByRole('button', { name: 'Copy reply' });
  const quote = within(actions).getByRole('button', { name: 'Quote reply' });
  expect(actions.firstElementChild).toBe(timestamp);
  expect(timestamp!.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(timestamp!.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  cleanup();
  render(<ConversationTurn request={{ ...request, state: 'failed', failureStage: 'planning', error: 'provider rejected request' }} />);
  expect(document.querySelector('.pc-inline-error svg')).toBeInTheDocument();
});
