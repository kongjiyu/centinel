import { describe, expect, it } from 'vitest';
import type { DynamicSession } from '../types';
import type { DynamicRun, MissionRevision } from './types';
import { dynamicActivityScreen, latestPerSavedTest, mergeDynamicActivity, runActivityStatus, runToActivitySession } from './runActivity';

const revision = { id: 'revision-1', missionId: 'mission-1', revision: 1, name: 'Demo todo add', goal: 'Add a todo', targetUrl: 'http://localhost:37702/', maxSteps: 15, checks: [] } as unknown as MissionRevision;
const run = (patch: Partial<DynamicRun> = {}): DynamicRun => ({
  id: 'run-1', projectId: 'project-1', missionId: 'mission-1', revision, idempotencyKey: 'key', createdBy: 'actor',
  createdAt: '2026-10-29T04:14:12.000Z', updatedAt: '2026-10-29T04:14:48.000Z',
  state: 'completed', verdict: 'passed', reason: null, checks: [], evidence: [], legacySessionId: 'legacy-1', ...patch,
});
const legacy = (patch: Partial<DynamicSession> = {}): DynamicSession => ({
  id: 'legacy-1', projectId: 'project-1', type: 'dynamic', name: 'Journey: Add a todo', status: 'blocked', targetUrl: 'http://localhost:37702/',
  goal: 'Add a todo', missionType: 'user_journey', browserMode: 'headed', maxSteps: 15, finalSummary: '', failureReason: '',
  createdAt: '2026-10-29T04:14:12.000Z', updatedAt: '2026-10-29T04:14:48.000Z', ...patch,
});

describe('shared Run activity', () => {
  it('follows the Run state and independent verdict', () => {
    expect(runActivityStatus({ state: 'completed', verdict: 'passed' })).toBe('success');
    expect(runActivityStatus({ state: 'completed', verdict: 'failed' })).toBe('failure');
    expect(runActivityStatus({ state: 'completed', verdict: 'uncertain' })).toBe('blocked');
    expect(runActivityStatus({ state: 'blocked', verdict: 'not_tested' })).toBe('blocked');
    expect(runActivityStatus({ state: 'interrupted', verdict: 'not_tested' })).toBe('blocked');
    expect(runActivityStatus({ state: 'running', verdict: 'not_tested' })).toBe('running');
    expect(runActivityStatus({ state: 'cancelled', verdict: 'not_tested' })).toBe('cancelled');
  });

  it('uses the saved test name instead of the goal', () => {
    expect(runToActivitySession(run())).toMatchObject({ id: 'run-1', runId: 'run-1', missionId: 'mission-1', name: 'Demo todo add', status: 'success' });
  });

  it('replaces a device-local mirror with its shared Run and keeps unrelated legacy sessions', () => {
    const merged = mergeDynamicActivity([run()], [legacy(), legacy({ id: 'older-local', name: 'Old local session' })]);
    expect(merged.map(item => item.id)).toEqual(['run-1', 'older-local']);
    expect(merged[0].status).toBe('success');
  });

  it('lets a later Run of the same saved test supersede an earlier outcome', () => {
    const blocked = runToActivitySession(run({ id: 'run-0', state: 'blocked', verdict: 'not_tested', updatedAt: '2026-10-29T04:11:40.000Z' }));
    const passed = runToActivitySession(run());
    const other = runToActivitySession(run({ id: 'run-x', missionId: 'mission-2', state: 'blocked', verdict: 'not_tested' }));
    expect(latestPerSavedTest([blocked, passed, other, legacy({ id: 'local' })]).map(item => item.id).sort()).toEqual(['local', 'run-1', 'run-x']);
  });

  it('opens shared Runs in Dynamic Testing and legacy sessions in their record view', () => {
    expect(dynamicActivityScreen('project-1', { id: 'run-1', runId: 'run-1' })).toEqual({ name: 'dynamic-testing', projectId: 'project-1', runId: 'run-1' });
    expect(dynamicActivityScreen('project-1', { id: 'legacy-1' })).toEqual({ name: 'dynamic-session', projectId: 'project-1', sessionId: 'legacy-1' });
  });
});
