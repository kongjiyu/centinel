/** A negative count is invalid; public entry points should reject it. */
function padRows(count: number): string[] {
  const safeCount = Math.max(0, count);
  return Array.from({ length: safeCount }, (_, index) => `row-${index}`);
}

// This is the selected public entry for the fixture.
export function buildDefaultRows(): string[] {
  return padRows(3);
}
