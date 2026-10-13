import crypto from 'node:crypto';

/** Each sidecar process has a unique worker identity; no token is exposed to UI. */
export const dynamicWorkerId = crypto.randomUUID();
export const DYNAMIC_LEASE_MS = 60_000;
export const DYNAMIC_HEARTBEAT_MS = 15_000;
export const DYNAMIC_QUEUE_GRACE_MS = 90_000;
export const DYNAMIC_LEGACY_GRACE_MS = 6 * 60_000;
