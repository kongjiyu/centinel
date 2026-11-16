/**
 * A Check is everything Centinel did after one press of Start (DESIGN.md §3).
 * It is a thin, device-local index over existing records: the project, one Review
 * and one Auto test session. Results always come from those saved records.
 */
export type CheckMode = 'both' | 'code' | 'browser';

export type CheckPhase = 'preparing' | 'running' | 'done' | 'failed';

export type CheckPrepStep = 'project' | 'documents' | 'github' | 'review' | 'browser';

export type CheckRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  projectName: string;
  folder?: string;
  githubUrl?: string;
  documents: string[];
  focus: string;
  mode: CheckMode;
  phase: CheckPhase;
  prepStep?: CheckPrepStep;
  reviewId?: string;
  autoTestId?: string;
  /** Plain-language notes about parts that could not run, shown on Live and Result. */
  notes: string[];
  error?: string;
  /** Cached for the sidebar only; Result recomputes from saved records. */
  problemCount?: number;
  finishedAt?: string;
};

export type CheckDocument = { name: string; base64: string };

export type StartCheckInput = {
  folder?: string;
  githubUrl?: string;
  documents: CheckDocument[];
  focus: string;
  mode: CheckMode;
};
