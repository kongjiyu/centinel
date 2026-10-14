import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DynamicService } from '../../src/dynamic/service.js';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
import { verifyAndRetain } from '../../src/dynamic/runnerBridge.js';
import { validateUsabilityResult } from '../../src/dynamic/usability/resultValidation.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => browser.close());
const input = { name: 'Usability', goal: 'Observe Ready', targetUrl: 'http://localhost:3000/', maxSteps: 3, context: null, contextAcknowledged: false, checks: [{ id: 'ready', criterionId: 'one', description: 'Ready', kind: 'visible_text' as const, expected: 'Ready', required: true }], usability: { schemaVersion: 1 as const, persona: 'first_time' as const, rules: ['labels', 'keyboard', 'focus'] as ('labels' | 'keyboard' | 'focus')[], feedbackCheckIds: [], errorRecoveryCheckIds: [] } };
describe('Retained independent usability result integration', () => {
    it('retains a rule failure with hash-matched proof independently from functional success', async () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-usability-')); const page = await browser.newPage(); try {
        await page.setContent('<h1>Ready</h1><input tabindex="-1"><button>Continue</button>');
        const service = new DynamicService(new InMemoryDynamicRepository());
        const rev = await service.saveMission('project', 'actor', input);
        const { run } = await service.start('project', 'actor', rev.id, 'one');
        await service.claim('project', run.id);
        const result = await verifyAndRetain(service, run, page, root);
        expect(result.state).toBe('completed');
        expect(result.verdict).toBe('passed');
        expect(result.usability!.observations.some(row => row.verdict === 'failed')).toBe(true);
        const proof = result.evidence.find(ref => ref.kind === 'usability')!;
        const bytes = fs.readFileSync(path.join(root, 'usability.json'));
        expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(proof.sha256);
        expect(JSON.parse(bytes.toString())).toEqual(result.usability);
        const assessment = result.usability!;
        for (const bad of [{ ...assessment, config: { ...assessment.config, persona: 'returning' } }, { ...assessment, observations: [] }, { ...assessment, observations: assessment.observations.map(row => ({ ...row, evidenceIds: ['invented'] })) }, { ...assessment, keyboardActions: 43 }, { ...assessment, actorId: 'spoofed' }])
            expect(() => validateUsabilityResult(bad, rev, result.evidence)).toThrow();
        expect((await service.requireRun('project', run.id)).usability).toEqual(assessment);
    }
    finally {
        await page.close();
        fs.rmSync(root, { recursive: true, force: true });
    } });
    it('does not commit terminal results if the worker is fenced before assessment', async () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-usability-')); const page = await browser.newPage(); try {
        await page.setContent('<h1>Ready</h1><button>Continue</button>');
        const service = new DynamicService(new InMemoryDynamicRepository());
        const rev = await service.saveMission('project', 'actor', input);
        const { run } = await service.start('project', 'actor', rev.id, 'fenced');
        await service.claim('project', run.id);
        await expect(verifyAndRetain(service, run, page, root, undefined, {}, () => false)).rejects.toThrow('stopped');
        const retained = await service.requireRun('project', run.id);
        expect(retained.state).toBe('running');
        expect(retained.usability).toBeUndefined();
        expect(retained.verdict).toBe('not_tested');
    }
    finally {
        await page.close();
        fs.rmSync(root, { recursive: true, force: true });
    } });
    it('requires configured assessment proof before completing and records empty surfaces as not tested', async () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-usability-')); const page = await browser.newPage(); try {
        await page.setContent('<h1>Ready</h1>');
        const service = new DynamicService(new InMemoryDynamicRepository());
        const rev = await service.saveMission('project', 'actor', input);
        const { run } = await service.start('project', 'actor', rev.id, 'empty');
        await service.claim('project', run.id);
        await expect(service.finish('project', run.id, [], [])).rejects.toThrow('Selected usability');
        const result = await verifyAndRetain(service, run, page, root);
        expect(result.usability!.observations.map(row => row.verdict)).toEqual(['not_tested', 'not_tested', 'not_tested']);
    }
    finally {
        await page.close();
        fs.rmSync(root, { recursive: true, force: true });
    } });
});
