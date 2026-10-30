# Embedding reliability — 29 October 2026

User-authorized amendment: temporary embedding rate limits may retry automatically, superseding the earlier blanket rate-limit stop for this path only. Billing, credit and exhausted-quota stops remain immediate.

Acceptance: Voyage admission defaults to 3 RPM / 200,000 TPM. At most four total attempts per batch with increasing 60/120/240 second waits plus bounded jitter, honoring Retry-After up to ten minutes (larger waits stop), with a ten-minute total backoff ceiling across the original bridge request. Every attempt reserves and finalizes its own durable usage record, reacquires admission and rechecks owner/lease/hold before provider access. Cancellation interrupts waits. Exhaustion retains the provider stop. No hidden retries inside the single-call adapter. No automatic retry for unknown network/timeout failures with uncertain consumption.

Vectors are generated at the saved remote embedding endpoint. Similarity ranking stays local against the frozen index. This preserves the existing local-first architecture; remote vector search would require a separate vector database, not just an embedding endpoint.

Related source automation/cache/completion work is tracked separately. No live provider completion follows from fixture tests.

Local runtime configuration had an explicit 10,000 TPM override. Updated only that setting to 200,000; RPM remains 3. The development services were restarted on the final code and health preflight passed; no hold was cleared.

Query/context MCP deadline increases from five to fifteen minutes to accommodate bounded retry waits. Index builds retain their one-hour tool deadline.

## Verification

- Embedding adapter, admission and bridge regression suites: 41 passed, including temporary-limit exhaustion, increasing waits, cancellation, separate attempt records, Retry-After and shared cross-group backoff ceiling.
- The same suites plus real native-index integration passed 45 tests in the final combined run; native-index integration exercised local fixtures, not paid provider calls.
- Sidecar TypeScript passed. Independent Sol review identified caller timeout and per-group-budget conflicts; both fixed and reassessed with no remaining blocking findings.
- No provider call or paused-job resume was initiated. Live completion and actual rate-limit recovery require a separately recorded execution after runtime restart. Shared admission is process-local and cannot enforce another device/application's use of the same provider account; external contention can still exhaust bounded retries.
