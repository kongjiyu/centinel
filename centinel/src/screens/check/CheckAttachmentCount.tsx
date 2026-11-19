import { ProblemCountIcon, problemCountTone } from '../../components/ProblemCountIcon';
import type { CheckRecord } from '../../check/types';

export function CheckAttachmentCount({ check }: { check: CheckRecord }) {
  if (typeof check.problemCount !== 'number') return null;
  const label = check.problemCount + (check.problemCount === 1 ? ' problem' : ' problems');
  return <small className={`ck-attachment-count problem-count-tone is-${problemCountTone(check)}`}>
    <ProblemCountIcon summary={check} />{label}
  </small>;
}
