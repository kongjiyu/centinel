/**
 * Vitest setup file — runs once per test file before any test executes.
 *
 * Adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.) and
 * runs cleanup() after each test so mounted React trees don't leak between
 * tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
