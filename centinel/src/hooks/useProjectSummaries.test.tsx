import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { getProjectState, useProjectSummaries } from './useProjectSummaries';
import type { Project, StaticSession } from '../types';

vi.mock('../api/client', () => ({ api: { listStaticSessions: vi.fn(), listDynamicSessions: vi.fn(), listArtifacts: vi.fn() } }));
const projects: Project[] = ['fast', 'slow'].map(id => ({ id, name: id, description: '', workspacePath: '', createdAt: '2026-10-13', updatedAt: '2026-10-13' }));

describe('progressive project summaries', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.listDynamicSessions).mockResolvedValue([]); vi.mocked(api.listArtifacts).mockResolvedValue([]); });
  it('keeps provider pauses distinct from failures in project states and required actions', async () => {
    vi.mocked(api.listStaticSessions).mockResolvedValue([{ id: 'paused-review', projectId: 'fast', status: 'blocked', reviewType: 'code_review', name: 'Paused review',
      progressJson: JSON.stringify({ stage: 'provider_paused' }), failureReason: 'Paused: the Model Provider reported insufficient credits. Retry manually.', updatedAt: '2026-10-20', createdAt: '2026-10-20' } as StaticSession]);
    const selectedProjects = [projects[0]];
    const { result } = renderHook(() => useProjectSummaries(selectedProjects));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getProjectState(result.current.summaries[0])).toMatchObject({ label: 'Paused', tone: 'warning' });
    expect(result.current.summaries[0].action?.state).toBe('Paused');
  });
  it('renders metadata immediately and enriches fast projects without waiting for another project', async () => {
    let finishSlow!: (value: []) => void;
    vi.mocked(api.listStaticSessions).mockImplementation(id => id === 'fast' ? Promise.resolve([]) : new Promise(resolve => { finishSlow = resolve; }));
    const { result } = renderHook(() => useProjectSummaries(projects));
    expect(result.current.summaries).toHaveLength(2);
    expect(getProjectState(result.current.summaries.find(item => item.project.id === 'slow')!).label).toMatch(/loading/i);
    await waitFor(() => expect(getProjectState(result.current.summaries.find(item => item.project.id === 'fast')!).label).toBe('Setup required'));
    expect(result.current.loading).toBe(true);
    await act(async () => { finishSlow([]); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
  it('never presents failed activity queries as a known No activity state', async () => {
    vi.mocked(api.listStaticSessions).mockRejectedValue(new Error('network unavailable'));
    const oneProject = [projects[0]];
    const { result } = renderHook(() => useProjectSummaries(oneProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unavailable).toBe(true);
    expect(getProjectState(result.current.summaries[0]).label).toBe('Activity unavailable');
  });
});
