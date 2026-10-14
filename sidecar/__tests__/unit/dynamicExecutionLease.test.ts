import { describe, expect, it, vi } from 'vitest';
import { ExecutionLease } from '../../src/dynamic/executionLease.js';
function fixture(duration = 300_000) {
  let time = 0; const stop = vi.fn();
  const lease = new ExecutionLease(0, duration, stop, () => time);
  return { lease, stop, at(value: number) { time = value; } };
}
describe('Local Run lease boundaries', () => {
  it('stops pending work before the durable lease expires and never revives on late acknowledgment', () => {
    const { lease, stop, at } = fixture(); at(45_000);
    expect(lease.canForward()).toBe(false); lease.confirm(15_000, true);
    expect(lease.canForward()).toBe(false); expect(stop).toHaveBeenCalledTimes(1);
  });
  it('measures freshness from request initiation rather than response arrival', () => {
    const { lease, at } = fixture(); at(40_000); lease.confirm(15_000, true);
    at(59_999); expect(lease.canForward()).toBe(true);
    at(60_000); expect(lease.canForward()).toBe(false);
  });
  it('preserves healthy renewals but never extends the absolute execution deadline', () => {
    const { lease, stop, at } = fixture(100_000);
    for (const time of [15_000, 30_000, 45_000, 60_000, 75_000, 90_000]) { at(time); lease.confirm(time, true); expect(lease.canForward()).toBe(true); }
    at(100_000); expect(lease.canForward()).toBe(false); expect(stop).toHaveBeenCalledWith(expect.stringContaining('deadline'));
  });
  it('fences false replies and ignores callbacks after execution closes', () => {
    const { lease, stop } = fixture(); lease.confirm(0, false);
    expect(lease.canForward()).toBe(false); expect(stop).toHaveBeenCalledTimes(1);
    const ended = fixture(); ended.lease.close(); ended.lease.confirm(0, false);
    expect(ended.lease.canForward()).toBe(false); expect(ended.stop).not.toHaveBeenCalled();
  });
});
