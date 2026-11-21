import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { resetCheckStore, saveCheck } from '../../check/store';
import { readConversationDraft, writeConversationDraft } from '../../check/conversation';
import type { ConversationRequest } from '../../check/conversationTypes';
import type { Finding, Project, Screen, StaticSession } from '../../types';
import { ConversationTurn } from './ConversationTurn';
import { ProjectConversationScreen } from './ProjectConversationScreen';
import { CheckScreen } from '../check/CheckScreen';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

vi.mock('@tauri-apps/api/dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/api/fs', () => ({ writeTextFile: vi.fn() }));

vi.mock('../../api/client', () => ({ api: {
  autoTests: vi.fn(), getConnectedSourceStatus: vi.fn().mockResolvedValue({ connected: true, sources: [] }), autoTest: vi.fn(), listArtifacts: vi.fn(), listStaticSessions: vi.fn(), listStaticFindings: vi.fn(),
  listRequirements: vi.fn(), getStaticSession: vi.fn(), getReviewHarness: vi.fn(), conversationRequests: vi.fn(),
  sendConversationRequest: vi.fn(), startAutoTest: vi.fn(), generateCheckTitle: vi.fn(), exportProjectReport: vi.fn(), getReviewTraceability: vi.fn(),
} }));
const project: Project = { id: '11111111-1111-4111-8111-111111111111', name: 'Sample shop', description: '', workspacePath: '/shop', createdAt: '', updatedAt: '' };
const reviewId = '22222222-2222-4222-8222-222222222222';
const findingId = '33333333-3333-4333-8333-333333333333';
const accepted = (input: ConversationRequest['input']): ConversationRequest => ({
  id: input.id, input, ownerId: 'owner', projectId: project.id, inputHash: 'fixture', revision: 1, policyVersion: 'fixture',
  state: 'accepted', createdAt: '2026-11-18T02:00:00Z', updatedAt: '2026-11-18T02:00:00Z', events: [],
});
function Workspace() {
  const [route, navigate] = useState<Screen>({ name: 'project', projectId: project.id });
  return route.name === 'check' ? <CheckScreen checkId={route.checkId} projects={[project]} onNavigate={navigate} />
    : <ProjectConversationScreen project={project} projects={[project]} onNavigate={navigate} />;
}
beforeEach(() => {
  vi.resetAllMocks(); resetCheckStore(); sessionStorage.clear();
  vi.mocked(api.getConnectedSourceStatus).mockResolvedValue({ connected: true, sources: [] } as never);
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  const review = { id: reviewId, projectId: project.id, name: 'Checkout review', status: 'completed', progressJson: '{}',
    createdAt: '2026-11-18T01:00:00Z', updatedAt: '2026-11-18T01:10:00Z' } as StaticSession;
  vi.mocked(api.autoTests).mockResolvedValue([]);
  vi.mocked(api.listArtifacts).mockResolvedValue([]);
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.getReviewTraceability).mockResolvedValue({ sessionId: reviewId, projectId: project.id, status: 'available',
    records: [{ requirementId: 'req-1', title: 'Only owners can read orders', description: '', category: '', state: 'complete',
      mappingIds: [], sourceArtifactIds: [], confidence: 1, capturedAt: review.createdAt }], summary: null });
  vi.mocked(api.listStaticSessions).mockResolvedValue([review]);
  vi.mocked(api.getStaticSession).mockResolvedValue(review);
  vi.mocked(api.getReviewHarness).mockResolvedValue(null as never);
  vi.mocked(api.listStaticFindings).mockResolvedValue([{ id: findingId, projectId: project.id, sessionId: reviewId, title: 'Order ownership check is missing',
    status: 'new', riskLevel: 'high', description: 'Another account can retrieve an order.', evidenceText: 'return orders.get(id)', recommendation: 'Validate the owner.',
    filePath: 'orders.ts', lineNumber: 12, requirementId: 'req-1' } as Finding]);
  vi.mocked(api.conversationRequests).mockResolvedValue([]);
  saveCheck({ id: 'check-one', projectId: project.id, projectName: project.name, title: 'Order Access', reviewId,
    createdAt: review.createdAt, updatedAt: review.updatedAt, mode: 'code', phase: 'done', documents: [], focus: 'Review orders', notes: [] });
});

