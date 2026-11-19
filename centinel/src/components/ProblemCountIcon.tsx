import { Check, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { CheckRecord } from '../check/types';
import { Icon } from './Icon';
import './ProblemCountIcon.css';

type Summary = Pick<CheckRecord, 'problemCount' | 'problemRisk' | 'highProblemCount'>;

export function problemCountTone(summary: Summary) {
  if (!summary.problemCount) return 'none';
  return summary.problemRisk === 'critical' || (summary.highProblemCount ?? 0) > 3 ? 'critical'
    : summary.problemRisk ?? 'unknown';
}

export function ProblemCountIcon({ summary }: { summary: Summary }) {
  const tone = problemCountTone(summary);
  const icon = tone === 'none' ? Check : tone === 'critical' ? OctagonAlert : tone === 'low' ? Info : TriangleAlert;
  return <Icon icon={icon} shape={icon === TriangleAlert ? 'triangle' : undefined} className={`problem-count-tone is-${tone}`} />;
}
