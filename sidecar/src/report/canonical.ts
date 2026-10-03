/** Canonical JSON keeps checksums stable regardless of object insertion order. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map(key => [key, sortValue(record[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
