import { createContext, useContext } from 'react';
import type { Finding, ReviewProgress, ReviewType, StaticSessionStatus } from '../types';

export type ActiveReviewSnapshot = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  progress: ReviewProgress;
  findings: Finding[];
  finalSummary: string;
  failureReason: string;
  createdAt: string;
};

export type ActiveReviewState = {
  session: ActiveReviewSnapshot;
  expanded: boolean;
  completedAt: string | null;
  dismissed: boolean;
  connectionLost: boolean;
};

export type ActiveReviewControls = {
  setExpanded: (expanded: boolean) => void;
  setDismissed: (dismissed: boolean) => void;
  retry: () => void;
};

export const ActiveReviewContext = createContext<{
  state: ActiveReviewState | null;
  controls: ActiveReviewControls;
} | null>(null);

export function useActiveReviewState() {
  const ctx = useContext(ActiveReviewContext);
  if (!ctx) throw new Error('useActiveReviewState must be used inside <ActiveReviewProvider>');
  return ctx;
}
