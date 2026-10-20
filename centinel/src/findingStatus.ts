import type { Finding } from './types';

/**
 * Effective status used for project presentation and risk filtering. A durable
 * saved decision always wins; this only presents server-validated re-review
 * evidence as resolved and never writes the derived value back to storage.
 */
export function effectiveFindingStatus(finding: Pick<Finding, 'status' | 'resolutionEvidence'>): Finding['status'] {
  if ((finding.status === 'new' || finding.status === 'carryover')
    && finding.resolutionEvidence?.basis === 'not_reproduced_in_comparable_review') {
    return 'fixed';
  }
  return finding.status;
}
