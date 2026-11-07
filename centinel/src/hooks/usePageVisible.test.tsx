import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPageVisible, setVisibleInterval, setVisibleTimeout, usePageVisible } from './usePageVisible';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('page visibility polling', () => {
  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports the current visibility', () => {
    expect(isPageVisible()).toBe(true);
    visibility = 'hidden';
    expect(isPageVisible()).toBe(false);
  });

  it('skips interval ticks while hidden and refreshes immediately when shown', () => {
    const poll = vi.fn();
    const stop = setVisibleInterval(poll, 1000);
    vi.advanceTimersByTime(2000);
    expect(poll).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(poll).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1000);
    expect(poll).toHaveBeenCalledTimes(4);

    stop();
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(5000);
    expect(poll).toHaveBeenCalledTimes(4);
  });

  it('defers a chained timeout until the page is visible, then runs once', () => {
    const poll = vi.fn();
    setVisibility('hidden');
    setVisibleTimeout(poll, 1500);
    vi.advanceTimersByTime(10_000);
    expect(poll).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('runs a visible timeout on schedule and can be cancelled while waiting', () => {
    const onTime = vi.fn();
    setVisibleTimeout(onTime, 1500);
    vi.advanceTimersByTime(1499);
    expect(onTime).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTime).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    setVisibility('hidden');
    const cancel = setVisibleTimeout(cancelled, 1000);
    vi.advanceTimersByTime(2000);
    cancel();
    setVisibility('visible');
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('usePageVisible follows visibility changes', () => {
    function Probe() {
      return <p>{usePageVisible() ? 'visible' : 'hidden'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('visible')).toBeInTheDocument();
    act(() => setVisibility('hidden'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => setVisibility('visible'));
    expect(screen.getByText('visible')).toBeInTheDocument();
  });
});
