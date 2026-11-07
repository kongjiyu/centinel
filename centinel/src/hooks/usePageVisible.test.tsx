import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPageVisible, setVisibleInterval, setVisibleTimeout, usePageVisible, ACTIVITY_WINDOW_MS } from './usePageVisible';

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

  it('treats interaction with a page that reports hidden as visible for a bounded time', () => {
    const poll = vi.fn();
    setVisibility('hidden');
    const stop = setVisibleInterval(poll, 1000);
    vi.advanceTimersByTime(5000);
    expect(poll).not.toHaveBeenCalled();

    // The first interaction refreshes immediately and resumes polling.
    window.dispatchEvent(new Event('pointerdown'));
    expect(poll).toHaveBeenCalledTimes(1);
    expect(isPageVisible()).toBe(true);
    window.dispatchEvent(new Event('wheel'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(poll).toHaveBeenCalledTimes(4);

    // Further interaction extends the window from the latest event.
    vi.advanceTimersByTime(ACTIVITY_WINDOW_MS - 10_000);
    window.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(ACTIVITY_WINDOW_MS - 1000);
    expect(isPageVisible()).toBe(true);

    // With no more interaction, the still-hidden page pauses again.
    vi.advanceTimersByTime(1000);
    expect(isPageVisible()).toBe(false);
    const paused = poll.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(paused);

    // A later interaction or window focus resumes it at once.
    window.dispatchEvent(new Event('focus'));
    expect(poll).toHaveBeenCalledTimes(paused + 1);
    stop();
  });

  it('runs a deferred timeout on the first interaction and updates usePageVisible', () => {
    function Probe() {
      return <p>{usePageVisible() ? 'visible' : 'hidden'}</p>;
    }
    setVisibility('hidden');
    render(<Probe />);
    const poll = vi.fn();
    setVisibleTimeout(poll, 1500);
    vi.advanceTimersByTime(10_000);
    expect(poll).not.toHaveBeenCalled();
    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(screen.getByText('visible')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(ACTIVITY_WINDOW_MS); });
    expect(screen.getByText('hidden')).toBeInTheDocument();
  });
});
