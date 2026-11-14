import type { ReviewProgress } from '../types';

const workflow = [
  { id: 'freezing_sources', label: 'Discovering all possible behavior and paths' },
  { id: 'deterministic_analysis', label: 'Checking For Documents' },
  { id: 'model_analysis', label: 'Tracing Behaviors' },
  { id: 'environment', label: 'Checking the Environment' },
  { id: 'persisting_evidence', label: 'Updating the results' },
];

export function reviewToastStages(progress: ReviewProgress) {
  if (!progress.stage) return progress.stages;
  const active = progress.stage === 'indexing_context' ? 0
    : progress.stage === 'model_analysis' ? progress.assessmentPhase === 'documents' ? 1 : progress.assessmentPhase === 'environment' ? 3 : 2
      : workflow.findIndex(stage => stage.id === progress.stage);
  return workflow.map(({ id, label }, index) => ({
    id, label,
    status: active >= 0 ? index < active ? 'done' : index === active ? 'active' : 'pending'
      : progress.completedStages?.includes(id === 'environment' ? 'model_analysis' : id) ? 'done' : 'pending',
    thoughts: [],
  }));
}

export function reviewToastStageStatus(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'active') return 'In progress';
  if (status === 'pending') return 'Not started';
  return status.replace(/_/g, ' ');
}
