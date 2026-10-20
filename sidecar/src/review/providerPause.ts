/** Only structured provider metadata establishes a capacity stop. Never infer
 * exhausted credits from free-form messages, source text or a generic 429. */
export type ProviderPauseCode = 'rate_limited' | 'quota_exhausted' | 'credits_exhausted' | 'billing_required';
export const PROVIDER_PAUSE_MESSAGES: Record<ProviderPauseCode, string> = {
  rate_limited: 'Paused: the Model Provider rejected the request because of a rate limit. Remaining account allowance may still be available. Check provider access, then retry manually. No automatic retry will run.',
  quota_exhausted: 'Paused: the Model Provider reported an exhausted usage quota. Restore provider access, then retry manually. No automatic retry will run.',
  credits_exhausted: 'Paused: the Model Provider reported insufficient credits. Restore provider access, then retry manually. No automatic retry will run.',
  billing_required: 'Paused: the Model Provider reported a payment or spending limit. Check provider billing, then retry manually. No automatic retry will run.',
};
const CODES: Record<string, ProviderPauseCode> = {
  rate_limited: 'rate_limited', rate_limit: 'rate_limited', rate_limit_exceeded: 'rate_limited',
  rate_limit_error: 'rate_limited', codex_rate_limited: 'rate_limited', http_429: 'rate_limited',
  too_many_requests: 'rate_limited', slow_down: 'rate_limited', resource_exhausted: 'rate_limited',
  quota_exhausted: 'quota_exhausted', insufficient_quota: 'quota_exhausted', quota_exceeded: 'quota_exhausted',
  usage_limit_exceeded: 'quota_exhausted', usagelimitexceeded: 'quota_exhausted', codex_usage_limit: 'quota_exhausted',
  organization_usage_limit_exceeded: 'quota_exhausted',
  credits_exhausted: 'credits_exhausted', insufficient_credits: 'credits_exhausted', credit_balance_exhausted: 'credits_exhausted',
  billing_required: 'billing_required', http_402: 'billing_required', billing_hard_limit_reached: 'billing_required',
  organization_spend_limit_exceeded: 'billing_required', project_spend_limit_exceeded: 'billing_required',
};
export function providerPause(error: unknown): { code: ProviderPauseCode; message: string } | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  const known = typeof value.code === 'string' && Object.hasOwn(CODES, value.code.toLowerCase()) ? CODES[value.code.toLowerCase()] : undefined;
  const status = value.statusCode ?? value.status;
  const code = known ?? (status === 429 ? 'rate_limited' : status === 402 ? 'billing_required' : undefined);
  return code ? { code, message: PROVIDER_PAUSE_MESSAGES[code] } : null;
}

/** Inspect a bounded response solely for allowlisted error codes. Never retain
 * upstream messages/bodies, which can contain credentials or private inputs. */
export async function responseProviderPause(response: Response) {
  let code: unknown;
  const reader = response.body?.getReader();
  if (reader) {
    // A stalled error body must not postpone a known HTTP capacity stop.
    const deadline = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 1_000);
    deadline.unref?.();
    try {
      let text = '';
      let bytes = 0;
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) { text += decoder.decode(); break; }
        bytes += part.value.byteLength;
        if (bytes > 16_384) break;
        text += decoder.decode(part.value, { stream: true });
      }
      if (bytes <= 16_384) {
        const body = JSON.parse(text);
        const error = body?.error ?? body;
        // A specific code takes precedence over a broader quota/error type.
        code = [error?.code, error?.type, error?.status].find(candidate => typeof candidate === 'string' && Object.hasOwn(CODES, candidate.toLowerCase()));
      }
    } catch { /* Missing/malformed bodies do not hide HTTP capacity failures. */ }
    finally { clearTimeout(deadline); void reader.cancel().catch(() => undefined); }
  }
  return providerPause({ code, statusCode: response.status });
}