it('opens a saved card, keeps the result while typing, attaches a problem and returns after acknowledged Send', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  const card = within(await screen.findByRole('region', { name: 'Check Order Access' }));
  expect(card.getByText('Found in code')).toBeInTheDocument();
  await user.click(card.getByRole('button', { name: 'View' }));
  expect(await screen.findByRole('button', { name: 'Remove check Order Access' })).toBeInTheDocument();
  const prompt = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(prompt, 'Explain @ownership');
  const problems = within(screen.getByRole('region', { name: 'Problems' }));
  await user.click(await problems.findByRole('button', { name: 'Order ownership check is missing' }));
  expect(screen.getByRole('button', { name: 'Remove problem Order ownership check is missing' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /problem.*found/i })).toBeInTheDocument();
  vi.mocked(api.sendConversationRequest).mockRejectedValueOnce(new Error('Connection lost'));
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  expect(prompt).toHaveValue('Explain ');
  const first = vi.mocked(api.sendConversationRequest).mock.calls[0][1];
  expect(first.references).toContainEqual({ reviewId, findingId });
  vi.mocked(api.sendConversationRequest).mockResolvedValueOnce(accepted(first));
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  await screen.findByRole('region', { name: 'Conversation about Sample shop' });
  expect(vi.mocked(api.sendConversationRequest).mock.calls[1][1].id).toBe(first.id);
  expect(readConversationDraft(project.id)).toMatchObject({ text: '', checkIds: [], problems: [] });
  expect(readConversationDraft(project.id, 'check-one').text).toBe('');
  expect(screen.getByRole('region', { name: 'Check Order Access' })).toBeInTheDocument();
});

it('asks about a named check without sending or overwriting a draft', async () => {
  const user = userEvent.setup();
  const view = render(<Workspace />);
  const card = within(await screen.findByRole('region', { name: 'Check Order Access' }));
  await user.click(await card.findByRole('button', { name: 'Ask about this check' }));
  const prompt = screen.getByRole('textbox', { name: 'Follow-up check' });
  expect(prompt).toHaveValue('Explain the attached check.');
  expect(prompt).toHaveFocus();
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
  await user.clear(prompt);
  await user.type(prompt, 'Keep this draft');
  view.unmount();

  render(<Workspace />);
  await user.click(await within(screen.getByRole('region', { name: 'Check Order Access' })).findByRole('button', { name: 'Ask about this check' }));
  expect(screen.getByRole('textbox', { name: 'Follow-up check' })).toHaveValue('Keep this draft');
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
});

it('asks about the exact result and shows the saved problem and both documents after a fresh load', async () => {
  const user = userEvent.setup();
  const docA = '44444444-4444-4444-8444-444444444444';
  const docB = '55555555-5555-4555-8555-555555555555';
  writeConversationDraft(project.id, { text: '', checkIds: [], problems: [], documents: [
    { name: 'Design notes.md', base64: '', saved: { projectId: project.id, artifactId: docA } },
    { name: 'Acceptance examples.md', base64: '', saved: { projectId: project.id, artifactId: docB } },
  ] }, 'check-one');
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => accepted(input));
  const view = render(<Workspace />);
  await user.click(within(await screen.findByRole('region', { name: 'Check Order Access' })).getByRole('button', { name: 'View' }));
  await user.click(await screen.findByRole('button', { name: 'Ask about this problem' }));
  expect(screen.getByRole('textbox', { name: 'Follow-up check' })).toHaveValue('Explain the attached problem.');
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  const expected = { text: 'Explain the attached problem.',
    references: [{ reviewId, findingId }, { artifactId: docA }, { artifactId: docB }],
    referenceLabels: ['Order ownership check is missing', 'Design notes.md', 'Acceptance examples.md'] };
  await waitFor(() => expect(api.sendConversationRequest).toHaveBeenCalledWith(project.id, expect.objectContaining(expected)));
  const input = vi.mocked(api.sendConversationRequest).mock.calls[0][1];
  const result: ConversationRequest = { ...accepted(input), reply: 'A saved explanation.', state: 'completed',
    resolvedAttachmentNames: ['One exact saved issue', 'Design notes.md', 'Acceptance examples.md'] };
  const noAttachments = { ...result, id: 'older-turn', resolvedAttachmentNames: undefined,
    input: { ...input, text: 'Hello', references: [], referenceLabels: undefined } };
  view.unmount();
  vi.mocked(api.conversationRequests).mockResolvedValue([result, noAttachments]);
  render(<Workspace />);
  const included = within(within(await screen.findByText('Explain the attached problem.')).getByRole('list', { name: 'Included with this message' }));
  expect(included.getAllByRole('listitem')).toHaveLength(3);
  expect(within(screen.getByText('Explain the attached problem.')).getByText('Names as sent')).toBeVisible();
  expect(included.getByText(/Order ownership check is missing/)).toBeVisible();
  expect(included.getByText('Saved name: One exact saved issue')).toBeVisible();
  expect(included.getByText(/Design notes.md/)).toBeVisible();
  expect(included.getByText(/Acceptance examples.md/)).toBeVisible();
  expect(within(screen.getByText('Hello')).queryByRole('list')).not.toBeInTheDocument();
});

