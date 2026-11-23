import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationRequest } from '../../check/conversationTypes';
import { ConversationTurn } from './ConversationTurn';

vi.mock('../../api/client', () => ({ api: {} }));

const request: ConversationRequest = {
  id: 'test-request', projectId: 'demo-project', ownerId: 'fixture-user',
  createdAt: '', updatedAt: '', revision: 1,
  input: { id: 'test-input', text: 'Explain the checkout result', mode: 'code', permission: 'ask', references: [] },
  inputHash: 'fixture', policyVersion: 'fixture', state: 'completed', action: 'explain', events: [],
};

describe('ConversationTurn reply structure', () => {
  it('presents a takeaway, optional comparison and evidence separately', () => {
    render(<ConversationTurn onNavigate={vi.fn()} request={{ ...request, replyFormat: 'markdown',
      reply: 'The saved checkout check is inconclusive.\n\n- The total was visible.\n- The source excerpt was unavailable.\n\n| Check | Observation |\n| --- | --- |\n| Total | Visible |',
      citations: ['artifact:fixture'],
    }} />);
    expect(screen.getByText('The saved checkout check is inconclusive.')).toBeVisible();
    expect(screen.getByText('The source excerpt was unavailable.')).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('Visible')).toBeVisible();
    expect(screen.getByText('Saved evidence')).toBeVisible();
  });

  it('keeps old replies literal and does not expose images or links from new replies', () => {
    const body = '**Findings** [external](https://example.test) ![image](https://example.test/file)';
    const { rerender } = render(<ConversationTurn onNavigate={vi.fn()} request={{ ...request, reply: body }} />);
    expect(screen.getByText(body)).toBeVisible();
    rerender(<ConversationTurn onNavigate={vi.fn()} request={{ ...request, reply: body, replyFormat: 'markdown' }} />);
    expect(screen.getByText('Findings').tagName).toBe('STRONG');
    expect(screen.getByText(/external/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});