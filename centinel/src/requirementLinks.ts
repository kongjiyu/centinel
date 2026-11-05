import type { RequirementMapping } from './types';

/**
 * Centinel-suggested requirement links are stored as unconfirmed mappings.
 * Only confirmed (human-entered or human-confirmed) mappings count for
 * traceability; rejected suggestions are kept so they are not proposed again.
 */
export const SUGGESTED_MAPPING_STATUS = 'suggested';
export const REJECTED_SUGGESTION_STATUS = 'suggestion_rejected';

const status = (mapping: Pick<RequirementMapping, 'coverageStatus'>) => (mapping.coverageStatus ?? '').trim().toLowerCase();
export const isSuggestedMapping = (mapping: Pick<RequirementMapping, 'coverageStatus'>) => status(mapping) === SUGGESTED_MAPPING_STATUS;
export const isConfirmedMapping = (mapping: Pick<RequirementMapping, 'coverageStatus'>) =>
  status(mapping) !== SUGGESTED_MAPPING_STATUS && status(mapping) !== REJECTED_SUGGESTION_STATUS;

export function confirmedMappingsByRequirement(mappings: Record<string, RequirementMapping[]>): Record<string, RequirementMapping[]> {
  return Object.fromEntries(Object.entries(mappings).map(([id, items]) => [id, items.filter(isConfirmedMapping)]));
}

export function suggestedLinkCount(mappings: Record<string, RequirementMapping[]>): number {
  return Object.values(mappings).reduce((sum, items) => sum + items.filter(isSuggestedMapping).length, 0);
}
