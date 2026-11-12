import fs from 'node:fs';
import path from 'node:path';

/**
 * Autonomous launch recipes. Every command Centinel may run is built here from a
 * fixed table matched to repository files. A model can only choose a recipe by id;
 * it never supplies program names, arguments or shell text.
 */
export type RecipeKind = 'node_script' | 'node_entry' | 'static' | 'python_django' | 'python_flask' | 'python_fastapi';
export type Framework = 'vite' | 'next' | 'cra' | 'nest' | 'express' | 'node' | 'static' | 'django' | 'flask' | 'fastapi' | 'unknown';
export type NodePackageManager = 'npm' | 'pnpm' | 'yarn';

export type LaunchRecipe = {
  id: string;
  kind: RecipeKind;
  framework: Framework;
  /** Human-readable command for the UI, e.g. "pnpm run dev". */
  label: string;
  packageManager?: NodePackageManager;
  script?: string;
  /** Relative file for node_entry, python app module file or Django manage.py. */
  entry?: string;
  /** Python ASGI/WSGI target such as "main:app". */
  appTarget?: string;
  /** Dependencies must be installed before start (node_modules missing). */
  needsInstall: boolean;
  /** How the assigned port reaches the app. 'none' = we detect it from output. */
  portStrategy: 'env' | 'args' | 'none';
  /** Higher is preferred. */
  score: number;
};

export type RecipeDetection = {
  folder: string;
  recipes: LaunchRecipe[];
  /** Set when no recipe applies; a plain-language reason for the UI. */
  unsupported?: { reason: 'not_a_directory' | 'monorepo' | 'docker_only' | 'no_entry_point'; message: string; candidates?: string[] };
};

const MAX_READ = 1024 * 1024;
const SCRIPT_PREFERENCE = ['dev', 'start', 'serve', 'preview'];

function readText(folder: string, relative: string): string | null {
  const file = path.join(folder, relative);
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(folder) + path.sep)) return null;
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > MAX_READ) return null;
    return fs.readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}

const exists = (folder: string, relative: string) => readText(folder, relative) !== null;

type Manifest = { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; workspaces?: unknown; main?: unknown };

function readManifest(folder: string): Manifest | null {
  const text = readText(folder, 'package.json');
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value as Manifest : null;
  } catch {
    return null;
  }
}

export function lockfilePackageManager(folder: string): NodePackageManager {
  if (exists(folder, 'pnpm-lock.yaml')) return 'pnpm';
  if (exists(folder, 'yarn.lock')) return 'yarn';
  return 'npm';
}

function nodeFramework(manifest: Manifest, scriptCommand: string): Framework {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  if (/\bnext\b/.test(scriptCommand) || 'next' in deps) return 'next';
  if (/\bvite\b/.test(scriptCommand) || 'vite' in deps) return 'vite';
  if (/react-scripts/.test(scriptCommand) || 'react-scripts' in deps) return 'cra';
  if (/\bnest\b/.test(scriptCommand) || '@nestjs/core' in deps) return 'nest';
  if ('express' in deps || 'fastify' in deps || 'koa' in deps) return 'express';
  return 'node';
}

