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

// Radix Select uses pointer capture to keep the trigger interaction stable.
// jsdom does not implement the Pointer Events capture methods, so provide the
// no-op browser surface that the real component expects during unit tests.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

afterEach(() => {
  cleanup();
});
