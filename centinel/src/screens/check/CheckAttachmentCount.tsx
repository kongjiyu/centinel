import type { CheckRecord } from '../../check/types';

export function CheckAttachmentCount({ check }: { check: CheckRecord }) {
  if (typeof check.problemCount !== 'number') return null;
  const label = check.problemCount + (check.problemCount === 1 ? ' problem' : ' problems');
  const risk = check.problemRisk;
  return <small className={'ck-attachment-count' + (risk ? ' is-' + risk : '')}
    title={risk ? 'Highest risk: ' + risk : undefined}>{label}</small>;
}
