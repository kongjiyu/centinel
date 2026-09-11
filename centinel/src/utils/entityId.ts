/**
 * Keep technical entity identifiers compact in dense tables while retaining
 * the full value in the element title/accessible label. Persisted IDs are
 * still used for every action and navigation; this helper only affects the
 * visual label.
 */
export function formatEntityId(id: string): string {
  const value = id.trim();
  if (!value) return '#unknown';
  return `#${value.length > 12 ? value.slice(0, 8) : value}`;
}

export function entityIdTitle(label: string, id: string): string {
  return `${label} ${id.trim() || 'unknown'}`;
}