const hasDependencies = (manifest: Manifest) => Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length > 0;
const SERVER_SOURCE = /\b(createServer|\.listen\s*\(|express\s*\(|fastify\s*\(|new\s+Koa\s*\()/;
/** "node server.js" style scripts run with Centinel's own Node runtime, no package manager. */
const PLAIN_NODE_SCRIPT = /^node\s+(\.\/)?([\w./-]+\.(?:c|m)?js)$/;

function detectNode(folder: string, manifest: Manifest): LaunchRecipe[] {
  const recipes: LaunchRecipe[] = [];
  const pm = lockfilePackageManager(folder);
  const needsInstall = hasDependencies(manifest) && !fs.existsSync(path.join(folder, 'node_modules'));
  const scripts = Object.entries(manifest.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  for (const [name, command] of scripts) {
    const rank = SCRIPT_PREFERENCE.indexOf(name);
    if (rank < 0) continue;
    const trimmed = command.trim();
    const plain = PLAIN_NODE_SCRIPT.exec(trimmed);
    if (plain && exists(folder, plain[2])) {
      recipes.push({
        id: `node-entry:${plain[2]}`, kind: 'node_entry', framework: nodeFramework(manifest, trimmed),
        label: `node ${plain[2]}`, entry: plain[2], needsInstall, portStrategy: 'env', score: 90 - rank,
      });
      continue;
    }
    const framework = nodeFramework(manifest, trimmed);
    // Production-only scripts need a build first; prefer development servers.
    const productionOnly = framework === 'next' && /\bnext\s+start\b/.test(trimmed);
    recipes.push({
      id: `node-script:${name}`, kind: 'node_script', framework, label: `${pm} run ${name}`,
      packageManager: pm, script: name, needsInstall,
      portStrategy: framework === 'vite' ? 'args' : 'env',
      score: (productionOnly ? 40 : 80) - rank,
    });
  }
  if (!recipes.length) {
    const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//, '') : null;
    for (const candidate of [main, 'server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js'].filter((value): value is string => !!value)) {
      const source = readText(folder, candidate);
      if (source && SERVER_SOURCE.test(source)) {
        recipes.push({ id: `node-entry:${candidate}`, kind: 'node_entry', framework: nodeFramework(manifest, ''), label: `node ${candidate}`, entry: candidate, needsInstall, portStrategy: 'env', score: 60 });
        break;
      }
    }
  }
  return recipes;
}

function detectPython(folder: string): LaunchRecipe[] {
  const recipes: LaunchRecipe[] = [];
  if (exists(folder, 'manage.py')) {
    recipes.push({ id: 'python-django:manage.py', kind: 'python_django', framework: 'django', label: 'python manage.py runserver', entry: 'manage.py', needsInstall: false, portStrategy: 'args', score: 70 });
  }
  for (const file of ['app.py', 'main.py', 'server.py', 'wsgi.py', 'asgi.py', 'app/main.py', 'src/main.py']) {
    const source = readText(folder, file);
    if (!source) continue;
    const module = file.replace(/\.py$/, '').split('/').join('.');
    const fastapi = /^(\w+)\s*=\s*FastAPI\s*\(/m.exec(source);
    if (fastapi) {
      recipes.push({ id: `python-fastapi:${module}:${fastapi[1]}`, kind: 'python_fastapi', framework: 'fastapi', label: `uvicorn ${module}:${fastapi[1]}`, entry: file, appTarget: `${module}:${fastapi[1]}`, needsInstall: false, portStrategy: 'args', score: 65 });
      continue;
    }
    const flask = /^(\w+)\s*=\s*Flask\s*\(/m.exec(source);
    if (flask) {
      recipes.push({ id: `python-flask:${module}:${flask[1]}`, kind: 'python_flask', framework: 'flask', label: `flask --app ${module} run`, entry: file, appTarget: `${module}:${flask[1]}`, needsInstall: false, portStrategy: 'args', score: 65 });
    }
  }
  return recipes;
}

function workspaceCandidates(folder: string): string[] {
  const found: string[] = [];
  for (const parent of ['apps', 'packages', 'services', 'frontend', 'backend', 'client', 'server', 'web']) {
    const directory = path.join(folder, parent);
    if (!fs.existsSync(path.join(directory, 'package.json')) && fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
      for (const child of fs.readdirSync(directory).slice(0, 50)) {
        if (fs.existsSync(path.join(directory, child, 'package.json'))) found.push(path.join(parent, child));
      }
    } else if (fs.existsSync(path.join(directory, 'package.json'))) {
      found.push(parent);
    }
  }
  return found.slice(0, 20);
}

/** Detect every launch recipe this folder supports, best first. */
export function detectLaunchRecipes(folder: string): RecipeDetection {
  let root: string;
  try {
    root = fs.realpathSync(folder);
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
  } catch {
    return { folder, recipes: [], unsupported: { reason: 'not_a_directory', message: 'This folder could not be opened.' } };
  }
  const manifest = readManifest(root);
  const recipes: LaunchRecipe[] = [];
  if (manifest) recipes.push(...detectNode(root, manifest));
  recipes.push(...detectPython(root));
  if (!recipes.length && exists(root, 'index.html')) {
    recipes.push({ id: 'static:index.html', kind: 'static', framework: 'static', label: 'Built-in static server', needsInstall: false, portStrategy: 'env', score: 30 });
  }
  if (!recipes.length) {
    const isMonorepo = !!manifest?.workspaces || exists(root, 'pnpm-workspace.yaml') || exists(root, 'lerna.json') || exists(root, 'turbo.json');
    const candidates = workspaceCandidates(root);
    if (isMonorepo || candidates.length > 1) {
      return { folder: root, recipes: [], unsupported: { reason: 'monorepo', message: 'This repository contains several apps. Choose the folder of the web app you want to test.', candidates } };
    }
    if (exists(root, 'docker-compose.yml') || exists(root, 'docker-compose.yaml') || exists(root, 'compose.yaml') || exists(root, 'Dockerfile')) {
      return { folder: root, recipes: [], unsupported: { reason: 'docker_only', message: 'This app starts with Docker, which Centinel does not run automatically. Start it yourself and test it by URL.' } };
    }
    return { folder: root, recipes: [], unsupported: { reason: 'no_entry_point', message: 'No web app start command was found in this folder.', candidates } };
  }
  recipes.sort((a, b) => b.score - a.score);
  return { folder: root, recipes };
}
