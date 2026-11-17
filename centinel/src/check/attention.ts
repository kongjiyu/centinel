import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AutoTestSession } from '../autotest/types';
import type { ConnectedSource, Project, ReviewSourceManifest, StaticSession } from '../types';
import { latestSuccessfulReview } from '../reviewCurrency';
import type { CheckMode, CheckRecord } from './types';
import { projectLocalFolder } from './projectWorkspace';

export type AttentionItem = {
  project: Project;
  mode: CheckMode;
  event: string;
  priority: 1 | 2 | 3 | 4;
  check?: CheckRecord;
};

type ProjectActivity = {
  sources: ConnectedSource[] | null;
  reviews: StaticSession[] | null;
  sessions: AutoTestSession[] | null;
  manifest?: ReviewSourceManifest | null;
};

const INACTIVE_FOR = 30 * 24 * 60 * 60 * 1000;
const time = (date: string | null | undefined) => Date.parse(date ?? '') || 0;

export function rankAttention(projects: Project[], checks: CheckRecord[], activity: Map<string, ProjectActivity>, now = Date.now()) {
  const ranked: Array<AttentionItem & { at: number }> = [];
  for (const project of projects) {
    const history = checks.filter(check => check.projectId === project.id);
    const suggestedMode = projectLocalFolder(project) ? 'both' : 'code';
    const unseen = history.filter(check => check.phase === 'done' && !check.viewedAt)
      .sort((a, b) => time(b.finishedAt ?? b.updatedAt) - time(a.finishedAt ?? a.updatedAt))[0];
    if (unseen) {
      ranked.push({ project, mode: unseen.mode, event: 'Result to review', check: unseen, priority: 1, at: time(unseen.finishedAt ?? unseen.updatedAt) });
      continue;
    }

    const details = activity.get(project.id);
    const reviews = details?.reviews ?? [];
    const sessions = details?.sessions ?? [];
    const checkTimes = [
      ...history.map(check => time(check.createdAt)),
      ...reviews.map(review => time(review.createdAt)),
      ...sessions.filter(session => !session.request && session.planning !== false).map(session => time(session.createdAt)),
    ];
    const lastCheck = Math.max(0, ...checkTimes);
    const latestReview = latestSuccessfulReview(reviews);
    const refs = latestReview && details?.manifest?.sessionId === latestReview.id && details.manifest.status === 'available'
      && lastCheck <= time(latestReview.createdAt) ? details.manifest.gitRefs ?? [] : [];
    const changed = (details?.sources ?? []).flatMap(source => {
      if (source.provider !== 'github' || source.status !== 'active' || source.syncStatus !== 'ready' || !source.remoteRevision || !lastCheck) return [];
      const branch = source.selectedScope.branch ?? source.syncCursor?.branch;
      const sameBranch = typeof branch === 'string' && branch
        ? refs.filter(ref => ref.branch === branch && ref.repository.toLowerCase() === source.remoteId.toLowerCase()) : [];
      const newerRevision = sameBranch.length === 1 && sameBranch[0].commit !== source.remoteRevision;
      const run = source.latestSyncRun;
      const changedFiles = run?.status === 'success' && time(run.startedAt) > lastCheck
        && (run.updatedCount > 0 || run.removedCount > 0 || (run.importedCount > 0 && run.unchangedCount > 0));
      if (!newerRevision && !changedFiles) return [];
      return [{ event: typeof branch === 'string' && branch ? `Synced changes on ${branch}` : 'Repository changes synced', at: time(source.lastSuccessfulSyncAt) }];
    }).sort((a, b) => b.at - a.at)[0];
    if (changed && details?.reviews && details.sessions) {
      ranked.push({ project, mode: suggestedMode, ...changed, priority: 2 });
    } else if (!lastCheck && details?.reviews && details.sessions) {
      ranked.push({ project, mode: suggestedMode, event: 'First check', priority: 3, at: time(project.createdAt) });
    } else if (lastCheck && details?.reviews && details.sessions) {
      const lastActivity = Math.max(lastCheck, ...history.map(check => time(check.finishedAt ?? check.updatedAt)),
        ...reviews.map(review => time(review.completedAt ?? review.createdAt)), ...sessions.map(session => time(session.updatedAt)));
      if (lastActivity < now - INACTIVE_FOR) ranked.push({ project, mode: suggestedMode, event: 'No check or chat activity in 30 days', priority: 4, at: lastActivity });
    }
  }
  return ranked.sort((a, b) => a.priority - b.priority || (a.priority === 4 ? a.at - b.at : b.at - a.at) || a.project.name.localeCompare(b.project.name));
}

export function useAttention(projects: Project[], checks: CheckRecord[]) {
  const [activity, setActivity] = useState(() => new Map<string, ProjectActivity>());
  useEffect(() => {
    if (!projects.length) return;
    let active = true;
    let next = 0;
    const results = new Map<string, ProjectActivity>();
    const load = async () => {
      while (active && next < projects.length) {
        const { id } = projects[next++];
        const [sources, reviews, sessions] = await Promise.all([
          api.listConnectedSources(id).catch(() => null),
          api.listStaticSessions(id, { summary: true }).catch(() => null),
          api.autoTests(id).catch(() => null),
        ]);
        const latest = latestSuccessfulReview(reviews ?? []);
        const manifest = active && latest && sources?.some(source => source.provider === 'github' && source.remoteRevision)
          ? await api.getReviewSourceManifest(id, latest.id).catch(() => null) : null;
        results.set(id, { sources, reviews, sessions, manifest });
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, projects.length) }, load)).then(() => {
      if (active) setActivity(results);
    });
    return () => { active = false; };
  }, [projects]);
  return rankAttention(projects, checks, activity);
}
