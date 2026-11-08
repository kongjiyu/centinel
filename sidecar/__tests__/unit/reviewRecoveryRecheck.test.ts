import { describe, expect, it, vi } from 'vitest';
import { ReviewRecoveryRecheck } from '../../src/review/recoveryRecheck.js';

describe('Review lease recovery re-check', () => {
  it('re-checks after the interval so a lease still live at startup is recovered later', async () => {
    let now = 0;
    const recover = vi.fn(async () => undefined);
    const recheck = new ReviewRecoveryRecheck(recover, 60_000, () => now);

    await recheck.start();
    expect(recover).toHaveBeenCalledTimes(1);

    now = 30_000;
    recheck.maybeRecheck();
    expect(recover).toHaveBeenCalledTimes(1);

    now = 60_000;
    recheck.maybeRecheck();
    expect(recover).toHaveBeenCalledTimes(2);
    await recheck.pending;

    now = 90_000;
    recheck.maybeRecheck();
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed background check from rejecting the request', async () => {
    let now = 0;
    const recover = vi.fn(async () => { if (now > 0) throw new Error('offline'); });
    const recheck = new ReviewRecoveryRecheck(recover, 60_000, () => now);
    await recheck.start();
    now = 120_000;
    expect(() => recheck.maybeRecheck()).not.toThrow();
    await expect(recheck.pending).rejects.toThrow('offline');
    now = 200_000;
    recheck.maybeRecheck();
    expect(recover).toHaveBeenCalledTimes(3);
  });
});
