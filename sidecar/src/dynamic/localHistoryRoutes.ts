import type { LocalDynamicHistory } from './localHistory.js';
import { DynamicContractError } from './types.js';

export function readLocalDynamicHistory(history: LocalDynamicHistory, project: string, segments: string[]) {
  const [resource, id] = segments;
  if (resource === 'missions' && segments.length === 1) return { body: history.listMissions(project) };
  if (resource === 'revisions' && segments.length === 2) {
    const revision = history.revision(project, id);
    if (!revision) throw new DynamicContractError(404, 'Saved test revision is unavailable in this project.');
    return { body: revision };
  }
  return null;
}
