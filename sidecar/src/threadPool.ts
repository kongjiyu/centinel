// Imported first by the sidecar entry, before any asynchronous file, DNS or
// compression work starts libuv's shared thread pool (which reads this value
// once). The default pool has four threads. A file read on a folder that macOS
// privacy protection holds until the user answers a prompt (for example a
// project under ~/Documents after the app was rebuilt or moved) occupies one
// thread for as long as the prompt is open. Four such reads starved Supabase
// response decompression and DNS, stalling a Review for hours with no error.
// A larger pool keeps a few blocked folder reads from stopping everything else.
export const SIDECAR_THREAD_POOL_SIZE = 32;

const configured = Number(process.env.UV_THREADPOOL_SIZE);
if (!Number.isInteger(configured) || configured < 1) process.env.UV_THREADPOOL_SIZE = String(SIDECAR_THREAD_POOL_SIZE);
