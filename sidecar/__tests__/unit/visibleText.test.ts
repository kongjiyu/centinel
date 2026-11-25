import { describe, expect, it } from 'vitest';
import { pageShowsText } from '../../src/dynamic/visibleText.js';

describe('visible text matching', () => {
  it('treats tabs, line breaks and repeated spaces as one space', () => {
    expect(pageShowsText('Ceramic Mug\t$12.50\tAdd to cart\nDot Grid', 'Ceramic Mug $12.50')).toBe(true);
    expect(pageShowsText('Email or password\n is incorrect.', 'Email or password is incorrect.')).toBe(true);
  });
  it('still needs the same characters in the same order and case', () => {
    expect(pageShowsText('Ceramic Mug\t$12.50', 'Ceramic Mug$12.50')).toBe(false);
    expect(pageShowsText('No account uses this email.', 'Email or password is incorrect.')).toBe(false);
    expect(pageShowsText('SIGN IN', 'Sign in')).toBe(false);
    expect(pageShowsText('anything', '   ')).toBe(false);
  });
});