it('restores each draft when switching checks and posts only the sent draft to the project', async () => {
  saveCheck({ id: 'check-two', projectId: project.id, projectName: project.name, title: 'Catalog Browse', reviewId,
    createdAt: '2026-11-18T01:20:00Z', updatedAt: '2026-11-18T01:30:00Z', mode: 'code', phase: 'done', documents: [], focus: '', notes: [] });
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => accepted(input));
  const user = userEvent.setup();
  render(<Workspace />);
  await user.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), 'My project draft');
  await user.click(within(screen.getByRole('region', { name: 'Check Order Access' })).getByRole('button', { name: 'View' }));
  const prompt = () => screen.getByRole('textbox', { name: 'Follow-up check' });
  expect(prompt()).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Remove check Order Access' })).toBeInTheDocument();
  await user.type(prompt(), 'My first check draft');
  const open = async (name: string) => {
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(within(screen.getByRole('dialog', { name: 'History' })).getByRole('button', { name }));
  };
  await open('Catalog Browse');
  expect(prompt()).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Remove check Order Access' })).not.toBeInTheDocument();
  await user.type(prompt(), 'abc');
  await open('Order Access');
  expect(prompt()).toHaveValue('My first check draft');
  await open('Catalog Browse');
  expect(prompt()).toHaveValue('abc');
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  const body = within(await screen.findByRole('region', { name: 'Conversation about Sample shop' }));
  expect(body.getByText('abc')).toHaveClass('is-me');
  expect(screen.getByRole('textbox', { name: 'Message to ORIN' })).toHaveValue('My project draft');
  expect(readConversationDraft(project.id, 'check-one').text).toBe('My first check draft');
  expect(readConversationDraft(project.id, 'check-two').text).toBe('');
});
it('routes an explicit quote through saved conversation and attributes it after a fresh render', async () => {
  const text = 'Quote your previous reply.';
  const priorId = '44444444-4444-4444-8444-444444444444';
  let saved: ConversationRequest[] = [];
  vi.mocked(api.conversationRequests).mockImplementation(async () => structuredClone(saved));
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => {
    const quote: ConversationRequest = {
      ...accepted(input), state: 'completed', action: 'explain', reply: 'Synthetic project answer.\nSecond line.',
      citations: ['conversation:' + priorId], recall: { status: 'recalled', turns: 1 },
    };
    saved = [quote];
    return quote;
  });
  const user = userEvent.setup();
  const first = render(<Workspace />);
  await user.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), text);
  await user.click(screen.getByRole('button', { name: /^Send$/ }));
  await screen.findByText('Quoted previous reply');
  expect(api.sendConversationRequest).toHaveBeenCalledWith(project.id, expect.objectContaining({ text, references: [] }));
  expect(api.startAutoTest).not.toHaveBeenCalled();
  first.unmount();
  render(<Workspace />);
  const reply = await screen.findByText('Quoted previous reply');
  const turn = reply.parentElement!;
  expect(within(turn).getByText('Synthetic project answer. Second line.').textContent).toBe('Synthetic project answer.\nSecond line.');
  expect(within(turn).getByText('Earlier reply in this project')).toBeInTheDocument();
  expect(within(turn).queryByText('AI analysis')).not.toBeInTheDocument();
});
it('uses frozen requirements and displays unavailable evidence without a fabricated zero', async () => {
  vi.mocked(api.getReviewTraceability).mockRejectedValue(new Error('snapshot unavailable'));
  render(<Workspace />);
  const card = within(screen.getByRole('region', { name: 'Check Order Access' }));
  expect(await card.findByText('Requirements unavailable')).toBeInTheDocument();
  expect(api.getReviewTraceability).toHaveBeenCalledWith(project.id, reviewId);
});

