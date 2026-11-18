import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { resetCheckStore, saveCheck } from '../../check/store';
import { readConversationDraft } from '../../check/conversation';
import type { ConversationRequest } from '../../check/conversationTypes';
import type { Finding, Project, Screen, StaticSession } from '../../types';
import { ProjectConversationScreen } from './ProjectConversationScreen';
import { CheckScreen } from '../check/CheckScreen';

vi.mock('../../api/client', () => ({ api: {
  autoTests: vi.fn(), autoTest: vi.fn(), listArtifacts: vi.fn(), listStaticSessions: vi.fn(), listStaticFindings: vi.fn(),
  listRequirements: vi.fn(), getStaticSession: vi.fn(), getReviewHarness: vi.fn(), conversationRequests: vi.fn(),
  sendConversationRequest: vi.fn(), exportProjectReport: vi.fn(), getReviewTraceability: vi.fn(),
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

it('restores each draft when switching checks and posts only the sent draft to the project', async () => {
  saveCheck({ id: 'check-two', projectId: project.id, projectName: project.name, title: 'Catalog Browse', reviewId,
    createdAt: '2026-11-18T01:20:00Z', updatedAt: '2026-11-18T01:30:00Z', mode: 'code', phase: 'done', documents: [], focus: '', notes: [] });
  vi.mocked(api.sendConversationRequest).mockImplementation(async (_, input) => accepted(input));
  const user = userEvent.setup();
  render(<Workspace />);
  await user.type(screen.getByRole('textbox', { name: 'Message to Centinel' }), 'My project draft');
  await user.click(within(screen.getByRole('region', { name: 'Check Order Access' })).getByRole('button', { name: 'View' }));
  const prompt = () => screen.getByRole('textbox', { name: 'Follow-up check' });
  expect(prompt()).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Remove check Order Access' })).toBeInTheDocument();
  await user.type(prompt(), 'My first check draft');
  const open = async (name: string) => {
    await user.click(screen.getByRole('button', { name: 'Check history' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Check history' })).getByRole('button', { name }));
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
  expect(screen.getByRole('textbox', { name: 'Message to Centinel' })).toHaveValue('My project draft');
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
  const next = await screen.findByRole('textbox', { name: 'Message to Centinel' });
  expect(next).toHaveValue('');
  expect(readConversationDraft(project.id, 'check-one').text).toBe('Now explain the ownership evidence');
});
