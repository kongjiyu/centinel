import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodexBackend } from './codex.js';

/** Known-color image proves screenshot input, rather than accepting a text-only ping. */
export async function testCodexProvider(backend: CodexBackend, model: string, vision = false, signal?: AbortSignal) {
  let dir: string | undefined;
  try {
    let imagePaths: string[] | undefined;
    if (vision) {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-codex-test-'));
      const image = path.join(dir, 'sample.png');
      await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=', 'base64'));
      imagePaths = [image];
    }
    const response = await backend.generate({ model, imagePaths, signal,
      systemPrompt: 'Return exactly one JSON object with an answer string. Do not use tools.',
      prompt: vision ? 'What is the dominant color of the attached image? Reply with a lowercase color name in answer.' : 'Return {"answer":"ready"}.',
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
    });
    let answer: unknown;
    try { answer = JSON.parse(response.text).answer; } catch { /* fail below */ }
    const pass = answer === (vision ? 'red' : 'ready');
    return { status: pass ? 'pass' : 'fail', message: pass
      ? `Codex ${vision ? 'screenshot' : 'text'} test passed.` : 'Codex returned an unexpected test response.', usage: response.usage };
  } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
}