it('opens coverage gaps and exports the exact browser-only card as a saved Markdown report', async () => {
  const timestamp = '2026-11-18T02:15:00Z';
  const browserId = 'browser-result';
  saveCheck({ id: 'browser-card', projectId: project.id, projectName: project.name, title: 'Catalog Filters',
    autoTestId: browserId, createdAt: timestamp, updatedAt: timestamp, mode: 'browser', phase: 'done',
    documents: [], focus: '', notes: [] });
  vi.mocked(api.autoTest).mockResolvedValue({
    schemaVersion: 1, id: browserId, projectId: project.id, ownerId: 'owner', folder: '/shop',
    createdAt: timestamp, updatedAt: timestamp, stage: 'completed', error: null, repository: null, launch: null, exploration: null,
    lanes: [], laneLimit: 1, laneNote: null, dropped: [], summary: null,
    tests: [{ id: 'test', name: 'Filter by size', goal: 'Filter products', rationale: '', requirementRef: null,
      sourceRefs: [], checks: [], startPath: '/', state: 'blocked', reason: 'Control permission was missing' }],
  });
  vi.mocked(save).mockResolvedValueOnce(null).mockResolvedValueOnce('C:/reports/catalog.md');
  vi.stubGlobal('__TAURI_IPC__', () => {});
  try {
    const user = userEvent.setup();
    render(<Workspace />);
    const card = within(screen.getByRole('region', { name: 'Check Catalog Filters' }));
    const gaps = await card.findByRole('button', { name: '1 unchecked' });
    expect(gaps).toHaveAttribute('aria-expanded', 'false');
    await user.click(gaps);
    expect(gaps).toHaveAttribute('aria-expanded', 'true');
    expect(card.getByRole('listitem')).toHaveTextContent('Control permission was missing');
    const exportButton = await card.findByRole('button', { name: 'Export' });
    await user.click(exportButton);
    expect(writeTextFile).not.toHaveBeenCalled();
    await user.click(exportButton);
    await waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    const [destination, markdown] = vi.mocked(writeTextFile).mock.calls[0];
    expect(destination).toBe('C:/reports/catalog.md');
    expect(markdown).toContain('# Catalog Filters');
    expect(markdown).toContain('## Not checked');
    expect(markdown).toContain('Filter by size: blocked');
    expect(markdown).not.toContain('Order ownership check is missing');
  } finally {
    vi.unstubAllGlobals();
  }
});
it('retains a newer draft typed while a previous send is awaiting acknowledgement', async () => {
  let acknowledge!: () => void;
  vi.mocked(api.sendConversationRequest).mockImplementation((_, input) => new Promise(resolve => { acknowledge = () => resolve(accepted(input)); }));
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(within(screen.getByRole('region', { name: 'Check Order Access' })).getByRole('button', { name: 'View' }));
  const prompt = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(prompt, 'Explain this check');
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  await waitFor(() => expect(api.sendConversationRequest).toHaveBeenCalledOnce());
  await user.clear(prompt);
  await user.type(prompt, 'Now explain the ownership evidence');
  acknowledge();
  const next = await screen.findByRole('textbox', { name: 'Message to ORIN' });
  expect(next).toHaveValue('');
  expect(readConversationDraft(project.id, 'check-one').text).toBe('Now explain the ownership evidence');
});

