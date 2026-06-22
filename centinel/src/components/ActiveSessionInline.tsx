import { Loader, X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { api } from '../api/client';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Understanding Context',
  code_review: 'Code Review',
  requirement_validation: 'Requirement Validation',
  summarizing: 'Summarizing',
};

const ALL_STAGES = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;

export function ActiveSessionInline({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const { state } = useActiveReviewState();
  if (!state) return null;
  const { session } = state;
  if (session.projectId !== projectId || session.id !== sessionId) return null;
  if (session.status !== 'running' && session.status !== 'queued') return null;

  const active = session.progress.stages.find(s => s.status === 'active');
  const currentStageId = active?.id ?? session.progress.currentStage;
  const lastThought = active?.thoughts[active.thoughts.length - 1];

  const handleCancel = async () => {
    try { await api.cancelStaticSession(session.projectId, session.id); } catch {}
  };

  return (
    <div className="active-session-inline">
      <div className="active-session-inline-stages">
        {ALL_STAGES.map(s => {
          const stage = session.progress.stages.find(x => x.id === s);
          const status = stage?.status ?? (s === currentStageId ? 'active' : 'pending');
          return <span key={s} className={`stage-dot stage-${status}`} title={STAGE_LABELS[s] ?? s} />;
        })}
      </div>
      <div className="active-session-inline-detail">
        <Loader size={12} className="spin" />
        <span>{STAGE_LABELS[currentStageId] ?? currentStageId}</span>
        {lastThought ? <span className="active-session-inline-thought">· {lastThought}</span> : null}
      </div>
      <button className="btn-link" onClick={handleCancel}>
        <X size={12} /> Cancel
      </button>
    </div>
  );
}
