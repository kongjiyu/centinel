import { tryFileSymlink } from '../fixtures/fileSymlink.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { detectLaunchRecipes } from '../../src/dynamic/autonomous/recipes.js';
import { buildInstallCommand, buildLaunchCommand, launchRepository, LaunchError } from '../../src/dynamic/autonomous/launcher.js';
import { findFreePort, ManagedServerError, startManagedServer, type ManagedServer } from '../../src/dynamic/workspace/managedServer.js';
import { installedPackageManager } from '../../src/dynamic/workspace/packageManager.js';

const temp: string[] = [];
const servers: ManagedServer[] = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-launch-')); temp.push(dir); return dir; };
function project(files: Record<string, string>) {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
const pkg = (value: object) => JSON.stringify(value);
const resolvers = { packageManager: (program: string) => `/usr/local/bin/${program}`, python: () => '/usr/bin/python3' };

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) await server.stop();
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}
function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => http.get(url.replace('localhost', '127.0.0.1'), response => {
    let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(body));
  }).on('error', reject));
}
function pidAlive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

describe('launch recipe detection', () => {
  it('keeps the port configuration of a parallel Vite startup recipe', () => {
    const folder = project({ 'package.json': pkg({ scripts: { dev: 'concurrently yarn:web yarn:api', web: 'vite', api: 'node api.js' }, devDependencies: { vite: '^7' } }), 'yarn.lock': '' });
    const [recipe] = detectLaunchRecipes(folder).recipes;
    expect(recipe).toMatchObject({ framework: 'vite', portStrategy: 'none' });
    expect(buildLaunchCommand(recipe, folder, 5000, resolvers).args).toEqual(['run', 'dev']);
  });

  it('prefers the matching parallel recipe without a watcher', () => {
    const folder = project({ 'package.json': pkg({ scripts: { dev: 'concurrently yarn:web yarn:api:watch',
      start: 'concurrently yarn:web yarn:api', web: 'vite', 'api:watch': 'nodemon api.js', api: 'node api.js' },
      devDependencies: { vite: '^7' } }), 'yarn.lock': '' });
    expect(detectLaunchRecipes(folder).recipes.map(recipe => recipe.id)).toEqual(['node-script:start', 'node-script:dev']);
  });

  it.skipIf(process.platform !== 'win32')('uses the pinned, already cached Yarn Classic executable without resolving a shim', () => {
    const folder = project({ 'package.json': pkg({ packageManager: 'yarn@1.99.98+sha256.abc' }) });
    const cache = tempDir();
    const installation = path.join(cache, 'v1', 'yarn', '1.99.98');
    fs.mkdirSync(path.join(installation, 'bin'), { recursive: true });
    const entry = path.join(installation, 'bin', 'yarn.js');
    fs.writeFileSync(entry, '// Yarn CLI fixture');
    const marker = path.join(installation, '.corepack');
    fs.writeFileSync(marker, pkg({ locator: { name: 'yarn', reference: '1.99.98' }, hash: 'sha256.abc' }));
    vi.stubEnv('COREPACK_HOME', cache);
    vi.stubEnv('CENTINEL_YARN_BIN', '');
    vi.stubEnv('PATH', '');
    expect(installedPackageManager('yarn', folder)).toBe(fs.realpathSync(entry));
    fs.writeFileSync(marker, pkg({ locator: { name: 'yarn', reference: '1.99.98' }, hash: 'sha256.def' }));
    expect(() => installedPackageManager('yarn', folder)).toThrow();
  });
  it('runs a plain "node server.js" start script with Centinel\'s own Node and no install', () => {
    const dir = project({ 'package.json': pkg({ scripts: { start: 'node server.js' } }), 'server.js': 'require("http").createServer().listen(process.env.PORT)' });
    const [recipe] = detectLaunchRecipes(dir).recipes;
    expect(recipe).toMatchObject({ id: 'node-entry:server.js', kind: 'node_entry', needsInstall: false, portStrategy: 'env' });
    expect(buildLaunchCommand(recipe, dir, 5000, resolvers)).toMatchObject({ executable: process.execPath, args: [path.join(dir, 'server.js')] });
  });

  it('detects the bundled Sample Shop as a node entry', () => {
    const shop = path.resolve(__dirname, '../../../examples/sample-shop');
    expect(detectLaunchRecipes(shop).recipes[0]).toMatchObject({ kind: 'node_entry', entry: 'server.js', needsInstall: false });
  });

  it('prefers the dev script, picks the lockfile package manager and passes the port to Vite', () => {
    const dir = project({ 'package.json': pkg({ scripts: { build: 'vite build', dev: 'vite', preview: 'vite preview' }, devDependencies: { vite: '^5' } }), 'pnpm-lock.yaml': '' });
    const detection = detectLaunchRecipes(dir);
    expect(detection.recipes.map(recipe => recipe.id)).toEqual(['node-script:dev', 'node-script:preview']);
    const recipe = detection.recipes[0];
    expect(recipe).toMatchObject({ framework: 'vite', packageManager: 'pnpm', needsInstall: true, portStrategy: 'args' });
    expect(buildLaunchCommand(recipe, dir, 5173, resolvers).args).toEqual(['run', 'dev', '--port', '5173', '--strictPort', '--host', '127.0.0.1']);
    expect(buildInstallCommand(recipe, dir, resolvers)?.args).toEqual(['install', '--frozen-lockfile']);
  });

  it('separates npm script arguments with -- and uses npm ci only with a lockfile', () => {
    const dir = project({ 'package.json': pkg({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }) });
    const [recipe] = detectLaunchRecipes(dir).recipes;
    expect(buildLaunchCommand(recipe, dir, 4000, resolvers).args).toEqual(['run', 'dev', '--', '--port', '4000', '--strictPort', '--host', '127.0.0.1']);
    expect(buildInstallCommand(recipe, dir, resolvers)?.args).toEqual(['install', '--no-audit', '--no-fund', '--no-package-lock']);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(buildInstallCommand(recipe, dir, resolvers)?.args).toEqual(['ci', '--no-audit', '--no-fund']);
  });

  it('recognises Next, CRA and Express and ranks next start below next dev', () => {
    const next = project({ 'package.json': pkg({ scripts: { start: 'next start', dev: 'next dev' }, dependencies: { next: '15' } }), 'yarn.lock': '' });
    expect(detectLaunchRecipes(next).recipes.map(recipe => [recipe.id, recipe.framework, recipe.packageManager])).toEqual([['node-script:dev', 'next', 'yarn'], ['node-script:start', 'next', 'yarn']]);
    const cra = project({ 'package.json': pkg({ scripts: { start: 'react-scripts start' }, dependencies: { 'react-scripts': '5' } }) });
    expect(detectLaunchRecipes(cra).recipes[0]).toMatchObject({ framework: 'cra', portStrategy: 'env' });
    const express = project({ 'package.json': pkg({ dependencies: { express: '4' } }), 'index.js': 'const app=require("express")();app.listen(3000)' });
    expect(detectLaunchRecipes(express).recipes[0]).toMatchObject({ id: 'node-entry:index.js', framework: 'express', needsInstall: true });
  });

  it('detects Django, Flask and FastAPI with fixed interpreter arguments', () => {
    const django = project({ 'manage.py': '#!/usr/bin/env python' });
    const [d] = detectLaunchRecipes(django).recipes;
    expect(buildLaunchCommand(d, django, 8001, resolvers).args).toEqual(['manage.py', 'runserver', '127.0.0.1:8001', '--noreload']);
    const flask = project({ 'app.py': 'from flask import Flask\napp = Flask(__name__)\n' });
    const [f] = detectLaunchRecipes(flask).recipes;
    expect(buildLaunchCommand(f, flask, 8002, resolvers).args).toEqual(['-m', 'flask', '--app', 'app:app', 'run', '--host', '127.0.0.1', '--port', '8002']);
    const fastapi = project({ 'app/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n' });
    const [a] = detectLaunchRecipes(fastapi).recipes;
    expect(buildLaunchCommand(a, fastapi, 8003, resolvers).args).toEqual(['-m', 'uvicorn', 'app.main:api', '--host', '127.0.0.1', '--port', '8003']);
  });

  it('falls back to a static site, and explains monorepos, Docker-only and empty folders', () => {
    expect(detectLaunchRecipes(project({ 'index.html': '<h1>Hi</h1>' })).recipes[0].kind).toBe('static');
    const mono = detectLaunchRecipes(project({ 'package.json': pkg({ workspaces: ['apps/*'] }), 'apps/web/package.json': '{}', 'apps/api/package.json': '{}' }));
    expect(mono.unsupported).toMatchObject({ reason: 'monorepo', candidates: [path.join('apps', 'api'), path.join('apps', 'web')] });
    expect(detectLaunchRecipes(project({ 'docker-compose.yml': 'services: {}' })).unsupported?.reason).toBe('docker_only');
    expect(detectLaunchRecipes(project({ 'notes.txt': 'x' })).unsupported?.reason).toBe('no_entry_point');
    expect(detectLaunchRecipes('/definitely/missing').unsupported?.reason).toBe('not_a_directory');
  });

  it('ignores a symlinked entry outside the folder', ({ skip }) => {
    const outside = project({ 'evil.js': 'require("http").createServer().listen(1)' });
    const dir = project({ 'package.json': pkg({}) });
    if (!tryFileSymlink(path.join(outside, 'evil.js'), path.join(dir, 'server.js'))) skip('File symlinks are unavailable');
    expect(detectLaunchRecipes(dir).recipes).toEqual([]);
  });
});

