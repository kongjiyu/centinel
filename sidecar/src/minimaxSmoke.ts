import 'dotenv/config';

const API_KEY = process.env.MINIMAX_API_KEY;
const BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1';
const MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7';

export async function minimaxSmokeAsync(): Promise<{ status: string; message?: string; raw?: string }> {
  if (!API_KEY) {
    return { status: 'fail', message: 'MINIMAX_API_KEY is not set' };
  }

  try {
    const res = await fetch(`${BASE_URL}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly this JSON: {"provider":"minimax","status":"ok"}',
          },
        ],
        temperature: 0,
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
