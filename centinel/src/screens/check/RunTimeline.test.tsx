import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { RunTimeline as Timeline } from '../../autotest/types';
import { RunTimeline, stepSentence } from './RunTimeline';
import { plainReason } from '../../check/plainReason';

vi.mock('../../api/client', () => ({ api: { dynamicRunSteps: vi.fn(), dynamicRunStepScreenshot: vi.fn() } }));
const timeline = (patch: Partial<Timeline>): Timeline => ({ runId: 'r', state: 'completed', verdict: 'failed', reason: null, truncated: false, steps: [], ...patch });

describe('browser test steps', () => {
  it('marks the step where a stuck test stopped, with its reason', async () => {
    vi.mocked(api.dynamicRunSteps).mockResolvedValue(timeline({ state: 'blocked', verdict: 'not_tested', steps: [
      { step: 1, action: 'type', target: 'Email field', page: '/signin', result: 'success', error: null, typedLength: 18, screenshot: true },
      { step: 2, action: 'click', target: 'Add to cart', page: '/', result: 'blocked', error: 'This control was already activated in this Run.', typedLength: null, screenshot: false },
    ] }));
    render(<RunTimeline projectId="p" runId="r" />);
    expect(await screen.findByText('Typed 18 characters into Email field', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Stopped here')).toBeInTheDocument();
    expect(screen.getByText('This control had already been pressed once, and pressing it again could change saved data, so ORIN stopped.')).toBeInTheDocument();
    expect(screen.getByText('Tried to click Add to cart', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('First page')).toBeInTheDocument();
    expect(screen.queryByText('Failed here')).not.toBeInTheDocument();
    expect(screen.getByText('2 steps · stopped at step 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Screenshot before step 1' })).toBeInTheDocument();
  });

  it('ends a test whose steps all ran but whose check failed with a failed check row', async () => {
    vi.mocked(api.dynamicRunSteps).mockResolvedValue(timeline({ steps: [
      { step: 1, action: 'click', target: 'Sign in', page: '/', result: 'success', error: null, typedLength: null, screenshot: false },
      { step: 2, action: 'finish_success', target: null, page: '/', result: 'success', error: null, typedLength: null, screenshot: false },
    ] }));
    render(<RunTimeline projectId="p" runId="r" checkFailed checkSummary="The generic sign-in error is shown." />);
    expect(await screen.findByText('Checked the page: not as expected')).toBeInTheDocument();
    expect(screen.getByText('Expected: The generic sign-in error is shown.')).toBeInTheDocument();
    expect(screen.getByText('Failed here')).toBeInTheDocument();
    expect(screen.getByText('All 2 steps ran · the check failed')).toBeInTheDocument();
    expect(screen.queryByText('Stopped here')).not.toBeInTheDocument();
  });

  it('describes actions in plain words without typed values', () => {
    expect(stepSentence({ step: 1, action: 'type_secret', target: 'Password', page: null, result: 'success', error: null, typedLength: null, screenshot: false })).toBe('Filled a saved secret into Password');
    expect(stepSentence({ step: 1, action: 'navigate', target: null, page: '/orders', result: 'success', error: null, typedLength: null, screenshot: false })).toBe('Opened a page');
  });

  it('reads a stopped step as an attempt with a plain reason', () => {
    expect(stepSentence({ step: 0, action: 'click', target: null, page: '/', result: 'blocked', error: 'x', typedLength: null, screenshot: false }, true)).toBe('Tried to click a control');
    expect(plainReason('The approved interaction target must be unique.')).toBe('ORIN could not tell which control the AI meant, so it did not press it.');
    expect(plainReason('The interaction target is not on the page.')).toMatch(/not on the page at that moment/);
    expect(plainReason('Something new happened.')).toBe('Something new happened.');
  });

  it('opens a step screenshot in place and moves to the checked page', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    vi.mocked(api.dynamicRunSteps).mockResolvedValue(timeline({ finalScreenshot: true, steps: [
      { step: 0, action: 'click', target: 'Sign in', page: '/', result: 'success', error: null, typedLength: null, screenshot: true },
    ] }));
    vi.mocked(api.dynamicRunStepScreenshot).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:shot');
    globalThis.URL.revokeObjectURL = vi.fn();
    render(<RunTimeline projectId="p" runId="r" checkFailed />);
    await user.click(await screen.findByRole('button', { name: 'Screenshot before step 1' }));
    expect(await screen.findByRole('dialog', { name: 'Before step 1 · Clicked Sign in' })).toBeInTheDocument();
    expect(api.dynamicRunStepScreenshot).toHaveBeenLastCalledWith('p', 'r', 0);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next screenshot' }));
    expect(await screen.findByRole('dialog', { name: 'The page when the test was checked' })).toBeInTheDocument();
    expect(api.dynamicRunStepScreenshot).toHaveBeenLastCalledWith('p', 'r', 'final');
  });
});

