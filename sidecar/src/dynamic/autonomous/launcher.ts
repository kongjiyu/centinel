import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { installedPackageManager } from '../workspace/packageManager.js';
import { runBoundedProcess, type ProcessResult } from '../workspace/process.js';
import { findFreePort, ManagedServerError, startManagedServer, type ManagedServer } from '../workspace/managedServer.js';
import { detectLaunchRecipes, type LaunchRecipe, type NodePackageManager, type RecipeDetection } from './recipes.js';
import { startStaticServer } from './staticServer.js';

export type LaunchCommand = { executable: string; args: string[]; runtimeBinDirectory?: string };

export type LaunchEvent =
  | { stage: 'detected'; detection: RecipeDetection; recipe: LaunchRecipe }
  | { stage: 'installing'; command: string; log?: string }
  | { stage: 'starting'; command: string; port: number; log?: string }
  | { stage: 'ready'; url: string; portHonored: boolean };

export type LaunchFailureReason = 'unsupported' | 'unknown_recipe' | 'tool_missing' | 'install_failed' | ManagedServerError['reason'];
export class LaunchError extends Error {
  constructor(readonly reason: LaunchFailureReason, message: string, readonly logs = '', readonly detection?: RecipeDetection) { super(message); }
}

export type LaunchedApp = { recipe: LaunchRecipe; detection: RecipeDetection; server: ManagedServer; install?: ProcessResult };

type Resolvers = {
  packageManager(program: NodePackageManager): string;
  python(folder: string): string | null;
};