it('starts a Check from a project prompt and keeps its explanation readable through Ask, quote and reload', async () => {
  resetCheckStore();
  const user = userEvent.setup();
  const focus = 'Review the checkout total calculation.';
  const title = 'Checkout totals fixture';

  vi.mocked(api.generateCheckTitle).mockResolvedValue({ title });
  const saved: ConversationRequest[] = [];
  const explanation = 'The saved check is **inconclusive**.\n\n| Outcome | Evidence |\n| --- | --- |\n| Total | Visible |';
  vi.mocked(api.conversationRequests).mockImplementation(async () => structuredClone(saved));
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => {
    if (input.text === focus) {
      const checkRun: ConversationRequest = { ...accepted(input), state: 'completed', action: 'code', reviewId };
      saved.unshift(checkRun);
      return structuredClone(checkRun);
    }
    const quoting = input.text === 'Quote your previous reply.';
    const prior = saved[0];
    if (quoting && !prior) throw new Error('Missing synthetic prior response');
    const result: ConversationRequest = {
      ...accepted(input), state: 'completed', action: 'explain',
      reply: quoting ? prior.reply : explanation, replyFormat: 'markdown',
      citations: [quoting ? 'conversation:' + prior.id : 'review:' + reviewId],
      ...(quoting && { recall: { status: 'recalled', turns: 1 } }),
    };
    saved.unshift(result);
    return structuredClone(result);
  });

  const first = render(<Workspace />);
  await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
  await user.click(screen.getByRole('option', { name: 'Code' }));
  await user.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), focus);
  await user.click(screen.getByRole('button', { name: /^Send$/ }));
  await waitFor(() => expect(api.sendConversationRequest).toHaveBeenNthCalledWith(1, project.id,
    expect.objectContaining({ text: focus, mode: 'code', references: [] })));
  const check = within(await screen.findByRole('region', { name: 'Check ' + title }, { timeout: 4500 }));
  await user.click(await check.findByRole('button', { name: 'Ask about this check' }));
  expect(screen.getByRole('textbox', { name: 'Follow-up check' })).toHaveValue('Explain the attached check.');
  expect(api.sendConversationRequest).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  const originalLabel = await screen.findByText('AI analysis');
  expect(within(originalLabel.parentElement!).getByRole('table')).toBeVisible();
  expect(api.sendConversationRequest).toHaveBeenNthCalledWith(2, project.id,
    expect.objectContaining({ references: [{ reviewId }] }));

  const followup = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.clear(followup);
  await user.type(followup, 'Quote your previous reply.');
  await user.click(screen.getByRole('button', { name: /^Send$/ }));
  const quoteLabel = await screen.findByText('Quoted previous reply');
  expect(within(quoteLabel.parentElement!).getByRole('table')).toBeVisible();
  expect(api.sendConversationRequest).toHaveBeenNthCalledWith(3, project.id,
    expect.objectContaining({ text: 'Quote your previous reply.', references: [] }));
  expect(api.startAutoTest).not.toHaveBeenCalled();

  first.unmount();
  render(<Workspace />);
  const quote = within((await screen.findByText('Quoted previous reply')).parentElement!);
  expect(quote.getByRole('table')).toBeVisible();
  expect(quote.getByText('inconclusive').tagName).toBe('STRONG');
  expect(quote.getByText('Earlier reply in this project')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Check ' + title })).toBeVisible();
}, 12000);

it.each([0, 1, 3, 4, 5])('shows a top-of-message preview of at most three of %i saved attachments', count => {
  const references = Array.from({ length: count }, (_, index) => ({ artifactId: 'opaque-' + index }));
  const labels = ['private-folder/Duplicate.md', 'elsewhere\\Duplicate.md', 'Long'.repeat(35) + '.txt', 'Audit.md', 'Last.txt'];
  const input: ConversationRequest['input'] = { id: 'preview', text: 'Original message body', mode: 'code',
    permission: 'ask', references, referenceLabels: labels.slice(0, count) };
  render(<ConversationTurn request={accepted(input)} onNavigate={vi.fn()} />);
  const bubble = screen.getByText(input.text);
  if (!count) {
    expect(bubble.querySelector('.pc-sent-attachments')).toBeNull();
    return;
  }
  expect(bubble.firstChild).toHaveClass('pc-sent-attachments');
  expect(bubble.lastChild?.textContent).toBe(input.text);
  const preview = within(bubble).getByRole('list', { name: 'Included with this message' });
  expect(within(preview).getAllByRole('listitem')).toHaveLength(Math.min(3, count));
  expect(within(preview).getAllByText(/Duplicate\.md/)).toHaveLength(Math.min(2, count));
  expect(bubble).not.toHaveTextContent(/private-folder|elsewhere|opaque-/);
  expect(within(bubble).queryByRole('list', { name: 'Additional attachments' })).not.toBeInTheDocument();
  if (count > 3) expect(within(bubble).getByRole('button', { name: 'Show all ' + count + ' attachments' })).toHaveTextContent('+' + (count - 3));
  else expect(within(bubble).queryByRole('button')).not.toBeInTheDocument();
});

