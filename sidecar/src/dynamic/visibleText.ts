/**
 * Visible-text matching for checks and assert steps (25 Nov 2026). The page's innerText separates
 * table and grid cells with tabs and blocks with line breaks, so "Ceramic Mug $12.50" is
 * "Ceramic Mug\t$12.50" on the page. Runs of whitespace count as one space on both sides; the
 * characters themselves, their order and their case must still match exactly.
 */
export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function pageShowsText(pageText: string, expected: string): boolean {
  const want = normalizeVisibleText(expected);
  return want.length > 0 && normalizeVisibleText(pageText).includes(want);
}
