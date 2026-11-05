import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { spawn } from 'node:child_process';
import { installSampleShop, sampleShopSource, startSampleShop, stopSampleShop, SAMPLE_SHOP_URL } from '../../src/sampleShop.js';

const temp: string[] = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-sample-')); temp.push(dir); return dir; };
afterEach(() => { stopSampleShop(); for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; killed: boolean; kill: () => boolean };
  child.exitCode = null; child.killed = false; child.kill = () => { child.killed = true; return true; };
  return child;
}

describe('bundled Sample Shop', () => {
  it('uses the bundled resources in packaged builds and the repository copy in development', () => {
    expect(sampleShopSource({ CENTINEL_SAMPLE_SHOP_DIR: '/Applications/Centinel.app/Contents/Resources/resources/sample-shop' }))
      .toBe('/Applications/Centinel.app/Contents/Resources/resources/sample-shop');
    const dev = sampleShopSource({});
    expect(fs.existsSync(path.join(dev, 'server.js'))).toBe(true);
    expect(fs.existsSync(path.join(dev, 'sample-shop-answers.md'))).toBe(false);
  });

  it('copies the shop into CENTINEL_HOME/samples without overwriting edits', () => {
    const home = tempDir();
    const target = installSampleShop(sampleShopSource({}), home);
    expect(target).toBe(path.join(home, 'samples', 'sample-shop'));
    expect(fs.existsSync(path.join(target, 'docs', 'requirements.md'))).toBe(true);
    fs.writeFileSync(path.join(target, 'server.js'), '// edited');
    installSampleShop(sampleShopSource({}), home);
    expect(fs.readFileSync(path.join(target, 'server.js'), 'utf8')).toBe('// edited');
  });

  it('fails clearly when the installation has no Sample Shop', () => {
    expect(() => installSampleShop(tempDir(), tempDir())).toThrow(/not included/);
  });

  it('does not start a second server when port 4100 is taken', async () => {
    const launch = vi.fn();
    const result = await startSampleShop({ home: tempDir(), launch: launch as unknown as typeof spawn, isPortInUse: async () => true });
    expect(result).toMatchObject({ url: SAMPLE_SHOP_URL, server: 'port_in_use' });
    expect(launch).not.toHaveBeenCalled();
  });

  it('starts the shop on loopback port 4100 and reuses the running process', async () => {
    const home = tempDir();
    const child = fakeChild();
    const launch = vi.fn(() => child);
    let listening = false;
    const isPortInUse = async () => { const value = listening; listening = true; return value; };
    const first = await startSampleShop({ home, launch: launch as unknown as typeof spawn, isPortInUse });
    expect(first).toEqual({ path: path.join(home, 'samples', 'sample-shop'), url: 'http://localhost:4100', server: 'started' });
    const [, args, options] = launch.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string> }];
    expect(args).toEqual([path.join(home, 'samples', 'sample-shop', 'server.js')]);
    expect(options.env).toMatchObject({ PORT: '4100', HOST: '127.0.0.1' });
    expect((await startSampleShop({ home, launch: launch as unknown as typeof spawn, isPortInUse })).server).toBe('running');
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
