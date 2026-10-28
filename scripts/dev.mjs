import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const services = [
  { name: 'sidecar', workspace: true, port: 37701, pathname: '/health', args: ['--filter', '@centinel/sidecar', 'start'], match: (body) => {
    try { const health = JSON.parse(body); return health.status === 'ok' && (!health.service || (health.service === 'centinel-sidecar' && path.resolve(health.workspace) === root)); } catch { return false; }
  } },
  { name: 'demo', workspace: true, port: 37702, pathname: '/', args: ['--filter', '@centinel/sidecar', 'demo'], match: body => body.includes('<title>Centinel Demo App</title>') },
  { name: 'app', workspace: true, port: 1420, pathname: '/', args: ['--filter', 'centinel', 'tauri', 'dev'], match: body => body.includes('/@vite/client') && /<title>Centinel(?:\s|<)/i.test(body) },
];

async function belongsToWorkspace(port) {
  if (process.platform !== 'win32') return true;
  try {
    // Read-only ownership check: never stop an existing listener, including a
    // healthy Centinel from another checkout. Ports come from the fixed list.
    const command = `$owners = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) { (Get-CimInstance Win32_Process -Filter "ProcessId = $owner").CommandLine }`;
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return stdout.toLowerCase().includes(`${root.toLowerCase()}${path.sep}`);
  } catch { return false; }
}

async function hasWorkspaceDesktopApp() {
  const executable = path.join(root, 'centinel', 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'centinel.exe' : 'centinel');
  if (process.platform === 'win32') {
    try {
      const expected = executable.replace(/'/g, "''");
      const command = `$expected = [System.IO.Path]::GetFullPath('${expected}'); $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'centinel.exe'" -ErrorAction Stop); $matchingProcesses = $processes | Where-Object { $_.ExecutablePath -and [System.String]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $expected, [System.StringComparison]::OrdinalIgnoreCase) }; if ($matchingProcesses) { 'running' } elseif ($processes | Where-Object { -not $_.ExecutablePath }) { 'unknown' } else { 'stopped' }`;
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (stdout.trim() === 'running') return true;
      if (stdout.trim() === 'stopped') return false;
      return null;
    } catch { return null; }
  }
  try {
    const { stdout } = await promisify(execFile)('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 10000 });
    const commandLines = stdout.split(/\r?\n/);
    if (commandLines.some(commandLine => commandLine.includes(executable))) return true;
    if (commandLines.some(commandLine => /centinel/i.test(commandLine) && /target[\\/]debug/i.test(commandLine))) return null;
    return false;
  } catch { return null; }
}

export function resolveAppAction(frontendState, desktopRunning) {
  if (frontendState === 'conflict') return 'conflict';
  if (desktopRunning === null) return 'unknown';
  if (desktopRunning) return frontendState === 'reuse' ? 'reuse' : 'conflict';
  return frontendState === 'reuse' ? 'launch-shell' : 'launch';
}

export function getServiceArgs(service, reuseFrontend = false) {
  if (service.name !== 'app' || !reuseFrontend) return service.args;
  // The Tauri CLI normally starts beforeDevCommand (Vite). If Vite is already
  // running, reuse it and launch only the native shell.
  return [...service.args, '--config', JSON.stringify({ build: { beforeDevCommand: null } })];
}

export async function probeService(service) {
  const occupied = await new Promise(resolve => {
    const socket = net.connect({ host: 'localhost', port: service.port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
  if (!occupied) return 'available';
  try {
    const response = await fetch(`http://localhost:${service.port}${service.pathname}`, { signal: AbortSignal.timeout(2000) });
    return response.ok && service.match(await response.text()) && (!service.workspace || await belongsToWorkspace(service.port)) ? 'reuse' : 'conflict';
  } catch { return 'conflict'; }
}

async function main() {
  const owned = new Set();
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of owned) {
      if (!child.pid || child.exitCode !== null) continue;
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } }
    }
    process.exitCode = code;
  };
  try {
  const states = await Promise.all(services.map(probeService));
  const desktopRunning = await hasWorkspaceDesktopApp();
  const appAction = resolveAppAction(states[2], desktopRunning);
  for (let index = 0; index < services.length; index++) {
    const service = services[index];
    const stateLabel = service.name === 'app'
      ? ({
          'launch-shell': 'reuse (Vite only; desktop shell missing)',
          launch: 'available (desktop shell missing)',
          unknown: `${states[index]} (desktop process state unknown; launch blocked)`,
          conflict: states[index] === 'conflict' ? states[index] : `${states[index]} (Centinel process has no healthy Vite server)`,
          reuse: states[index],
        }[appAction])
      : states[index];
    console.log(`[dev] ${service.name} :${service.port} — ${stateLabel}`);
    if (states[index] === 'conflict') throw new Error(`Port ${service.port} is occupied by an unrecognized or unhealthy service. Inspect it with Get-NetTCPConnection -LocalPort ${service.port}; stop its owning process before retrying.`);
  }
  if (appAction === 'unknown') throw new Error('Could not confirm whether this checkout\'s Centinel desktop process is already running. Refusing to launch a duplicate window; check process-query permissions and retry.');
  if (appAction === 'conflict') throw new Error('A Centinel desktop process is already running but its Vite server is not healthy. Refusing to launch a second window; inspect the existing app before retrying.');
  if (process.argv.includes('--check')) return;
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
  for (let index = 0; index < services.length; index++) {
    const service = services[index];
    if (service.name === 'app') {
      if (appAction === 'reuse') continue;
    } else if (states[index] === 'reuse') continue;
    const reuseFrontend = service.name === 'app' && appAction === 'launch-shell';
    // The pnpm lifecycle supplies its JS entry point: no nested npm or shell.
    const pnpmEntry = process.env.npm_execpath;
    if (!pnpmEntry || !/pnpm/i.test(pnpmEntry)) throw new Error('Launch this command through pnpm dev.');
    const child = spawn(process.execPath, [pnpmEntry, ...getServiceArgs(service, reuseFrontend)], { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' });
    owned.add(child);
    child.once('error', error => { console.error(`[dev] ${service.name}: ${error.message}`); stop(1); });
    child.once('exit', code => { owned.delete(child); if (!stopping) { console.error(`[dev] ${service.name} exited (${code ?? 'signal'}).`); stop(code ?? 1); } });
    if (service.name !== 'app') {
      const deadline = Date.now() + 30000;
      while (!stopping && Date.now() < deadline && await probeService(service) !== 'reuse') await new Promise(resolve => setTimeout(resolve, 250));
      if (stopping) return;
      if (await probeService(service) !== 'reuse') { console.error(`[dev] ${service.name} did not become ready.`); stop(1); return; }
    }
  }
  if (!owned.size) console.log('[dev] Centinel development services are already running. Reusing the existing workspace.');
  } catch (error) {
    stop(1);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[dev] ${error.message}`); process.exitCode = 1; });
}
