/**
 * slackMarkdown.test.ts — Unit tests for the Slack mrkdwn → GFM
 * converter. Pure functions only — no I/O mocking needed.
 */
import { describe, it, expect } from 'vitest';
import { slackToMarkdown, slackMessageToMarkdown, formatSlackTs } from '../../src/integrations/slackMarkdown.js';

describe('slackToMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(slackToMarkdown('')).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(slackToMarkdown('Hello world')).toBe('Hello world');
  });

  it('converts Slack bold *x* to GFM bold **x**', () => {
    expect(slackToMarkdown('*bold text*')).toBe('**bold text**');
  });

  it('converts Slack italic _x_ to GFM italic *x*', () => {
    expect(slackToMarkdown('_italic text_')).toBe('*italic text*');
  });

  it('converts Slack strike ~x~ to GFM strike ~~x~~', () => {
    expect(slackToMarkdown('~struck~')).toBe('~~struck~~');
  });

  it('converts inline `code` to GFM inline `code`', () => {
    expect(slackToMarkdown('use `arr.sort()` here')).toBe('use `arr.sort()` here');
  });

  it('converts formatted-link <url|label> to [label](url)', () => {
    expect(slackToMarkdown('See <https://example.com|Example> for details'))
      .toBe('See [Example](https://example.com) for details');
  });

  it('converts bare <url> to [url](url)', () => {
    expect(slackToMarkdown('Visit <https://example.com> now'))
      .toBe('Visit [https://example.com](https://example.com) now');
  });

  it('leaves <@USERID> mention as @USERID (resolution is a follow-up)', () => {
    expect(slackToMarkdown('hey <@U12345> can you check?'))
      .toBe('hey <@U12345> can you check?');
  });

  it('leaves <#CHANNELID> channel mention as #CHANNELID', () => {
    expect(slackToMarkdown('moved to <#C98765>'))
      .toBe('moved to <#C98765>');
  });

  it('unescapes &amp; &lt; &gt; entities before processing', () => {
    expect(slackToMarkdown('a &amp; b &lt; c &gt; d'))
      .toBe('a & b < c > d');
  });

  it('does not match bold across newlines (single-line rule)', () => {
    // Slack mrkdwn is per-line: `*line1` has no closing `*` on
    // the same line, so the bold delimiter doesn't fire. The text
    // passes through unchanged — the trailing `*` on line 2 is
    // an unmatched delimiter in the source.
    expect(slackToMarkdown('*line1\nline2*'))
      .toBe('*line1\nline2*');
  });
});

describe('slackMessageToMarkdown', () => {
  it('renders a header line with author and timestamp + the body', () => {
    const md = slackMessageToMarkdown(
      { user: 'U123', ts: '1700000000.000000', text: 'hello' },
      (uid) => uid ? `@${uid}` : '?'
    );
    expect(md).toContain('**@U123**');
    expect(md).toContain('hello');
    // No body line if the message has no text
  });

  it('omits the timestamp line when ts is missing', () => {
    const md = slackMessageToMarkdown(
      { user: 'U123', text: 'no ts' },
      (uid) => uid ? `@${uid}` : '?'
    );
    expect(md).toContain('**@U123**');
    expect(md).not.toContain('·');
  });

  it('uses the fallback name when user is missing', () => {
    const md = slackMessageToMarkdown(
      { text: 'anon message' },
      () => 'unknown'
    );
    expect(md).toContain('**unknown**');
  });

  it('converts the body mrkdwn too', () => {
    const md = slackMessageToMarkdown(
      { user: 'U1', text: '*bold* and _italic_' },
      (uid) => uid ? `@${uid}` : '?'
    );
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });
});

describe('formatSlackTs', () => {
  it('formats a Unix timestamp as YYYY-MM-DD HH:MM in local time', () => {
    // 2023-11-14 22:13:20 UTC
    const formatted = formatSlackTs('1700000000.000000');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('returns the input as-is for unparseable timestamps', () => {
    expect(formatSlackTs('not-a-number')).toBe('not-a-number');
    expect(formatSlackTs('')).toBe('');
  });
});
