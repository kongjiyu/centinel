/**
 * Prompt contract tests — P0-1.
 *
 * The dashboard sorts and color-codes findings by severity, so an AI that
 * silently drops or relabels the field breaks the triage workflow. These
 * tests pin the contract: a future refactor of CODE_REVIEW_PROMPT or
 * TRACEABILITY_PROMPT that removes severity from the required-field list
 * (or makes it optional / unparseable) should fail this test.
 *
 * The same pattern was used for the T9 reproductionHint contract; this
 * file mirrors that style for severity specifically. (The T9 contract
 * lives in staticReviewPrompts.test.ts on the optimization branch.)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const STATIC_REVIEW_PATH = path.resolve(__dirname, '../../src/staticReview.ts');
const SOURCE = fs.readFileSync(STATIC_REVIEW_PATH, 'utf8');

function extractPromptBlock(label: 'CODE_REVIEW_PROMPT' | 'TRACEABILITY_PROMPT'): string {
  // Match `const LABEL = { system: `...` ... }` non-greedily. Works for the
  // current shape of the file; if the prompt gets re-architected, this
  // test will throw a clear "no match" failure rather than silently
  // passing.
  const re = new RegExp(
    `const ${label} = \\{[^]*?system: \`([^\`]*?)\`,`,
    'm'
  );
  const m = SOURCE.match(re);
  if (!m) throw new Error(`Could not locate ${label} in ${STATIC_REVIEW_PATH}`);
  return m[1];
}

describe('severity prompt contract (P0-1)', () => {
  it('CODE_REVIEW_PROMPT system requires severity on every finding', () => {
    const block = extractPromptBlock('CODE_REVIEW_PROMPT');
    // Must list severity as a field on findings...
    expect(block).toMatch(/- severity:/);
    // ...with the canonical enum values...
    expect(block).toMatch(/"critical"/);
    expect(block).toMatch(/"high"/);
    expect(block).toMatch(/"medium"/);
    expect(block).toMatch(/"low"/);
    // ...and the contract language (REQUIRED + fallback) that mirrors the
    // T9 reproductionHint pattern. If the prompt is softened to a bare
    // bullet, the test fails and the refactor is forced to update it.
    expect(block).toMatch(/severity.*REQUIRED/i);
    expect(block).toMatch(/coerced to "medium"/);
  });

  it('TRACEABILITY_PROMPT system requires severity on every finding', () => {
    const block = extractPromptBlock('TRACEABILITY_PROMPT');
    expect(block).toMatch(/- severity:/);
    expect(block).toMatch(/"critical"/);
    expect(block).toMatch(/"high"/);
    expect(block).toMatch(/"medium"/);
    expect(block).toMatch(/"low"/);
    expect(block).toMatch(/severity.*REQUIRED/i);
    expect(block).toMatch(/coerced to "medium"/);
  });

  it('validateSeverity fallback is "medium" (locks the safe default)', () => {
    // The runtime contract: any unparseable severity (missing key, typo,
    // blank string) normalizes to "medium" so the dashboard never blows
    // up on an unknown value. The risk score weights assume this.
    // Anchor on the function's own signature + a tight body window so the
    // match can't accidentally fall into a string literal (e.g. a prompt
    // block containing the word "medium").
    const m = SOURCE.match(
      /function validateSeverity\([^)]*\)\s*:\s*string\s*\{([^{}]*)\}/
    );
    expect(m, 'validateSeverity function not found').toBeTruthy();
    expect(m![1]).toMatch(/['"]medium['"]/);
  });
});