const SERVER = (body: string) => `const http=require('http');${body}`;

describe('managed app server', () => {
  it('waits for the HTML frontend when the API responds first and retains configured ports', async () => {
    const apiPort = await findFreePort();
    const webPort = await findFreePort();
    const dir = project({ 'server.js': SERVER(`
      if(process.env.PORT)process.exit(9);
      http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end('{}');}).listen(${apiPort},'127.0.0.1',()=>console.log('api http://localhost:${apiPort}'));
      setTimeout(()=>http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end('<h1>Frontend</h1>');}).listen(${webPort},'127.0.0.1',()=>console.log('web http://localhost:${webPort}')),400);
    `) });
    const app = await startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir,
      home: path.join(dir, '.home'), port: await findFreePort(), preservePortConfiguration: true, requireHtml: true });
    servers.push(app);
    expect(app.port).toBe(webPort);
    expect(await get(app.url)).toContain('Frontend');
  });
  it('starts on the assigned port, reports output and stops the whole process group', async () => {
    const dir = project({ 'server.js': SERVER(`http.createServer((q,s)=>s.end('hello')).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('ready at http://localhost:'+process.env.PORT+' secret-token'));`) });
    const port = await findFreePort();
    const server = await startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir, home: path.join(dir, '.home'), port, secrets: ['secret-token'] });
    servers.push(server);
    expect(server).toMatchObject({ url: `http://localhost:${port}`, portHonored: true });
    expect(await get(server.url)).toBe('hello');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(server.logs()).toContain('[REDACTED]');
    expect(server.logs()).not.toContain('secret-token');
    await server.stop();
    expect(await portOpen(port)).toBe(false);
    expect(pidAlive(server.pid)).toBe(false);
  });

  it('finds an app that ignores PORT from the URL it prints', async () => {
    const other = await findFreePort();
    const dir = project({ 'server.js': SERVER(`http.createServer((q,s)=>s.end('x')).listen(${other},'127.0.0.1',()=>console.log('Listening on http://localhost:${other}'));`) });
    const server = await startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir, home: path.join(dir, '.home'), port: await findFreePort() });
    servers.push(server);
    expect(server).toMatchObject({ port: other, portHonored: false });
  });

  it('kills child processes the app spawned', async () => {
    const dir = project({ 'server.js': SERVER(`const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync('child.pid',String(c.pid));http.createServer((q,s)=>s.end()).listen(Number(process.env.PORT),'127.0.0.1');`) });
    const server = await startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir, home: path.join(dir, '.home'), port: await findFreePort() });
    const childPid = Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf8'));
    expect(pidAlive(childPid)).toBe(true);
    await server.stop();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(pidAlive(childPid)).toBe(false);
  });

  it('reports an app that exits during start-up with its log', async () => {
    const dir = project({ 'server.js': `console.error('Missing DATABASE_URL');process.exit(3);` });
    const error = await startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir, home: path.join(dir, '.home'), port: await findFreePort() }).catch(caught => caught);
    expect(error).toBeInstanceOf(ManagedServerError);
    expect(error).toMatchObject({ reason: 'exited' });
    expect(error.logs).toContain('Missing DATABASE_URL');
  });

  it('cancels start-up and leaves nothing running', async () => {
    const dir = project({ 'server.js': `require('fs').writeFileSync('pid',String(process.pid));setInterval(()=>{},1000);` });
    const controller = new AbortController();
    const pending = startManagedServer({ executable: process.execPath, args: [path.join(dir, 'server.js')], cwd: dir, home: path.join(dir, '.home'), port: await findFreePort(), signal: controller.signal });
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(path.join(dir, 'pid')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    expect(pidAlive(Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')))).toBe(false);
  }, 12_000);

  it('refuses reserved environment names', async () => {
    const dir = tempDir();
    await expect(startManagedServer({ executable: process.execPath, args: [], cwd: dir, home: path.join(dir, 'h'), port: 1234, variables: { NODE_OPTIONS: '--inspect' } })).rejects.toMatchObject({ reason: 'launch_failed' });
  });
});

describe('launchRepository', () => {
  it('tries a second detected recipe when the first start command exits', async () => {
    const dir = project({ 'package.json': pkg({ scripts: { dev: 'node failed.js', start: 'node healthy.js' } }),
      'failed.js': 'process.exit(1)', 'healthy.js': SERVER(`http.createServer((q,s)=>s.end('ready')).listen(Number(process.env.PORT),'127.0.0.1');`) });
    const app = await launchRepository({ folder: dir, home: path.join(dir, '.home') });
    servers.push(app.server);
    expect(app.recipe.id).toBe('node-entry:healthy.js');
    expect(await get(app.server.url)).toBe('ready');
  });

  it('shows declared dependencies and declines before running any install process', async () => {
    const dir = project({ 'package.json': pkg({ scripts: { start: 'node server.js' }, dependencies: { 'fixture-one': '1' }, devDependencies: { 'fixture-two': '2' } }), 'server.js': '' });
    const approveInstall = vi.fn(async () => false);
    await expect(launchRepository({ folder: dir, home: path.join(dir, '.home'), resolvers, approveInstall })).rejects.toMatchObject({ reason: 'install_declined' });
    expect(approveInstall).toHaveBeenCalledWith({ command: expect.stringContaining('install'), packages: ['fixture-one', 'fixture-two'], packageCount: 2 });
  });
  it('starts the Sample Shop on a free port without any approval step', async () => {
    const shop = path.resolve(__dirname, '../../../examples/sample-shop');
    const events: string[] = [];
    const app = await launchRepository({ folder: shop, home: path.join(tempDir(), 'home'), onEvent: event => events.push(event.stage) });
    servers.push(app.server);
    expect(app.recipe.kind).toBe('node_entry');
    expect(app.server.portHonored).toBe(true);
    expect(await get(app.server.url)).toContain('<');
    expect(events[0]).toBe('detected');
    expect(events).toContain('ready');
  });

  it('serves a static site and never serves .env files', async () => {
    const dir = project({ 'index.html': '<h1>Static</h1>', '.env': 'SECRET=1' });
    const app = await launchRepository({ folder: dir, home: path.join(dir, '.home') });
    servers.push(app.server);
    expect(await get(app.server.url)).toContain('Static');
    expect(await get(app.server.url + '/.env')).toBe('Not found');
  });

  it('explains unsupported folders', async () => {
    const dir = project({ 'docker-compose.yml': 'services: {}' });
    await expect(launchRepository({ folder: dir, home: path.join(dir, '.home') })).rejects.toBeInstanceOf(LaunchError);
    await expect(launchRepository({ folder: dir, home: path.join(dir, '.home') })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('only accepts recipe ids that were detected', async () => {
    const shop = path.resolve(__dirname, '../../../examples/sample-shop');
    await expect(launchRepository({ folder: shop, home: path.join(tempDir(), 'h'), recipeId: 'node-entry:../../etc/evil.js' })).rejects.toMatchObject({ reason: 'unknown_recipe' });
  });
});
