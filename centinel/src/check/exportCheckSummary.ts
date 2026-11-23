import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { checkName } from './checkName';
import type { CheckRecord } from './types';
import type { CheckData } from './useCheckData';

function markdownText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[!#&()*+.<>\[\]_`|~\\-]/g, '\\$&');
}

export function checkSummaryMarkdown(check: CheckRecord, data: CheckData): string {
  const { result, autoTest } = data;
  const requirements = data.requirementsState === 'unavailable' ? 'Unavailable' : result.requirements
    ? `${result.requirements.notMet} of ${result.requirements.total} not met, ${result.requirements.notChecked} not checked`
    : 'No requirements provided';
  const lines = [
    `# ${markdownText(checkName(check))}`,
    '', `Project: ${markdownText(check.projectName)}`, '', markdownText(result.verdict),
    '', `- Proven in the browser: ${result.browserState === 'done' ? result.proven.length : 'Not checked'}`,
    `- Found in code: ${result.codeState === 'done' ? result.foundInCode.length : 'Not checked'}`,
    `- Requirements: ${requirements}`,
  ];
  for (const [heading, problems] of [['Proven in the browser', result.proven], ['Found in code', result.foundInCode]] as const) {
    if (problems.length) lines.push('', `## ${heading}`, '', ...problems.map(problem =>
      `- ${markdownText(problem.title)}${problem.location ? ` · ${markdownText(problem.location)}` : ''}`));
  }
  if (result.requirements?.notMetNames.length) {
    lines.push('', '## Requirements not met', '', ...result.requirements.notMetNames.map(name => `- ${markdownText(name)}`));
  }
  if (autoTest?.tests.length) {
    lines.push('', '## Browser tests', '', ...autoTest.tests.map(test => `- ${markdownText(test.name)}: ${test.state.replaceAll('_', ' ')}`));
  }
  if (result.notChecked.length) lines.push('', '## Not checked', '', ...result.notChecked.map(item => `- ${markdownText(item)}`));
  if (result.notes.length) lines.push('', '## Notes', '', ...result.notes.map(note => `- ${markdownText(note)}`));
  return lines.join('\n') + '\n';
}

export async function exportCheckSummary(check: CheckRecord, data: CheckData): Promise<boolean> {
  const report = checkSummaryMarkdown(check, data);
  const filename = `orin-check-${check.id.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'result'}.md`;
  if (typeof window.__TAURI_IPC__ === 'function') {
    const destination = await save({ title: 'Save check report', defaultPath: filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!destination) return false;
    await writeTextFile(destination, report);
  } else {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
