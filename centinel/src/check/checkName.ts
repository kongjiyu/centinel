import type { CheckRecord } from './types';

export function checkName({ title }: Pick<CheckRecord, 'title'>) {
  return title?.trim() || 'Untitled check';
}
