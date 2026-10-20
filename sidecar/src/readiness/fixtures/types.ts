import type { ArtifactSource, ArtifactType } from '../../artifacts.js';
import type { ReadinessState } from '../types.js';

export type ReadinessSemanticCategory = 'requirements' | 'design' | 'standards';
export type ReadinessCriterionVerdict = 'pass' | 'gap' | 'unknown';

export type EvaluationQuote = { sourceId: string; excerpt: string };

export type ExpectedScopeCoverage = {
  scopeItem: string;
  scopeEvidence: EvaluationQuote;
  status: 'covered' | 'gap' | 'unknown';
  coverageEvidence: EvaluationQuote[];
};

export type ExpectedReadinessCategory = {
  state: ReadinessState;
  presence: 'present' | 'missing';
  checks: Record<string, ReadinessCriterionVerdict>;
  evidence?: Record<string, EvaluationQuote[]>;
  classificationEvidence?: EvaluationQuote[];
  scopeCoverage?: ExpectedScopeCoverage[];
};

export type ReadinessEvaluationFixture = {
  id: string;
  description: string;
  sources: Array<{
    sourceId: string;
    fileName: string;
    filePath: string;
    artifactType: ArtifactType;
    source: ArtifactSource;
    content: string;
  }>;
  expected: Record<ReadinessSemanticCategory, ExpectedReadinessCategory>;
};
