/** Small, dependency-free conversion helpers for Slack mrkdwn. */

export type SlackMessage = {
  user?: string;
  username?: string;
  ts?: string;
  text?: string;
};

function unescapeSlackEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function convertLinks(value: string): string {
  return value.replace(/<([^>\n]+)>/g, (whole, target: string) => {
    // User and channel mentions need a later lookup and should remain
    // recognizable to the caller instead of becoming broken Markdown links.
    if (target.startsWith('@') || target.startsWith('#')) return whole;
    const separator = target.indexOf('|');
    const url = separator >= 0 ? target.slice(0, separator) : target;
    const label = separator >= 0 ? target.slice(separator + 1) : url;
    if (!/^https?:\/\//i.test(url)) return whole;
    return `[${label}](${url})`;
  });
}

function convertInlineFormatting(line: string): string {
  // Slack applies these delimiters per line; keeping the regexes line-local
  // prevents an unmatched delimiter on one line from consuming the next.
  return line
    .replace(/(?<!\*)\*([^\n*]+)\*(?!\*)/g, '**$1**')
    .replace(/(?<!_)_([^\n_]+)_(?!_)/g, '*$1*')
    .replace(/(?<!~)~([^\n~]+)~(?!~)/g, '~~$1~~');
}

export function slackToMarkdown(input: string): string {
  if (!input) return '';
  const decoded = unescapeSlackEntities(input);
  return decoded
    .split('\n')
    .map(line => convertInlineFormatting(convertLinks(line)))
    .join('\n');
}

export function formatSlackTs(value: string): string {
  if (!value) return value;
  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return value;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function slackMessageToMarkdown(
  message: SlackMessage,
  resolveUser: (userId?: string) => string = userId => userId ?? '?',
): string {
  const userId = message.user ?? message.username;
  const author = resolveUser(userId) || 'unknown';
  const timestamp = message.ts ? ` · ${formatSlackTs(message.ts)}` : '';
  const header = `**${author}**${timestamp}`;
  const body = message.text ? slackToMarkdown(message.text) : '';
  return body ? `${header}\n${body}` : header;
}
