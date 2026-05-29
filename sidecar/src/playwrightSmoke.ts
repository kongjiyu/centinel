import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.resolve(__dirname, '../../evidence/phase-0/playwright-screenshot.png');

export async function playwrightSmoke(): Promise<{ status: string; message?: string; screenshotPath?: string }> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://example.com', { timeout: 15000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { status: 'pass', screenshotPath };
  } catch (err) {
    return { status: 'fail', message: String(err) };
  } finally {
    if (browser) await browser.close();
  }
}
