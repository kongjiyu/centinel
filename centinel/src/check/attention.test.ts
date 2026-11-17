import { expect, it } from 'vitest';
import type { AutoTestSession } from '../autotest/types';
import type { ConnectedSource, Project } from '../types';
import { rankAttention } from './attention';
import type { CheckRecord } from './types';

const now = Date.parse('2026-11-17T12:00:00Z');
const project = (id: string): Project => ({ id, name: id, description: '', workspacePath: '/app', createdAt: '2026-09-01', updatedAt: '' });
const check = (projectId: string, at: string, viewed = true): CheckRecord => ({
  id: projectId, projectId, projectName: projectId, createdAt: at, updatedAt: at, viewedAt: viewed ? at : undefined,
  documents: [], focus: '', mode: 'code', phase: 'done', notes: [],
});
const synced: ConnectedSource = {
  id: 'source', projectId: 'changed', integrationId: 'github', kind: 'github_repository',
  provider: 'github', status: 'active', syncStatus: 'ready', remoteRevision: 'revision',
  name: 'Repo', remoteId: 'example/repo', remoteUrl: null, selectedScope: { branch: 'main' },
  lastSuccessfulSyncAt: '2026-11-16', lastSyncedAt: '2026-11-16', syncCursor: null, lastError: null,
  createdAt: '2026-09-01', updatedAt: '2026-11-16',
  latestSyncRun: { id: 'sync', projectId: 'changed', sourceId: 'source', status: 'success', startedAt: '2026-11-16',
    updatedCount: 2, importedCount: 0, unchangedCount: 0, removedCount: 0, inaccessibleCount: 0,
    retryable: false, errorCode: null, errorMessage: null, createdAt: '2026-11-16', completedAt: '2026-11-16' },
};

it('ranks unseen results, synced changes, first checks and oldest inactivity, ignoring recent chat activity', () => {
  const projects = ['stale', 'first', 'changed', 'unseen', 'chat', 'too-recent'].map(project);
  const checks = [check('stale', '2026-09-01'), check('changed', '2026-11-15'), check('unseen', '2026-11-16', false),
    check('chat', '2026-09-01'), check('too-recent', '2026-11-01')];
  const activity = new Map(projects.map(item => [item.id, {
    sources: item.id === 'changed' ? [synced] : [],
    reviews: [],
    sessions: item.id === 'chat' ? [{ request: { text: 'Check checkout' }, updatedAt: '2026-11-16' } as AutoTestSession] : [],
  }]));
  const items = rankAttention(projects, checks, activity, now);
  expect(items.map(item => [item.project.id, item.event])).toEqual([
    ['unseen', 'Result to review'], ['changed', 'Synced changes on main'],
    ['first', 'First check'], ['stale', 'No check or chat activity in 30 days'],
  ]);
  expect(items[0]).toMatchObject({ mode: 'code', check: { id: 'unseen' } });
});

it('leaves projects with unavailable check history unclassified', () => {
  expect(rankAttention([project('unknown')], [], new Map(), now)).toEqual([]);
});
