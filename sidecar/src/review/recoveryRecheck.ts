/**
 * Runs the expired-lease recovery for one cached Review runtime. The first
 * check runs when the runtime is created; later Review requests re-check at
 * most once per interval. Without the re-check, a lease that was still live
 * at the first check (the app restarted within the lease window) would never
 * be recovered, leaving its Review "running" until the next launch.
 */
export class ReviewRecoveryRecheck {
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private current: Promise<void> = Promise.resolve();
  private first: Promise<void> | null = null;

  constructor(
    private readonly recover: () => Promise<void>,
    private readonly intervalMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Start a check now and return it (used for the first, awaited check). */
  start(): Promise<void> {
    this.lastStartedAt = this.now();
    this.current = this.recover();
    this.first ??= this.current;
    return this.current;
  }

  /** The startup check: requests wait for it, never for later re-checks. */
  get initial(): Promise<void> { return this.first ?? Promise.resolve(); }

  /** The most recent check, so callers can wait for the first one. */
  get pending(): Promise<void> { return this.current; }

  /** Start a background check when the interval has passed; never throws. */
  maybeRecheck(): void {
    if (this.now() - this.lastStartedAt < this.intervalMs) return;
    void this.start().catch(() => undefined);
  }
}
