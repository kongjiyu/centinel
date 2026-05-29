import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.resolve(__dirname, '../../evidence/phase-0/playwright-screenshot.png');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export async function geminiSmoke(): Promise<{ status: string; message?: string; raw?: string }> {
  if (!API_KEY) {
    return { status: 'fail', message: 'GEMINI_API_KEY is not set' };
  }

  let ai: GoogleGenAI;
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  } catch (err) {
    return { status: 'fail', message: String(err) };
  }

  try {
    const imageBytes = await fs.promises.readFile(screenshotPath);
    const base64 = Buffer.from(imageBytes).toString('base64');

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          text: 'Describe this screenshot in one short sentence and return JSON: {"provider":"gemini","status":"ok","description":"..."}',
        },
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64,
          },
        },
      ],
    });

    const raw = response.text ?? '';
    return { status: 'pass', message: 'ok', raw };
  } catch (err) {
    return { status: 'fail', message: String(err) };
  }
}
