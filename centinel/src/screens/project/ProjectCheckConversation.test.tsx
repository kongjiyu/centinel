import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { resetCheckStore, saveCheck } from '../../check/store';
import { readConversationDraft, writeConversationDraft } from '../../check/conversation';
import type { ConversationRequest } from '../../check/conversationTypes';
import type { Finding, Project, Screen, StaticSession } from '../../types';
import { ProjectConversationScreen } from './ProjectConversationScreen';
import { CheckScreen } from '../check/CheckScreen';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

vi.mock('@tauri-apps/api/dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/api/fs', () => ({ writeTextFile: vi.fn() }));

vi.mock('../../api/client', () => ({ api: {
  autoTests: vi.fn(), getConnectedSourceStatus: vi.fn().mockResolvedValue({ connected: true, sources: [] }), autoTest: vi.fn(), listArtifacts: vi.fn(), listStaticSessions: vi.fn(), listStaticFindings: vi.fn(),
  listRequirements: vi.fn(), getStaticSession: vi.fn(), getReviewHarness: vi.fn(), conversationRequests: vi.fn(),
  sendConversationRequest: vi.fn(), conversationRequest: vi.fn(), confirmConversationRequest: vi.fn(), answerConversationQuestion: vi.fn(), startAutoTest: vi.fn(), exportProjectReport: vi.fn(), getReviewTraceability: vi.fn(),
} }));
const project: Project = { id: '11111111-1111-4111-8111-111111111111', name: 'Sample shop', description: '', workspacePath: '/shop', createdAt: '', updatedAt: '' };
const reviewId = '22222222-2222-4222-8222-222222222222';
const findingId = '33333333-3333-4333-8333-333333333333';
let ownerNumber = 0;
const testOwner = () => `owner-${ownerNumber}`;
const accepted = (input: ConversationRequest['input']): ConversationRequest => ({
  id: input.id, input, ownerId: testOwner(), projectId: project.id, inputHash: 'fixture', revision: 1, policyVersion: 'fixture',
  state: 'accepted', createdAt: '2026-11-18T02:00:00Z', updatedAt: '2026-11-18T02:00:00Z', events: [],
});
function Workspace() {
  const [route, navigate] = useState<Screen>({ name: 'project', projectId: project.id });
  return route.name === 'check' ? <CheckScreen checkId={route.checkId} projects={[project]} onNavigate={navigate} />
    : <ProjectConversationScreen project={project} projects={[project]} onNavigate={navigate} />;
}
beforeEach(() => {
  vi.resetAllMocks(); resetCheckStore(); localStorage.clear(); sessionStorage.clear();
  vi.mocked(api.getConnectedSourceStatus).mockResolvedValue({ connected: true, sources: [] } as never);
  ownerNumber++;
  sessionStorage.setItem('centinel:supabase-user-id', testOwner());
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
  vi.mocked(api.conversationRequest).mockRejectedValue(Object.assign(new Error('Conversation request unavailable.'), { status: 404 }));
  saveCheck({ id: 'check-one', projectId: project.id, projectName: project.name, title: 'Order Access', reviewId,
    createdAt: review.createdAt, updatedAt: review.updatedAt, mode: 'code', phase: 'done', documents: [], focus: 'Review orders', notes: [] });
});

