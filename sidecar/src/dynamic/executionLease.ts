/** Local deadlines expire before the durable 60-second lease. Late replies never
 * resurrect execution or measure freshness from response arrival. */
export class ExecutionLease {
  private confirmed: number;
  private reason: string | null = null;
  private disposed = false;
  constructor(private readonly started: number, private readonly durationMs: number,
    private readonly stop: (reason: string) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly freshnessMs = 45_000) { this.confirmed = started; }
  fail(reason: string) {
    if (this.disposed || this.reason) return;
    this.reason = reason;
    this.stop(reason);
  }
  canForward() {
    if (this.disposed || this.reason) return false;
    const time = this.now();
    if (time - this.started >= this.durationMs) this.fail('Run reached its local execution deadline. Check cleanup before retrying.');
    else if (time - this.confirmed >= this.freshnessMs) this.fail('Run worker lease confirmation expired. Check cleanup before retrying.');
    return this.reason === null;
  }
  confirm(requestStarted: number, alive: boolean) {
    if (!this.canForward()) return;
    if (!alive) { this.fail('Run worker lease stopped. Check cleanup before retrying.'); return; }
    if (requestStarted > this.now() || this.now() - requestStarted >= this.freshnessMs) {
      this.fail('Run worker lease confirmation arrived too late. Check cleanup before retrying.'); return;
    }
    this.confirmed = Math.max(this.confirmed, requestStarted);
  }
  close() { this.disposed = true; }
}
