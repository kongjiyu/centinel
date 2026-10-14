/** Independent scripted fixture baseline; does not call the Centinel rule engine. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch();
const rows: any[] = [];
try {
    for (const variant of ['normal', 'defect']) {
        const start = performance.now(), page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        try {
            await page.goto('http://127.0.0.1:3017/' + variant);
            assert(await page.getByRole('heading', { name: 'Ready', exact: true }).isVisible());
            const named = await page.getByRole('textbox', { name: 'Display name', exact: true }).count(), tabIndex = await page.locator('#name').getAttribute('tabindex'), visited = new Set<string>();
            for (let n = 0; n < 4; n++) {
                await page.keyboard.press('Tab');
                visited.add(await page.evaluate(() => document.activeElement?.id ?? ''));
            }
            const labelled = named === 1, keyboardReached = visited.has('name');
            assert.equal(labelled, variant === 'normal');
            assert.equal(keyboardReached, variant === 'normal');
            assert.equal(tabIndex, variant === 'defect' ? '-1' : null);
            rows.push({ variant, headingVisible: true, configuredNamePresent: labelled, inputReachedByFourTabs: keyboardReached, tabDispatches: 4, elapsedMs: Math.round(performance.now() - start), modelCalls: 0, method: 'Playwright role-name locator plus explicit Tab traversal; no Centinel assessor import' });
        }
        finally {
            await page.close();
        }
    }
    fs.writeFileSync('output/playwright/release-scripted-baseline.json', JSON.stringify({ fixture: 'centinel-usability-v1', rows, limitations: ['Bounded public synthetic fixture only.', 'Script has predeclared selectors and no AI planning; elapsed times are not directly comparable with model execution.', 'No real-user study or complete accessibility baseline.'] }, null, 2));
    console.log(JSON.stringify(rows));
}
finally {
    await browser.close();
}
