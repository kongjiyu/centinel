import { REVIEW_WORKFLOW_STAGES } from '../reviewNarrative';
import type { ReviewProgress } from '../types';

const progressLabels: Record<string, string> = {
  freezing_sources: 'Discover behaviors and paths',
  indexing_context: 'Prepare source and requirement evidence',
  deterministic_analysis: 'Run code checks',
  model_analysis: 'Trace code paths and validate issues',
  persisting_evidence: 'Save issues and compare with prior reviews',
};

export function reviewToastStages(progress: ReviewProgress) {
  if (!progress.stage) return progress.stages;
  return REVIEW_WORKFLOW_STAGES.map(({ id, title }) => ({
    id,
    label: progressLabels[id] ?? title,
    status: progress.completedStages?.includes(id) ? 'done' : progress.stage === id ? 'active' : 'pending',
    thoughts: [],
  }));
}

export function reviewToastStageStatus(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'active') return 'In progress';
  if (status === 'pending') return 'Not started';
  return status.replace(/_/g, ' ');
}
