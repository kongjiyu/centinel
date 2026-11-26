import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { CheckRecord } from '../../check/types';
import { useCheckData, type CheckData } from '../../check/useCheckData';
import type { Screen } from '../../types';
import { ProjectCheckCard } from './ProjectCheckCard';

vi.mock('../../check/useCheckData', () => ({ useCheckData: vi.fn() }));

let previousClipboard: PropertyDescriptor | undefined;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  previousClipboard = undefined;
});

function renderOutcome(mode: 'code' | 'both', codeState: 'done' | 'failed' = 'done') {
  const check: CheckRecord = {
    id: 'check-1', projectId: 'project-1', projectName: 'Project', title: 'Saved check', mode,
    phase: 'done', createdAt: '2026-11-26T12:00:00.000Z', updatedAt: '2026-11-26T12:05:00.000Z',
    finishedAt: '2026-11-26T12:05:00.000Z', focus: '', documents: [], notes: [],
  };
  const result = {
    finished: true, codeState, browserState: mode === 'both' ? 'done' : 'not_tested',
    unitTests: null, stuckTests: [], foundInCode: [], proven: [], passedBrowserTests: 0, browserTestCount: 0,
    requirements: null, notChecked: [], codeGaps: [], browserGaps: [], notes: [], verdict: '', verdictDetail: null,
  } as unknown as CheckData['result'];
  vi.mocked(useCheckData).mockReturnValue({
    review: null, findings: [], trace: null, autoTest: null, requirements: [], result,
    live: {} as CheckData['live'], loadError: null, requirementsState: 'ready', evidenceLoaded: true,
  });
  render(<ProjectCheckCard check={check} onNavigate={(_screen: Screen) => undefined} showOutcome />);
}

it.each([
  ['code', 'I finished the Code Review and saved 0 findings.'],
  ['both', 'I finished the Code Review and saved 0 findings. The Browser Check recorded 0 passed tests.'],
] as const)('puts the %s outcome time before Copy and copies the saved summary', async (_mode, summary) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  renderOutcome(_mode);

  const actions = screen.getByRole('group', { name: 'Reply actions' });
  const copy = within(actions).getByRole('button', { name: 'Copy reply' });
  expect(actions.firstElementChild?.tagName).toBe('TIME');
  expect(actions.querySelector('time')!.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith(summary);
});

it('keeps the warning icon on an incomplete Code Review outcome', () => {
  renderOutcome('code', 'failed');
  expect(screen.getByText('I couldn’t finish the Code Review.').closest('.pc-check-outcome')?.querySelector('.ci-triangle')).toBeInTheDocument();
});
