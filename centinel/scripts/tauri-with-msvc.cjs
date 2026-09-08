const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const projectRoot = join(__dirname, '..');
const tauriCli = join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

function findVcvars() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const candidates = [];

  if (existsSync(vswhere)) {
    try {
      const installationPath = execFileSync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property',
          'installationPath',
        ],
        { encoding: 'utf8' },
      ).trim();
      if (installationPath) candidates.push(installationPath);
    } catch {
      // Let the Tauri CLI report its usual prerequisite error if discovery fails.
    }
  }

  candidates.push(join(programFilesX86, 'Microsoft Visual Studio', '2022', 'BuildTools'));
  return candidates
    .map((installationPath) => join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))
    .find(existsSync);
}

function quoteForCmd(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

if (process.platform !== 'win32') {
  const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const vcvars = findVcvars();
if (!vcvars) {
  console.error('MSVC Build Tools were not found. Install the Visual C++ Build Tools workload, then retry.');
  process.exit(1);
}

const tauriCommand = [process.execPath, tauriCli, ...process.argv.slice(2)].map(quoteForCmd).join(' ');
const result = spawnSync('cmd.exe', ['/d', '/c', `call ${quoteForCmd(vcvars)} >nul && ${tauriCommand}`], {
  stdio: 'inherit',
  windowsVerbatimArguments: true,
});
process.exit(result.status ?? 1);
