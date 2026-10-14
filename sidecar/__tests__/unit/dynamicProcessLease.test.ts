import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../../src/dynamic/workspace/process.js';
const source = fileURLToPath(new URL('../../src/dynamic/workspace/process.ts', import.meta.url));
describe('cross-project local workspace execution exclusion', () => {
    it('blocks a second process through a directory alias and releases after worker SIGKILL', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-lease-test-')), workspace = path.join(root, 'project'), alias = path.join(root, 'alias'), marker = path.join(root, 'child.pid'), worker = path.join(root, 'worker.mts');
        fs.mkdirSync(workspace);
        fs.symlinkSync(workspace, alias, 'dir');
        fs.writeFileSync(worker, `import {runBoundedProcess} from ${JSON.stringify(source)};await runBoundedProcess({executable:process.execPath,args:['-e',${JSON.stringify("require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)")},${JSON.stringify(marker)}],cwd:${JSON.stringify(workspace)},home:${JSON.stringify(path.join(root, 'first-home'))},timeoutMs:20000});`);
        const parent = spawn(process.execPath, ['--import', 'tsx', worker], { cwd: process.cwd(), env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = '';
        parent.stderr.on('data', x => errors += x);
        let child: number | undefined;
        try {
            const until = Date.now() + 5000;
            while (!fs.existsSync(marker) && Date.now() < until)
                await new Promise(r => setTimeout(r, 20));
            expect(fs.existsSync(marker), errors).toBe(true);
            child = Number(fs.readFileSync(marker, 'utf8'));
            const base = { executable: process.execPath, cwd: alias, home: path.join(root, 'second-home'), timeoutMs: 2000, args: ['-e', 'console.log("recovered")'] };
            const blocked = await runBoundedProcess(base);
            expect(blocked.outcome).toBe('runner_error');
            expect(blocked.output).toContain('Another repository command');
            parent.kill('SIGKILL');
            let dead = false;
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                try {
                    process.kill(child, 0);
                }
                catch {
                    dead = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 25));
            }
            expect(dead).toBe(true);
            let recovered = await runBoundedProcess(base);
            for (let n = 0; n < 30 && recovered.outcome === 'runner_error'; n++) {
                await new Promise(r => setTimeout(r, 25));
                recovered = await runBoundedProcess(base);
            }
            expect(recovered.outcome).toBe('passed');
            expect(recovered.output).toContain('recovered');
        }
        finally {
            parent.kill('SIGKILL');
            if (child)
                try {
                    process.kill(-child, 'SIGKILL');
                }
                catch { }
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 15000);
    it('does not strand a lock on synchronous spawn failure', async () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-lease-invalid-')); try {
        const base = { cwd: root, home: path.join(root, 'home'), timeoutMs: 2000, args: [] };
        expect((await runBoundedProcess({ ...base, executable: '' })).outcome).toBe('runner_error');
        expect((await runBoundedProcess({ ...base, executable: process.execPath, args: ['-e', 'process.exit(0)'] })).outcome).toBe('passed');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    } });
});