/** Prefer the project's virtual environment, then the system interpreter. */
export function pythonInterpreter(folder: string): string | null {
  for (const candidate of ['.venv/bin/python', 'venv/bin/python', 'env/bin/python']) {
    const file = path.join(folder, candidate);
    if (fs.existsSync(file)) return file;
  }
  try {
    const found = execFileSync('/usr/bin/which', ['python3'], { timeout: 2000, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return found && path.isAbsolute(found) ? found : null;
  } catch {
    return null;
  }
}

const defaultResolvers: Resolvers = { packageManager: installedPackageManager, python: pythonInterpreter };

/** The fixed argv for a recipe. Nothing here comes from a model. */
export function buildLaunchCommand(recipe: LaunchRecipe, folder: string, port: number, resolvers: Resolvers = defaultResolvers): LaunchCommand {
  const portText = String(port);
  switch (recipe.kind) {
    case 'node_entry': {
      if (!recipe.entry) throw new LaunchError('unknown_recipe', 'Recipe has no entry file.');
      return { executable: process.execPath, args: [path.join(folder, recipe.entry)], runtimeBinDirectory: path.dirname(process.execPath) };
    }
    case 'node_script': {
      if (!recipe.script || !recipe.packageManager) throw new LaunchError('unknown_recipe', 'Recipe has no script.');
      const executable = resolvers.packageManager(recipe.packageManager);
      const extra = recipe.portStrategy === 'args' ? ['--port', portText, '--strictPort', '--host', '127.0.0.1'] : [];
      // npm needs "--" before script arguments; pnpm and yarn pass them through.
      const args = recipe.packageManager === 'npm'
        ? ['run', recipe.script, ...(extra.length ? ['--', ...extra] : [])]
        : ['run', recipe.script, ...extra];
      return { executable, args, runtimeBinDirectory: path.dirname(process.execPath) };
    }
    case 'python_django':
    case 'python_flask':
    case 'python_fastapi': {
      const python = resolvers.python(folder);
      if (!python) throw new LaunchError('tool_missing', 'Python is not installed, so this app cannot be started automatically.');
      if (recipe.kind === 'python_django') return { executable: python, args: ['manage.py', 'runserver', `127.0.0.1:${portText}`, '--noreload'] };
      if (recipe.kind === 'python_flask') return { executable: python, args: ['-m', 'flask', '--app', recipe.appTarget!, 'run', '--host', '127.0.0.1', '--port', portText] };
      return { executable: python, args: ['-m', 'uvicorn', recipe.appTarget!, '--host', '127.0.0.1', '--port', portText] };
    }
    case 'static':
      throw new LaunchError('unknown_recipe', 'Static sites use the built-in server.');
  }
}

/** Dependency install for Node recipes, using the lockfile's package manager. */
export function buildInstallCommand(recipe: LaunchRecipe, folder: string, resolvers: Resolvers = defaultResolvers): LaunchCommand | null {
  if (!recipe.needsInstall) return null;
  const manager: NodePackageManager = recipe.packageManager
    ?? (fs.existsSync(path.join(folder, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(folder, 'yarn.lock')) ? 'yarn' : 'npm');
  const executable = resolvers.packageManager(manager);
  const locked = manager === 'npm' ? fs.existsSync(path.join(folder, 'package-lock.json')) : true;
  const args = manager === 'npm'
    ? (locked ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund', '--no-package-lock'])
    : manager === 'pnpm' ? ['install', '--frozen-lockfile'] : ['install', '--frozen-lockfile'];
  return { executable, args, runtimeBinDirectory: path.dirname(process.execPath) };
}

const describe = (command: LaunchCommand) => [path.basename(command.executable), ...command.args.map(arg => path.isAbsolute(arg) ? path.basename(arg) : arg)].join(' ');

/**
 * Detect, install (if needed) and start the app in `folder`, returning once it answers HTTP.
 * Fully automatic by the user's choice (12 Nov 2026), within the fixed recipe table.
 */
export async function launchRepository(input: {
  folder: string;
  /** Private writable home for the app process and package caches. */
  home: string;
  recipeId?: string;
  port?: number;
  variables?: Record<string, string>;
  signal?: AbortSignal;
  installTimeoutMs?: number;
  readyTimeoutMs?: number;
  onEvent?(event: LaunchEvent): void;
  resolvers?: Resolvers;
}): Promise<LaunchedApp> {
  const resolvers = input.resolvers ?? defaultResolvers;
  const detection = detectLaunchRecipes(input.folder);
  if (!detection.recipes.length) throw new LaunchError('unsupported', detection.unsupported?.message ?? 'No start command found.', '', detection);
  const recipe = input.recipeId ? detection.recipes.find(candidate => candidate.id === input.recipeId) : detection.recipes[0];
  if (!recipe) throw new LaunchError('unknown_recipe', 'The selected start command is not available in this folder.', '', detection);
  input.onEvent?.({ stage: 'detected', detection, recipe });
  const folder = detection.folder;
  const port = input.port ?? await findFreePort();

  if (recipe.kind === 'static') {
    const server = await startStaticServer(folder, port);
    input.onEvent?.({ stage: 'ready', url: server.url, portHonored: true });
    return { recipe, detection, server };
  }

  let install: ProcessResult | undefined;
  let installCommand: LaunchCommand | null;
  let command: LaunchCommand;
  try {
    installCommand = buildInstallCommand(recipe, folder, resolvers);
    command = buildLaunchCommand(recipe, folder, port, resolvers);
  } catch (error) {
    if (error instanceof LaunchError) throw error;
    throw new LaunchError('tool_missing', error instanceof Error ? error.message : 'A required tool is missing.', '', detection);
  }
  if (installCommand) {
    const label = describe(installCommand);
    input.onEvent?.({ stage: 'installing', command: label });
    install = await runBoundedProcess({
      ...installCommand, cwd: folder, home: input.home, allowNetwork: true,
      timeoutMs: input.installTimeoutMs ?? 300_000, maxOutputBytes: 1_000_000, signal: input.signal,
      onOutput: log => input.onEvent?.({ stage: 'installing', command: label, log: log.slice(-4000) }),
    });
    if (install.outcome === 'cancelled') throw new LaunchError('cancelled', 'Cancelled while installing dependencies.', install.output);
    if (install.outcome !== 'passed') throw new LaunchError('install_failed', `Installing dependencies failed (${install.outcome}).`, install.output.slice(-8000), detection);
  }
  const label = describe(command);
  input.onEvent?.({ stage: 'starting', command: label, port });
  try {
    const server = await startManagedServer({
      ...command, cwd: folder, home: input.home, port, variables: input.variables,
      readyTimeoutMs: input.readyTimeoutMs, signal: input.signal,
      onOutput: log => input.onEvent?.({ stage: 'starting', command: label, port, log: log.slice(-4000) }),
    });
    input.onEvent?.({ stage: 'ready', url: server.url, portHonored: server.portHonored });
    return { recipe, detection, server, install };
  } catch (error) {
    if (error instanceof ManagedServerError) throw new LaunchError(error.reason, error.message, error.logs, detection);
    throw error;
  }
}
