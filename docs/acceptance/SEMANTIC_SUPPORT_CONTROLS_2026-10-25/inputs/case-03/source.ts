type RawColumnCount = string | number | undefined;

function normalizeColumnCount(raw: RawColumnCount): number {
  const candidate = Number(raw);
  if (!Number.isFinite(candidate)) return 4;
  return Math.min(10, Math.max(1, Math.trunc(candidate)));
}

function calculateRows(itemCount: number, columns: number): number {
  return Math.ceil(itemCount / columns);
}

export function openBoard(rawCount: RawColumnCount, itemCount: number): number {
  const columns = normalizeColumnCount(rawCount);
  return calculateRows(itemCount, columns);
}
