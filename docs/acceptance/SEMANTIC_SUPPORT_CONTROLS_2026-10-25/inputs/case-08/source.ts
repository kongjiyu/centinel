export type OptionalScheduler = {
  schedule?: (job: () => void) => void;
};

export function queueRefresh(scheduler: OptionalScheduler, refresh: () => void): void {
  if (typeof scheduler.schedule !== "function") return;
  scheduler.schedule(refresh);
}
