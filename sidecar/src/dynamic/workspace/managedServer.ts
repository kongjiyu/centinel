import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { redactOutput } from './redaction.js';

/**
 * Long-running app servers started by autonomous Dynamic testing.
 *
 * Unlike runBoundedProcess there is no fixed deadline: the server lives until the
 * session stops it. The same isolation applies (no shell, private HOME, no inherited
 * credentials, reserved variable names refused) and a detached guardian kills the whole
 * process group if the sidecar disconnects, so a crashed sidecar never leaves an app running.
 */
export type ManagedServer = {
  url: string;
  port: number;
  /** False when the app ignored the assigned port and was found at another one. */
  portHonored: boolean;
  pid: number;
  /** Redacted recent output (bounded ring buffer). */
  logs(): string;
  /** Resolves once the whole process group has stopped. */
  stop(): Promise<void>;
  readonly exited: Promise<{ exitCode: number | null; signal: string | null }>;
};

export type ManagedServerFailure = 'exited' | 'not_ready' | 'cancelled' | 'launch_failed';
export class ManagedServerError extends Error {
  constructor(readonly reason: ManagedServerFailure, message: string, readonly logs = '') { super(message); }
}

const FORBIDDEN_NAME = /^(PATH|HOME|SHELL|NODE_OPTIONS|BASH_ENV|ENV|LD_.*|DYLD_.*|NPM_CONFIG_.*|npm_config_.*|COREPACK_.*|GIT_.*)$/;
const LOG_LIMIT = 64 * 1024;
const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/g;

/** Kills the server's process group when told to, or when its parent disconnects. */
export const SERVER_GUARDIAN = String.raw`
const c=JSON.parse(process.argv[1]);let stopping=false;
const alive=()=>{try{process.kill(-c.groupPid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const stop=()=>{if(stopping)return;stopping=true;try{process.kill(-c.groupPid,'SIGTERM');}catch{}
 const until=performance.now()+3000;const timer=setInterval(()=>{if(!alive()){clearInterval(timer);done();}else if(performance.now()>until){try{process.kill(-c.groupPid,'SIGKILL');}catch{}}},50);};
const done=()=>{if(process.connected)process.send({stopped:true},()=>process.exit(0));else process.exit(0);};
process.on('disconnect',stop);process.on('message',m=>{if(m&&m.stop)stop();});
if(!process.connected)stop();setInterval(()=>{if(!stopping&&!alive())done();},250);
`;

export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error('No free port')));
    });
  });
}

