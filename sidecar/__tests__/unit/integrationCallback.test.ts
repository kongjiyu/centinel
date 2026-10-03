import { describe, expect, it } from 'vitest';
import { renderCallbackPage } from '../../src/integrations.js';

describe('integration OAuth callback page', () => {
  it('offers a desktop return action after a successful connection', () => {
    const html = renderCallbackPage('github', true, 'Connected as Octocat.');
    expect(html).toContain('href="centinel://integrations/connected"');
    expect(html).toContain('Open Centinel');
    expect(html).toContain('window.close()');
    expect(html).not.toContain('setTimeout');
  });

  it('does not offer a success return action or interpret untrusted error text as HTML', () => {
    const html = renderCallbackPage('slack', false, '<script>alert(1)</script>');
    expect(html).not.toContain('href="centinel://integrations/connected"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
