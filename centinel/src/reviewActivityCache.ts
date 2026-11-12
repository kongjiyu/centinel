import { REVIEW_WORKFLOW_STAGES } from './reviewNarrative';
import { parseReviewProgress } from './reviewViewModel';
import type { StaticSession } from './types';

const storageKey = 'centinel:review-activity-preview:v1';
const maxAge = 24 * 60 * 60 * 1000;
const maxPreviews = 12;
type StageId = (typeof REVIEW_WORKFLOW_STAGES)[number]['id'];
type Preview = {
  accountId: string;
  projectId: string;
  sessionId: string;
  updatedAt: string;
  stage: StageId | null;
  completedStages: StageId[];
};

function storedPreviews(accountId: string): Preview[] {
  try {
    const values: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(values)) return [];
    const now = Date.now();
    return values.filter((value: Partial<Preview> | null) => {
      if (!value || value.accountId !== accountId || typeof value.updatedAt !== 'string' || !Array.isArray(value.completedStages)) return false;
      const age = now - Date.parse(value.updatedAt);
      return age >= 0 && age < maxAge;
    }).slice(0, maxPreviews);
  } catch {
    return [];
  }
}

/** Keep a bounded set of recent stage previews on this device. */
export function rememberReviewActivity(accountId: string | null | undefined, session: StaticSession) {
  if (!accountId) return;
  try {
    const entries = storedPreviews(accountId);
    const matchesReview = (entry: Preview) => entry.projectId === session.projectId && entry.sessionId === session.id;
    const previous = entries.find(matchesReview);
    const otherReviews = entries.filter(entry => !matchesReview(entry));
    if (session.status !== 'queued' && session.status !== 'running') {
      if (previous) window.localStorage.setItem(storageKey, JSON.stringify(otherReviews));
      return;
    }
    const progress = parseReviewProgress(session.progressJson);
    const updatedAt = progress?.updatedAt || session.updatedAt || session.createdAt;
    if (!Number.isFinite(Date.parse(updatedAt)) || (previous && Date.parse(previous.updatedAt) >= Date.parse(updatedAt))) return;
    const snapshot: Preview = {
      accountId,
      projectId: session.projectId,
      sessionId: session.id,
      updatedAt,
      stage: REVIEW_WORKFLOW_STAGES.find(stage => stage.id === progress?.stage)?.id ?? null,
      completedStages: REVIEW_WORKFLOW_STAGES.filter(stage => progress?.completedStages?.includes(stage.id)).map(stage => stage.id),
    };
    window.localStorage.setItem(storageKey, JSON.stringify([snapshot, ...otherReviews].slice(0, maxPreviews)));
  } catch {
    // A blocked or full local store does not affect Review execution.
  }
}

export function readReviewActivityPreview(accountId: string | null | undefined, projectId: string, sessionId: string) {
  if (!accountId) return null;
  const snapshot = storedPreviews(accountId).find(entry => entry.projectId === projectId && entry.sessionId === sessionId);
  if (!snapshot) return null;
  return {
    updatedAt: snapshot.updatedAt,
    stages: REVIEW_WORKFLOW_STAGES.map(({ id, title }) => ({
      id,
      title,
      status: snapshot.completedStages.includes(id) ? 'Completed' : snapshot.stage === id ? 'Last active' : 'Not recorded',
    })),
  };
}
