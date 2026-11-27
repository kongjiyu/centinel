import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConversationRequest } from '../../check/conversationTypes';
import { api } from '../../api/client';
import { ConversationQuotePreview } from './ConversationQuotePreview';

vi.mock('../../api/client', () => ({ api: { conversationRequest: vi.fn() } }));

const savedReply = {
  id: 'older-turn', projectId: 'project', ownerId: 'owner', revision: 1,
  createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:01.000Z',
  input: { id: 'older-turn', text: 'Earlier request', mode: 'browser', permission: 'ask', references: [] },
  inputHash: 'hash', state: 'completed', action: 'explain', policyVersion: 'local-test', events: [],
  reply: '## Saved answer\n\n' + 'Full reply detail. '.repeat(40),
} as ConversationRequest;

function quote(projectId = 'project', turnId = 'older-turn', previewText: string | null = 'Compact reply preview.') {
  return <ConversationQuotePreview className="pc-reply-attribution" projectId={projectId} ownerId="owner"
    turnId={turnId} preview={previewText ?? undefined} label="Quoted reply">
    {preview => <><strong>Quoted reply</strong>{preview && <span>{preview}</span>}</>}
  </ConversationQuotePreview>;
}

it('renders the original Markdown structure in the full preview and a clean excerpt on the chip', async () => {
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  vi.mocked(api.conversationRequest).mockResolvedValue({
    ...savedReply, replyFormat: 'markdown',
    reply: '**Documented project scope**\n\n| Area | Outcome |\n| --- | --- |\n| Checkout | Blocked |\n\n- Read `src/orders.js`\n- See [requirements](https://example.com/docs)',
  });
  render(quote('project', 'older-turn', null));
  await userEvent.setup().tab();
  const tooltip = within(screen.getByRole('tooltip'));
  expect(await tooltip.findByRole('table')).toHaveTextContent('Checkout');
  expect(tooltip.getByRole('list')).toHaveTextContent('Read src/orders.js');
  expect(tooltip.getByText('src/orders.js').tagName).toBe('CODE');
  expect(tooltip.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getAllByText('Documented project scope')).toHaveLength(2);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('loads the full older reply on hover through the project-scoped request lookup', async () => {
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  vi.mocked(api.conversationRequest).mockResolvedValue(savedReply);
  const user = userEvent.setup();
  render(quote());

  await user.hover(screen.getByRole('group', { name: 'Quoted reply' }));

  expect(api.conversationRequest).toHaveBeenCalledWith('project', 'older-turn');
  expect(screen.getByText('Compact reply preview.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Full reply detail. '.repeat(40).trim()));
});

it('does not expose a response that arrives after the quote changes project', async () => {
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  let resolveReply!: (reply: ConversationRequest) => void;
  vi.mocked(api.conversationRequest).mockReturnValue(new Promise(resolve => { resolveReply = resolve; }));
  const user = userEvent.setup();
  const view = render(quote('project'));
  await user.hover(screen.getByRole('group', { name: 'Quoted reply' }));
  view.rerender(quote('another-project'));

  await act(async () => { resolveReply(savedReply); await Promise.resolve(); });

  expect(screen.getByRole('tooltip')).not.toHaveTextContent('Full reply detail.');
  expect(screen.getByRole('tooltip')).toHaveTextContent('Hover or focus to load the full quoted reply.');
});

it('discards a full reply if the owner signs out while the request is in flight', async () => {
  sessionStorage.setItem('centinel:supabase-user-id', 'owner');
  let resolveReply!: (reply: ConversationRequest) => void;
  vi.mocked(api.conversationRequest).mockReturnValue(new Promise(resolve => { resolveReply = resolve; }));
  const user = userEvent.setup();
  render(quote());
  await user.hover(screen.getByRole('group', { name: 'Quoted reply' }));
  sessionStorage.clear();

  await act(async () => { resolveReply(savedReply); await Promise.resolve(); });

  expect(screen.getByRole('tooltip')).not.toHaveTextContent('Full reply detail.');
  expect(screen.getByRole('tooltip')).toHaveTextContent('The full quoted reply is unavailable.');
});
