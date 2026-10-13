/** Public local runtime origin, shared by JSON and evidence transports. */
export const SIDECAR_BASE_URL = (import.meta.env.VITE_CENTINEL_SIDECAR_URL || 'http://localhost:37701').replace(/\/$/, '');
