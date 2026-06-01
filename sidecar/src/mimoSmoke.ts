export async function mimoSmokeAsync(): Promise<{ status: string; message?: string; raw?: string }> {
  const apiKey = process.env.MIMO_API_KEY;
  const baseUrl = process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/anthropic/v1/messages';
  const model = process.env.MIMO_MODEL ?? 'mimo-v2.5-pro';

  if (!apiKey) {
    return { status: 'fail', message: 'MIMO_API_KEY is not set' };
  }

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 256,
        system: 'You are a helpful assistant.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Reply with exactly this JSON: {"provider":"mimo","status":"ok"}' },
            ],
          },
        ],
        temperature: 0,
        thinking: { type: 'disabled' },
      }),
    });

    if (!res.ok) {
      return {
        status: 'fail',
        message: `HTTP ${res.status}: ${res.statusText}`,
        raw: await res.text(),
      };
    }

    const json = await res.json();
    const raw = JSON.stringify(json);
    return { status: 'pass', message: 'ok', raw };
  } catch (err) {
    return { status: 'fail', message: String(err) };
  }
}