it('reveals every included attachment by mouse hover, keyboard, and touch and resets on reloading the same saved turn', async () => {
  const user = userEvent.setup();
  const names = ['First.md', 'Second.md', 'Third.md', 'Fourth.md', 'Fifth.md'];
  const input: ConversationRequest['input'] = { id: 'preview', text: 'Saved message body', mode: 'code',
    permission: 'ask', references: names.map((_, index) => ({ artifactId: 'opaque-' + index })), referenceLabels: names };
  const turn = { ...accepted(input), state: 'completed' as const,
    resolvedAttachmentNames: ['First.md', null, null, 'Saved-fourth.md', null] };
  const mount = () => render(<ConversationTurn request={turn} onNavigate={vi.fn()} />);
  const view = mount();
  const more = screen.getByRole('button', { name: 'Show all 5 attachments' });
  const extras = () => screen.queryByRole('list', { name: 'Additional attachments' });
  await user.hover(more);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(extras()).toHaveTextContent('Fourth.md');
  expect(extras()).toHaveTextContent('Saved name: Saved-fourth.md');
  expect(extras()).toHaveTextContent('Fifth.md');
  await user.unhover(more);
  expect(extras()).not.toBeInTheDocument();
  await user.tab();
  expect(more).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(extras()).toBeVisible();
  await user.keyboard('{Escape}');
  expect(extras()).not.toBeInTheDocument();
  expect(more).toHaveFocus();
  await user.pointer([{ keys: '[TouchA>]', target: more }, { keys: '[/TouchA]', target: more }]);
  expect(extras()).toBeVisible();
  fireEvent.click(more);
  expect(extras()).not.toBeInTheDocument();
  view.unmount();
  mount();
  expect(screen.getByText(/First\.md/)).toBeVisible();
  expect(extras()).not.toBeInTheDocument();
});

it('handles old evidence with type-only references, verified names, and opaque metadata distinctly', () => {
  const input: ConversationRequest['input'] = { id: 'legacy', text: 'A historical message', mode: 'code',
    permission: 'ask', references: [{ reviewId }, { reviewId, findingId }, { artifactId: 'source' }] };
  render(<ConversationTurn request={{ ...accepted(input), resolvedAttachmentNames: [reviewId, 'Saved issue', '/private/Source.md'] }} onNavigate={vi.fn()} />);
  const included = screen.getByRole('list', { name: 'Included with this message' });
  expect(within(included).getByText('Check attached')).toBeVisible();
  expect(within(included).getByText('Saved name: Saved issue')).toBeVisible();
  expect(within(included).getByText('Saved name: Source.md')).toBeVisible();
  expect(included).not.toHaveTextContent(/private|22222222/);
});

