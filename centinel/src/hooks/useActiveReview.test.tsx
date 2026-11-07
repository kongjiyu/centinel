import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { StaticSession } from '../types';
import { useActiveReview } from './useActiveReview';

vi.mock('../api/client', () => ({
  api: {
    listActiveStaticSessions: vi.fn(),
    getStaticSession: vi.fn(),
    listStaticFindings: vi.fn().mockResolvedValue([]),
    projects: vi.fn().mockResolvedValue([{ id: 'project-a', name: 'Sample shop' }]),
  },
}));

const session = (status: StaticSession['status']) =>
  ({ id: 'review-1', projectId: 'project-a', name: 'Code review', reviewType: 'code', status, createdAt: '2026-11-07T15:11:00Z' }) as unknown as StaticSession;

let visibility: DocumentVisibilityState = 'hidden';

describe('active Review toast polling', () => {
  beforeEach(() => {
    visibility = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('leaves "running" once someone interacts with a window that reports hidden', async () => {
    vi.mocked(api.listActiveStaticSessions).mockResolvedValueOnce([session('running')]).mockResolvedValue([]);
    vi.mocked(api.getStaticSession).mockResolvedValue(session('pending_approval'));
    const { result } = renderHook(() => useActiveReview());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state?.session.status).toBe('running');

    // Hidden and idle: no polling, so the toast cannot change yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.listActiveStaticSessions).toHaveBeenCalledOnce();
    expect(result.current.state?.session.status).toBe('running');

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state?.session.status).toBe('pending_approval');
  });
});