function tcpOpen(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Any HTTP response (even 404) shows the server answers; only connection errors fail. */
function httpAnswers(port: number, host: string, probePath: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = http.request({ host, port, path: probePath, method: 'GET', timeout: 3000, headers: { accept: 'text/html,*/*' } }, response => {
      response.resume();
      resolve(typeof response.statusCode === 'number');
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
    request.end();
  });
}

async function answeringHost(port: number, probePath: string): Promise<string | null> {
  for (const host of ['127.0.0.1', '::1']) {
    if (await tcpOpen(port, host) && await httpAnswers(port, host, probePath)) return host;
  }
  return null;
}

export async function startManagedServer(input: {
  executable: string;
  args: string[];
  cwd: string;
  home: string;
  port: number;
  runtimeBinDirectory?: string;
  variables?: Record<string, string>;
  /** Values that must never appear in logs. */
  secrets?: string[];
  readyTimeoutMs?: number;
  probePath?: string;
  signal?: AbortSignal;
  onOutput?(redactedTail: string): void;
}): Promise<ManagedServer> {
  if (process.platform === 'win32') throw new ManagedServerError('launch_failed', 'Starting apps automatically currently requires macOS or Linux.');
  if (!path.isAbsolute(input.cwd) || !path.isAbsolute(input.home) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new ManagedServerError('launch_failed', 'Managed server configuration required.');
  }
  const variables = input.variables ?? {};
  if (Object.keys(variables).some(name => !/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || FORBIDDEN_NAME.test(name))) {
    throw new ManagedServerError('launch_failed', 'Reserved process environment names are not permitted.');
  }
  if (input.signal?.aborted) throw new ManagedServerError('cancelled', 'Cancelled before the app started.');
  fs.mkdirSync(input.home, { recursive: true, mode: 0o700 });
  const secrets = [...(input.secrets ?? []), ...Object.values(variables)];
  let log = '';
  const logs = () => redactOutput(log, secrets, true);
  let child: ChildProcess;
  try {
    child = spawn(input.executable, input.args, {
      cwd: input.cwd, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: [input.runtimeBinDirectory, process.env.PATH].filter(Boolean).join(path.delimiter),
        HOME: input.home, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? 'en_US.UTF-8',
        CI: '1', BROWSER: 'none', NODE_ENV: 'development', FORCE_COLOR: '0',
        COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', COREPACK_ENABLE_PROJECT_SPEC: '0',
        npm_config_manage_package_manager_versions: 'false', npm_config_update_notifier: 'false',
        PORT: String(input.port), HOST: '127.0.0.1',
        ...variables,
      },
    });
  } catch {
    throw new ManagedServerError('launch_failed', 'The app could not be launched.');
  }
  if (!child.pid) {
    await new Promise(resolve => child.once('error', resolve));
    throw new ManagedServerError('launch_failed', 'The app could not be launched.');
  }
  const groupPid = child.pid;
  const guardian = spawn(process.execPath, ['-e', SERVER_GUARDIAN, JSON.stringify({ groupPid })], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH },
  });
  guardian.unref();
  guardian.on('error', () => undefined);

  const detectedPorts = new Set<number>();
  let lastNotify = 0;
  const collect = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    log = (log + text).slice(-LOG_LIMIT);
    for (const match of text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').matchAll(URL_IN_OUTPUT)) {
      const port = Number(match[1]);
      if (port > 0 && port < 65536) detectedPorts.add(port);
    }
    if (input.onOutput && performance.now() - lastNotify > 150) {
      lastNotify = performance.now();
      try { input.onOutput(logs()); } catch { /* UI listener errors never stop the app */ }
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let exitInfo: { exitCode: number | null; signal: string | null } | null = null;
  const exited = new Promise<{ exitCode: number | null; signal: string | null }>(resolve => {
    child.once('close', (exitCode, signal) => { exitInfo = { exitCode, signal }; resolve(exitInfo); });
    child.once('error', () => { exitInfo = { exitCode: null, signal: null }; resolve(exitInfo); });
  });

  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= (async () => {
      const guardianDone = new Promise<void>(resolve => {
        if (!guardian.connected) return resolve();
        guardian.once('exit', () => resolve());
        guardian.once('message', () => resolve());
        try { guardian.send({ stop: true }); } catch { resolve(); }
      });
      if (!exitInfo) { try { process.kill(-groupPid, 'SIGTERM'); } catch { /* already gone */ } }
      const forced = setTimeout(() => { try { process.kill(-groupPid, 'SIGKILL'); } catch { /* gone */ } }, 3000);
      await Promise.race([Promise.all([exited, guardianDone]), new Promise(resolve => setTimeout(resolve, 5000))]);
      clearTimeout(forced);
      try { process.kill(-groupPid, 'SIGKILL'); } catch { /* gone */ }
      if (guardian.connected) guardian.disconnect();
    })();
    return stopping;
  };

  const abort = () => { void stop(); };
  input.signal?.addEventListener('abort', abort, { once: true });
  const probePath = input.probePath ?? '/';
  const deadline = performance.now() + (input.readyTimeoutMs ?? 120_000);
  try {
    while (performance.now() < deadline) {
      if (input.signal?.aborted) throw new ManagedServerError('cancelled', 'Cancelled while the app was starting.', logs());
      if (exitInfo) {
        const info = exitInfo as { exitCode: number | null };
        throw new ManagedServerError('exited', `The app stopped while starting (exit code ${info.exitCode ?? 'unknown'}).`, logs());
      }
      for (const port of [input.port, ...[...detectedPorts].filter(port => port !== input.port)]) {
        const host = await answeringHost(port, probePath);
        if (host) {
          const server: ManagedServer = {
            url: `http://localhost:${port}`, port, portHonored: port === input.port, pid: groupPid,
            logs, stop, exited,
          };
          return server;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new ManagedServerError('not_ready', 'The app did not answer on any port within the start-up time.', logs());
  } catch (error) {
    input.signal?.removeEventListener('abort', abort);
    await stop();
    throw error;
  }
}