it('binds a selected saved reply by ID, keeps new attachments, and restores visible attribution from history', async () => {
  const user = userEvent.setup();
  const one = '11111111-2222-4222-8222-111111111111';
  const two = '22222222-2222-4222-8222-111111111111';
  const artifactId = '77777777-7777-4777-8777-777777777777';
  const reply = (id: string, text: string): ConversationRequest => ({
    ...accepted({ id, text: 'Original request ' + text, mode: 'code', permission: 'ask', references: [] }),
    state: 'completed', reply: text,
  });
  const prior = reply(one, 'The first assistant response');
  const target = reply(two, 'The selected assistant response');
  const records: ConversationRequest[] = [prior, target,
    { ...reply('pending', 'An in-progress response'), state: 'running' },
    { ...reply('other-owner', 'Different owner response'), ownerId: 'other' },
    { ...reply('other-project', 'Different project response'), projectId: 'another' }];
  vi.mocked(api.conversationRequests).mockImplementation(async () => structuredClone(records));
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => {
    const sent: ConversationRequest = { ...accepted(input), state: 'completed', reply: 'Here is the follow-up.',
      replyTo: { turnId: two, status: 'resolved' } };
    records.unshift(sent);
    return sent;
  });
  writeConversationDraft(project.id, { text: 'Use this new note in your answer.', checkIds: [], problems: [], mode: 'code',
    documents: [{ name: 'New note.md', base64: '', saved: { projectId: project.id, artifactId } }] });
  const mount = () => render(<Workspace />);
  const view = mount();
  const buttons = await screen.findAllByRole('button', { name: 'Reply to' });
  expect(buttons).toHaveLength(2);
  const pick = (response: string) => within(screen.getByText(response).closest('.pc-turn')!).getByRole('button', { name: 'Reply to' });
  const prompt = () => screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.click(pick(prior.reply!));
  expect(screen.getByText('Replying to ORIN').parentElement).toHaveTextContent(prior.reply!);
  expect(prompt()).toHaveFocus();
  await user.click(pick(target.reply!));
  expect(screen.getByText('Replying to ORIN').parentElement).toHaveTextContent(target.reply!);
  await user.click(screen.getByRole('button', { name: 'Remove reply target' }));
  expect(screen.queryByText('Replying to ORIN')).not.toBeInTheDocument();
  expect(prompt()).toHaveValue('Use this new note in your answer.');
  expect(screen.getByRole('button', { name: 'Remove New note.md' })).toBeVisible();
  await user.click(pick(target.reply!));
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
  view.unmount();
  const reloaded = mount();
  expect(await screen.findByText('Replying to ORIN')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Send$/ }));
  await waitFor(() => expect(api.sendConversationRequest).toHaveBeenCalledOnce());
  const input = vi.mocked(api.sendConversationRequest).mock.calls[0][1];
  expect(input).toMatchObject({
    text: 'Use this new note in your answer.', replyToTurnId: two,
    references: [{ artifactId }], referenceLabels: ['New note.md'],
  });
  expect(JSON.stringify(input)).not.toContain(target.reply);
  expect(api.startAutoTest).not.toHaveBeenCalled();
  expect(await screen.findByText('In reply to ORIN')).toBeVisible();
  expect(screen.getByText('Use this new note in your answer.')).toHaveTextContent('In reply to ORIN');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove reply target' })).not.toBeInTheDocument());
  reloaded.unmount();
  mount();
  expect(await screen.findByText('In reply to ORIN')).toBeVisible();
});

it('blocks stale selected context until it is removed and never borrows it from another project', async () => {
  const other = { ...project, id: 'another', name: 'Other shop' };
  const user = userEvent.setup();
  const priorId = '33333333-3333-4333-8333-222222222222';
  vi.mocked(api.conversationRequests).mockImplementation(async projectId => projectId === project.id
    ? [] : [{ ...accepted({ id: priorId, text: '', mode: 'code', permission: 'ask', references: [] }),
      projectId: other.id, state: 'completed', reply: 'Only in the other project.' }]);
  writeConversationDraft(project.id, { text: 'My current draft', checkIds: [], problems: [], replyToTurnId: priorId });
  const view = render(<ProjectConversationScreen project={project} projects={[project, other]} onNavigate={vi.fn()} />);
  expect(await screen.findByText('Selected reply unavailable')).toBeVisible();
  expect(screen.getByRole('button', { name: /^Send$/ })).toBeDisabled();
  view.rerender(<ProjectConversationScreen project={other} projects={[project, other]} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Reply to' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove reply target' })).not.toBeInTheDocument();
  view.rerender(<ProjectConversationScreen project={project} projects={[project, other]} onNavigate={vi.fn()} />);
  expect(await screen.findByText('Selected reply unavailable')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Remove reply target' }));
  expect(screen.getByRole('button', { name: /^Send$/ })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Message to ORIN' })).toHaveValue('My current draft');
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
});
