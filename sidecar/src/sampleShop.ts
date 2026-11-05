import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centinelHome } from './paths.js';

export const SAMPLE_SHOP_PORT = 4100;
export const SAMPLE_SHOP_URL = `http://localhost:${SAMPLE_SHOP_PORT}`;

export type SampleShopResult = {
  /** Local folder to use as the project's repository. */
  path: string;
  url: string;
  /** started: launched now; running: this service already runs it; port_in_use: something else listens on 4100. */
  server: 'started' | 'running' | 'port_in_use';
};

/**
 * The packaged app ships the Sample Shop in its resources (CENTINEL_SAMPLE_SHOP_DIR).
 * Development uses the repository copy. The answer key is never bundled.
 */
export function sampleShopSource(env: NodeJS.ProcessEnv = process.env): string {
  const bundled = env.CENTINEL_SAMPLE_SHOP_DIR?.trim();
  if (bundled) return path.resolve(bundled);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/sample-shop');
}

/** Copy missing files only, so a user's edits and imported file hashes stay stable. */
export function installSampleShop(source = sampleShopSource(), home = centinelHome()): string {
  if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error('The Sample Shop is not included in this installation.');
  const target = path.join(home, 'samples', 'sample-shop');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: file => !/(^|[\\/])(node_modules|\.git|\.DS_Store)$/.test(file),
  });
  return target;
}

export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = (inUse: boolean) => { socket.destroy(); resolve(inUse); };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

let child: ChildProcess | null = null;

export async function startSampleShop(options: {
  source?: string;
  home?: string;
  launch?: typeof spawn;
  isPortInUse?: (port: number) => Promise<boolean>;
} = {}): Promise<SampleShopResult> {
  const target = installSampleShop(options.source, options.home);
  const result = (server: SampleShopResult['server']): SampleShopResult => ({ path: target, url: SAMPLE_SHOP_URL, server });
  if (child && child.exitCode === null && !child.killed) return result('running');
  if (await (options.isPortInUse ?? portInUse)(SAMPLE_SHOP_PORT)) return result('port_in_use');
  const launch = options.launch ?? spawn;
  // The sidecar's own Node runtime runs the shop; it has no dependencies.
  const started = launch(process.execPath, [path.join(target, 'server.js')], {
    cwd: target,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(SAMPLE_SHOP_PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  child = started;
  started.once('exit', () => { if (child === started) child = null; });
  started.once('error', () => { if (child === started) child = null; });
  // Wait briefly so the URL works when the caller opens it.
  const check = options.isPortInUse ?? portInUse;
  for (let attempt = 0; attempt < 25 && child === started; attempt += 1) {
    if (await check(SAMPLE_SHOP_PORT)) return result('started');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (child !== started) throw new Error('The Sample Shop could not start.');
  return result('started');
}

export function stopSampleShop(): void {
  child?.kill('SIGTERM');
  child = null;
}
