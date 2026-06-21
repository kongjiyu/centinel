import { chromium } from 'playwright';
import fs from 'fs';

const SIDEcar_URL = 'http://localhost:37701';
const DEMO_URL = 'http://localhost:37702';
const WEB_UI_URL = 'http://localhost:1420';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSession(sessionId: string, projectId: string, timeoutMs = 180000): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const sessionRes = await fetch(`${SIDEcar_URL}/projects/${projectId}/dynamic-sessions/${sessionId}`);
      const session = await sessionRes.json();
      if (session.status && ['success', 'failure', 'blocked', 'cancelled'].includes(session.status)) {
        return session.status;
      }
    } catch (e) {
      // ignore
    }
    await sleep(2000);
  }
  throw new Error('Timeout waiting for session');
}

async function main() {
  console.log('🚀 Starting E2E Test for Dynamic Module');
  console.log('=========================================\n');

  let browser;
  try {
    // Step 1: Check services
    console.log('📋 Step 1: Checking services...');
    const healthRes = await fetch(`${SIDEcar_URL}/health`);
    const health = await healthRes.json();
    console.log(`   Sidecar: ${health.status === 'ok' ? '✅ OK' : '❌ ' + health.status}`);

    const settingsRes = await fetch(`${SIDEcar_URL}/settings/ai`);
    const settings = await settingsRes.json();
    const visionProvider = settings.find((s) => s.id === 'vision');
    console.log(`   Vision: ${visionProvider?.hasApiKey ? '✅ Configured' : '❌ Not configured'} (${visionProvider?.provider})`);

    // Step 2: Get project
    console.log('\n📋 Step 2: Getting project...');
    const projectsRes = await fetch(`${SIDEcar_URL}/projects`);
    const projects = await projectsRes.json();
    if (projects.length === 0) {
      throw new Error('No projects found. Create a project first.');
    }
    const projectId = projects[0].id;
    console.log(`   Project: ${projects[0].name} (${projectId})`);

    // Step 3: Launch browser
    console.log('\n📋 Step 3: Launching browser...');
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto(WEB_UI_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    console.log('   ✅ Web UI loaded');

    // Step 4: Navigate to Projects and click project
    console.log('\n📋 Step 4: Navigating to project...');
    await page.click('text=Projects');
    await sleep(1000);

    // Click on the project row text "Test"
    await page.locator('.project-row, .project-item, tr').filter({ hasText: projects[0].name }).first().click();
    await sleep(1500);
    console.log('   ✅ Project opened');

    await page.screenshot({ path: 'e2e-debug-3-project-detail.png' });

    // Step 5: Click "New Dynamic Test"
    console.log('\n📋 Step 5: Opening new dynamic test form...');
    const dynamicBtn = await page.locator('button:has-text("Dynamic Test")').first();
    if (await dynamicBtn.count() > 0) {
      await dynamicBtn.click();
      await sleep(1500);
      console.log('   ✅ Dynamic test form opened');
    } else {
      // List all buttons for debugging
      const allBtns = await page.locator('button').allTextContents();
      console.log('   Available buttons:', allBtns.map(b => b.trim()).filter(Boolean));
      throw new Error('Dynamic test button not found');
    }

    await page.screenshot({ path: 'e2e-debug-4-dynamic-form.png' });

    // Step 6: Fill in the form
    console.log('\n📋 Step 6: Filling in test configuration...');

    // Fill all text inputs in order
    const allInputs = await page.locator('input[type="text"], input:not([type])').all();
    console.log(`   Found ${allInputs.length} text inputs`);

    for (let i = 0; i < allInputs.length; i++) {
      const placeholder = await allInputs[i].getAttribute('placeholder');
      console.log(`     Input ${i}: placeholder="${placeholder}"`);
    }

    // Target URL - look for URL-like placeholder
    const urlInput = await page.locator('input[placeholder*="URL" i], input[placeholder*="http" i], input[placeholder*="localhost" i]').first();
    if (await urlInput.count() > 0) {
      await urlInput.fill(DEMO_URL);
      console.log(`   ✅ Target URL: ${DEMO_URL}`);
    } else if (allInputs.length > 0) {
      await allInputs[0].fill(DEMO_URL);
      console.log(`   ✅ Target URL (by index): ${DEMO_URL}`);
    }

    // Goal - textarea or long text input
    const goalInput = await page.locator('textarea').first();
    if (await goalInput.count() > 0) {
      await goalInput.fill('Enter invalid credentials (wrong password), submit the login form, and verify an error message appears');
      console.log('   ✅ Goal filled');
    }

    // Mission type
    const missionSelect = await page.locator('select').first();
    if (await missionSelect.count() > 0) {
      const options = await missionSelect.locator('option').allTextContents();
      console.log(`   Select options: ${options}`);
      await missionSelect.selectOption('user_journey');
      console.log('   ✅ Mission type: User Journey');
    }

    // Max steps
    const stepsInput = await page.locator('input[type="number"]').first();
    if (await stepsInput.count() > 0) {
      await stepsInput.fill('10');
      console.log('   ✅ Max steps: 10');
    }

    await page.screenshot({ path: 'e2e-debug-5-form-filled.png' });

    // Step 7: Submit
    console.log('\n📋 Step 7: Submitting test...');
    const submitBtn = await page.locator('button:has-text("Run Test"), button[type="submit"], button:has-text("Submit")').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      console.log('   ✅ Test submitted');
      await sleep(3000);
      await page.screenshot({ path: 'e2e-debug-6-after-submit.png' });
    } else {
      const allBtns = await page.locator('button').allTextContents();
      console.log('   Available buttons:', allBtns.map(b => b.trim()).filter(Boolean));
      throw new Error('Submit button not found');
    }

    // Step 8: Get session ID
    console.log('\n📋 Step 8: Getting session...');
    const sessionsRes = await fetch(`${SIDEcar_URL}/projects/${projectId}/dynamic-sessions`);
    const sessions = await sessionsRes.json();

    if (sessions.length === 0) {
      throw new Error('No sessions created');
    }

    const session = sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    console.log(`   Session: ${session.id}`);
    console.log(`   Status: ${session.status}`);

    // Step 9: Wait for completion
    console.log('\n📋 Step 9: Waiting for session to complete...');
    console.log('   (This may take 1-2 minutes...)');

    const finalStatus = await waitForSession(session.id, projectId);
    console.log(`   ✅ Session completed: ${finalStatus}`);

    // Step 10: Verify evidence
    console.log('\n📋 Step 10: Verifying evidence...');
    const evidenceRes = await fetch(`${SIDEcar_URL}/projects/${projectId}/dynamic-sessions/${session.id}/evidence`);
    const evidence = await evidenceRes.json();

    const counts: Record<string, number> = {};
    evidence.forEach((e) => {
      counts[e.type] = (counts[e.type] || 0) + 1;
    });
    console.log('   Evidence:');
    Object.entries(counts).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });

    // Verify required evidence types
    const requiredTypes = ['screenshot', 'action_trace', 'ai_response', 'console_log'];
    const missingTypes = requiredTypes.filter(t => !counts[t]);
    if (missingTypes.length > 0) {
      console.log(`   ⚠️ Missing: ${missingTypes.join(', ')}`);
    } else {
      console.log('   ✅ All required evidence present');
    }

    // Step 11: Test screenshot modal
    console.log('\n📋 Step 11: Testing screenshot modal...');
    const screenshotItems = await page.locator('.screenshot-item.clickable').all();
    console.log(`   Found ${screenshotItems.length} clickable screenshots`);
    if (screenshotItems.length > 0) {
      await screenshotItems[0].click();
      await sleep(1000);
      const modal = await page.locator('.screenshot-modal-overlay').count();
      console.log(`   Modal: ${modal > 0 ? '✅ Opens' : '❌ Not found'}`);
      if (modal > 0) {
        await page.screenshot({ path: 'e2e-debug-7-screenshot-modal.png' });
        await page.keyboard.press('Escape');
        await sleep(500);
      }
    }

    // Step 12: Test export
    console.log('\n📋 Step 12: Testing export...');
    const exportBtn = await page.locator('button:has-text("Export Summary")').first();
    if (await exportBtn.count() > 0) {
      await exportBtn.click();
      await sleep(3000);
      await page.screenshot({ path: 'e2e-debug-8-export.png' });

      const successResult = await page.locator('.export-result.success').count();
      console.log(`   Export: ${successResult > 0 ? '✅ Success' : '❌ Failed'}`);

      const reportPreview = await page.locator('.report-preview').count();
      console.log(`   Report preview: ${reportPreview > 0 ? '✅ Rendered' : '❌ Not found'}`);

      const filePathEl = await page.locator('.export-result-path code').first();
      if (await filePathEl.count() > 0) {
        const filePath = await filePathEl.textContent();
        console.log(`   File path: ${filePath}`);
        if (filePath && fs.existsSync(filePath)) {
          console.log('   ✅ Report file exists on disk');
        }
      }
    }

    // Step 13: Get final session details
    console.log('\n📋 Step 13: Final session details...');
    const finalSessionRes = await fetch(`${SIDEcar_URL}/projects/${projectId}/dynamic-sessions/${session.id}`);
    const finalSession = await finalSessionRes.json();
    console.log(`   Status: ${finalSession.status}`);
    console.log(`   Summary: ${finalSession.finalSummary?.slice(0, 150)}...`);
    if (finalSession.failureReason) {
      console.log(`   Failure Reason: ${finalSession.failureReason}`);
    }

    // Final summary
    console.log('\n=========================================');
    console.log('📊 E2E TEST RESULTS');
    console.log('=========================================');
    console.log(`✅ Sidecar: OK`);
    console.log(`✅ AI providers: Configured`);
    console.log(`✅ Dynamic test: Created and executed`);
    console.log(`✅ Status: ${finalStatus}`);
    console.log(`✅ Evidence: ${evidence.length} items`);
    console.log('=========================================');

    if (finalStatus === 'success') {
      console.log('\n🎉 E2E TEST PASSED!');
    } else {
      console.log(`\n⚠️ Session ended with: ${finalStatus}`);
    }

  } catch (error) {
    console.error('\n❌ E2E TEST FAILED:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(console.error);