it('opens a saved card, keeps the result while typing, attaches a problem and returns after acknowledged Send', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  const card = within(await screen.findByRole('region', { name: 'Check Order Access' }));
  expect(card.getByText('Code', { exact: true })).toBeInTheDocument();
  expect(card.getByText('Found in code')).toBeInTheDocument();
  expect(card.queryByText('Proven in the browser')).toBeNull();
  await user.click(card.getByRole('button', { name: 'View' }));
  expect(await screen.findByRole('button', { name: 'Back to the conversation' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'What ORIN knows' })).toHaveClass('is-open');
  expect(screen.getByRole('button', { name: 'Open full Check' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open full Check' }));
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
  vi.mocked(api.conversationRequest).mockRejectedValueOnce(new Error('Could not check the saved request'));
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  await screen.findByText('Could not check the saved request');
  expect(prompt).toHaveValue('Explain ');
  expect(api.sendConversationRequest).toHaveBeenCalledOnce();
  vi.mocked(api.sendConversationRequest).mockResolvedValueOnce(accepted(first));
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
  await screen.findByRole('region', { name: 'Conversation about Sample shop' });
  expect(api.conversationRequest).toHaveBeenCalledWith(project.id, first.id);
  expect(vi.mocked(api.sendConversationRequest).mock.calls[1][1].id).toBe(first.id);
  expect(readConversationDraft(project.id)).toMatchObject({ text: '', checkIds: [], problems: [] });
  expect(readConversationDraft(project.id, 'check-one').text).toBe('');
  expect(screen.getByRole('region', { name: 'Check Order Access' })).toBeInTheDocument();
});

it('recovers an accepted message after a lost acknowledgement and restart without posting twice', async () => {
  vi.mocked(api.sendConversationRequest).mockRejectedValueOnce(new Error('Connection lost'));
  const user = userEvent.setup();
  const view = render(<Workspace />);
  const prompt = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.type(prompt, 'What is this project called?');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Connection lost');
  const [projectId, input] = vi.mocked(api.sendConversationRequest).mock.calls[0];
  expect(input).toMatchObject({ mode: 'browser', references: [] });
  expect(api.startAutoTest).not.toHaveBeenCalled();
  view.unmount();
  sessionStorage.clear();
  sessionStorage.setItem('centinel:supabase-user-id', testOwner());
  vi.mocked(api.conversationRequest).mockResolvedValue({ ...accepted(input), state: 'completed', reply: 'Sample shop.' });
  render(<Workspace />);
  expect(await screen.findByText('Sample shop.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message to ORIN' })).toHaveValue('');
  expect(api.conversationRequest).toHaveBeenCalledWith(projectId, input.id);
  expect(api.sendConversationRequest).toHaveBeenCalledOnce();
});

it('restores an unsent project draft only for its original account after session storage resets', () => {
  writeConversationDraft(project.id, { text: 'Explain this problem', checkIds: [], problems: [{ label: 'Order ownership', reference: { reviewId, findingId } }] });
  sessionStorage.clear();
  sessionStorage.setItem('centinel:supabase-user-id', 'another-owner');
  expect(readConversationDraft(project.id).text).toBe('');
  sessionStorage.setItem('centinel:supabase-user-id', testOwner());
  render(<Workspace />);
  expect(screen.getByRole('textbox', { name: 'Message to ORIN' })).toHaveValue('Explain this problem');
  expect(screen.getByRole('button', { name: 'Remove problem Order ownership' })).toBeInTheDocument();
});

it('opens a saved choice at the top and adds it to the turn only after saving the answer', async () => {
  const legacy = { ...accepted({ id: 'older-question', text: 'Can you verify the result?', mode: 'both', permission: 'ask', references: [] }),
    state: 'completed', action: 'clarify', reply: 'Which verification should I run: **Code review only**, or **Code and browser** verification?' } as const;
  vi.mocked(api.conversationRequests).mockResolvedValue([legacy]);
  vi.mocked(api.answerConversationQuestion).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...legacy, selectedOption: 1, revision: 2 });
  const user = userEvent.setup();
  render(<Workspace />);
  const card = await screen.findByRole('region', { name: 'ORIN has a question' });
  expect(card.closest('.pc-thread')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  const composer = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.type(composer, 'Draft while answering');
  expect(composer).toHaveValue('Draft while answering');
  expect(screen.queryByText('Question', { exact: true })).toBeNull();
  await user.click(within(card).getByRole('button', { name: 'Answer later' }));
  expect(screen.queryByRole('region', { name: 'ORIN has a question' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Answer ORIN’s question' }));
  await user.click(screen.getByRole('button', { name: 'Code and browser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The answer could not be saved.');
  expect(screen.queryByText('You selected')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Code and browser' }));
  expect(await screen.findByText('You selected')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'ORIN has a question' })).toBeNull();
  expect(screen.getByText('Question', { exact: true })).toBeInTheDocument();
  expect(api.answerConversationQuestion).toHaveBeenLastCalledWith(project.id, legacy.id, legacy.revision, 1, false);
  expect(api.confirmConversationRequest).not.toHaveBeenCalled();
});

it('opens a response failure at the top with a next step and can reopen it from the turn', async () => {
  const failed = { ...accepted({ id: 'validation-error', text: 'Proceed with Code only first', mode: 'code', permission: 'ask', references: [] }),
    createdAt: '2026-11-23T02:00:00Z', state: 'failed', failureStage: 'validation', error: 'Internal diagnostic text' } as const;
  vi.mocked(api.conversationRequests).mockResolvedValue([failed]);
  const user = userEvent.setup();
  render(<Workspace />);
  const card = await screen.findByRole('region', { name: 'ORIN could not verify its response' });
  expect(card.closest('.pc-thread')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(card).getByText('What to do next')).toBeInTheDocument();
  expect(within(card).getByText(/specific check that failed is unavailable/i)).toBeInTheDocument();
  expect(within(card).getByText(/select Code and name the exact folder/i)).toBeInTheDocument();
  expect(screen.queryByText('Internal diagnostic text')).toBeNull();
  const composer = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.type(composer, 'Review src/automation');
  expect(composer).toHaveValue('Review src/automation');
  await user.click(within(card).getByRole('button', { name: 'Dismiss error' }));
  expect(screen.queryByRole('region', { name: 'ORIN could not verify its response' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'View response error' }));
  expect(screen.getByRole('region', { name: 'ORIN could not verify its response' })).toBeInTheDocument();
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
});

it('shows the original choice and the Review approval after continuing a saved Code answer', async () => {
  const question = 'Which verification should I run for the automation module?';
  const saved = { ...accepted({ id: 'answered-automation-question', text: 'try again', mode: 'both', permission: 'ask', references: [] }),
    createdAt: '2026-11-23T04:00:00Z', state: 'completed', action: 'clarify', selectedOption: 0, reply: question,
    questionOptions: ['Code review only', 'Code and browser'] } as const;
  const waiting = { ...saved, revision: saved.revision + 1, state: 'awaiting_permission', action: 'code', reply: 'Review Cypress files.',
    reviewContinuation: { sourceRequestId: 'saved-original', text: 'Review automation module', question } } as const;
  vi.mocked(api.conversationRequests).mockResolvedValue([{ ...saved, questionOptions: [...saved.questionOptions] }]);
  vi.mocked(api.answerConversationQuestion).mockResolvedValue({ ...waiting, questionOptions: [...waiting.questionOptions] });
  vi.mocked(api.confirmConversationRequest).mockResolvedValue({ ...waiting, questionOptions: [...waiting.questionOptions], revision: 3, state: 'running' });
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(await screen.findByRole('button', { name: 'Continue Code Review' }));
  expect(await screen.findByText('Review Cypress files.')).toBeInTheDocument();
  expect(screen.getByText(question)).toBeInTheDocument();
  expect(screen.getByText('You selected')).toBeInTheDocument();
  expect(api.answerConversationQuestion).toHaveBeenCalledWith(project.id, saved.id, saved.revision, 0, false);
  await user.click(screen.getByRole('button', { name: 'Run this scope' }));
  expect(api.confirmConversationRequest).toHaveBeenCalledWith(project.id, waiting.id, waiting.revision);
});

it.each(['proceed', 'proceed with Code only first'])('switches Browser to Code and confirms the saved scope revision for %s', async approval => {
  let scope: ConversationRequest;
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => {
    scope = { ...accepted(input), state: 'awaiting_permission', action: 'code', revision: 5, reply: 'Review Cypress files.' };
    return scope;
  });
  vi.mocked(api.confirmConversationRequest).mockImplementation(async () => ({ ...scope, state: 'running', revision: 6 }));
  const user = userEvent.setup();
  render(<Workspace />);
  const prompt = screen.getByRole('textbox', { name: 'Message to ORIN' });
  const mode = screen.getByRole('combobox', { name: 'Check mode' });
  expect(mode).toHaveTextContent('Browser');
  await user.click(screen.getByRole('combobox', { name: 'Project conversation permission' }));
  await user.click(screen.getByRole('option', { name: /Ask first/i }));
  await user.type(prompt, 'Conduct a review on automation module{Enter}');
  await screen.findByRole('button', { name: 'Run this scope' });
  expect(mode).toHaveTextContent(/^Code$/);
  expect(mode).toHaveClass('ck-mode-changed');
  expect(screen.getByText('ORIN changed Check mode to Code.')).toBeInTheDocument();
  expect(api.sendConversationRequest).toHaveBeenCalledWith(project.id, expect.objectContaining({ mode: 'code', permission: 'ask' }));
  expect(api.confirmConversationRequest).not.toHaveBeenCalled();
  await user.type(prompt, `${approval}{Enter}`);
  await waitFor(() => expect(api.confirmConversationRequest).toHaveBeenCalledExactlyOnceWith(project.id, scope.id, 5));
  expect(api.sendConversationRequest).toHaveBeenCalledOnce();
  expect(api.startAutoTest).not.toHaveBeenCalled();
  expect(prompt).toHaveValue('');
});

it('keeps a waiting Browser plan untouched when the user asks to proceed with Code only', async () => {
  const waiting = { ...accepted({ id: 'browser-plan-only', text: 'Verify in Browser', mode: 'browser', permission: 'ask', references: [] }),
    createdAt: '2026-11-23T03:00:00Z', action: 'browser', state: 'awaiting_permission', reply: 'Browser scope ready.' } as const;
  vi.mocked(api.conversationRequests).mockResolvedValue([waiting]);
  const user = userEvent.setup();
  render(<Workspace />);
  await screen.findByText('Browser scope ready.');
  const prompt = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.type(prompt, 'Proceed with Code only first{Enter}');
  expect(await screen.findByText(/There is no Code-only plan waiting for approval/)).toBeInTheDocument();
  expect(prompt).toHaveValue('Proceed with Code only first');
  expect(api.confirmConversationRequest).not.toHaveBeenCalled();
  expect(api.sendConversationRequest).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Run this scope' })).toBeInTheDocument();
});

it('tracks and approves a newly submitted Review by ID when history is unavailable', async () => {
  vi.mocked(api.conversationRequests).mockRejectedValue(new Error('History read failed (57014).'));
  let saved: ConversationRequest;
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => {
    saved = { ...accepted(input), state: 'awaiting_permission', action: 'code', revision: 5, reply: 'Review Cypress files.' };
    return { ...saved, state: 'accepted', revision: 1, action: undefined, reply: undefined };
  });
  vi.mocked(api.conversationRequest).mockImplementation(async () => saved);
  vi.mocked(api.confirmConversationRequest).mockImplementation(async () => ({ ...saved, state: 'running', revision: 6 }));
  const user = userEvent.setup();
  render(<Workspace />);
  await screen.findByText(/Conversation history is temporarily unavailable/);
  const prompt = screen.getByRole('textbox', { name: 'Message to ORIN' });
  await user.type(prompt, 'proceed a review on automation module{Enter}');
  await screen.findByRole('button', { name: 'Run this scope' });
  expect(api.sendConversationRequest).toHaveBeenCalledWith(project.id, expect.objectContaining({ mode: 'code' }));
  expect(api.conversationRequest).toHaveBeenCalledWith(project.id, saved!.id);
  await user.type(prompt, 'proceed{Enter}');
  await waitFor(() => expect(api.confirmConversationRequest).toHaveBeenCalledWith(project.id, saved!.id, 5));
  expect(api.sendConversationRequest).toHaveBeenCalledOnce();
});

it('restores each draft when switching checks and posts only the sent draft to the project', async () => {
  saveCheck({ id: 'check-two', projectId: project.id, projectName: project.name, title: 'Catalog Browse', reviewId,
    createdAt: '2026-11-18T01:20:00Z', updatedAt: '2026-11-18T01:30:00Z', mode: 'code', phase: 'done', documents: [], focus: '', notes: [] });
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => accepted(input));
  const user = userEvent.setup();
  render(<Workspace />);
  await user.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), 'My project draft');
  await user.click(within(screen.getByRole('region', { name: 'Check Order Access' })).getByRole('button', { name: 'View' }));
  await user.click(screen.getByRole('button', { name: 'Open full Check' }));
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
  expect(body.getByText('abc').closest('.pc-msg')).toHaveClass('is-me');
  expect(screen.getByRole('textbox', { name: 'Message to ORIN' })).toHaveValue('My project draft');
  expect(readConversationDraft(project.id, 'check-one').text).toBe('My first check draft');
  expect(readConversationDraft(project.id, 'check-two').text).toBe('');
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
    const exportButton = await card.findByRole('button', { name: 'Export' });
    expect(card.getByText('Browser', { exact: true })).toBeInTheDocument();
    expect(card.getByText('Proven in the browser')).toBeInTheDocument();
    expect(card.queryByText('Found in code')).toBeNull();
    expect(card.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(timestamp)))).toHaveAttribute('datetime', timestamp);
    expect(within(card.getByRole('group', { name: 'Report actions' })).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(['Export', 'Ask about this check', 'View']);
    expect(gaps).toHaveAttribute('aria-expanded', 'false');
    await user.click(gaps);
    expect(gaps).toHaveAttribute('aria-expanded', 'true');
    expect(card.getByRole('listitem')).toHaveTextContent('Control permission was missing');
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
  await user.click(screen.getByRole('button', { name: 'Open full Check' }));
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
