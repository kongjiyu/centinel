import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ConversationRequest } from './conversationTypes';
import type { Project, Screen } from '../types';
import { useConversationQuestionQueue } from './conversationQuestionQueue';

vi.mock('../api/client', () => ({ api: { pendingConversationQuestions: vi.fn(), answerConversationQuestion: vi.fn() } }));

const project: Project = { id: 'project-a', name: 'Project A', description: '', workspacePath: '', createdAt: '2026-11-01', updatedAt: '2026-11-01' };
const projects = [project];
const account = 'account-a';
const storageKey = `centinel:conversation-question-timers:${account}`;
const pending = (ownerId = account): ConversationRequest => ({
  id: 'request-a', projectId: project.id, ownerId, revision: 4, createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z', input: { id: 'input-a', text: 'Check this behavior', mode: 'browser', permission: 'auto', references: [] },
  inputHash: 'hash', state: 'completed', action: 'clarify', pendingQuestionId: 'question-a',
  questions: [{ id: 'question-a', createdAt: '2026-11-26T00:00:01.000Z', text: 'Which result should I check?',
    options: ['The success message', 'The error message'] }], policyVersion: 'test', events: [],
});

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('project conversation question timer persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.mocked(api.pendingConversationQuestions).mockResolvedValue([pending()]);
    vi.mocked(api.answerConversationQuestion).mockResolvedValue(pending());
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the original window and absolute countdown deadline across an app reload', async () => {
    const screen: Screen = { name: 'dashboard' };
    const first = renderHook(() => useConversationQuestionQueue(projects, screen, true, account));
    await settle();
    expect(first.result.current.head?.question.id).toBe('question-a');
    const firstStored = JSON.parse(localStorage.getItem(storageKey)!) as Record<string, { initialDeadline: number; countdownDeadline?: number }>;
    const firstState = Object.values(firstStored)[0];
    expect(firstState.initialDeadline).toBe(Date.now() + 5_000);

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    const countdown = first.result.current.countdown;
    expect(countdown).toBeDefined();
    first.unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const second = renderHook(() => useConversationQuestionQueue(projects, screen, true, account));
    await settle();
    expect(second.result.current.head?.question.id).toBe('question-a');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(second.result.current.countdown?.deadlineAt).toBe(countdown?.deadlineAt);
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.max(0, (countdown?.deadlineAt ?? Date.now()) - Date.now() + 400)); });
    expect(api.answerConversationQuestion).toHaveBeenCalledTimes(1);
    expect(api.answerConversationQuestion).toHaveBeenCalledWith(project.id, 'request-a', expect.objectContaining({
      questionId: 'question-a', answer: { kind: 'option', selectedOption: 0 }, automatic: true,
    }));
    second.unmount();
  });

  it('persists return cancellation for the exact question and isolates timing by account', async () => {
    const screen: Screen = { name: 'dashboard' };
    const first = renderHook<ReturnType<typeof useConversationQuestionQueue>, { currentScreen: Screen; owner: string }>(({ currentScreen, owner }) =>
      useConversationQuestionQueue(projects, currentScreen, true, owner), { initialProps: { currentScreen: screen, owner: account } });
    await settle();
    expect(first.result.current.head?.question.id).toBe('question-a');
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(first.result.current.countdown).toBeDefined();

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    first.rerender({ currentScreen: { name: 'project', projectId: project.id }, owner: account });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(first.result.current.countdown).toBeUndefined();
    const canceledState = Object.values(JSON.parse(localStorage.getItem(storageKey)!))[0] as { cancelled: boolean };
    expect(canceledState.cancelled).toBe(true);
    first.unmount();

    vi.mocked(api.pendingConversationQuestions).mockResolvedValue([pending('account-b')]);
    const other = renderHook(() => useConversationQuestionQueue(projects, screen, true, 'account-b'));
    await settle();
    expect(other.result.current.head?.request.ownerId).toBe('account-b');
    const otherState = Object.values(JSON.parse(localStorage.getItem('centinel:conversation-question-timers:account-b')!))[0] as { cancelled: boolean };
    expect(otherState.cancelled).toBe(false);
    other.unmount();
  });
});
