import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_PRIVATE_HOME_ENV = 'CENTINEL_CODEX_PRIVATE_HOME';

// Keep the script fixed and pass the directory through the environment. The
// path is never embedded in PowerShell source or parsed as a shell command.
const WINDOWS_PRIVATE_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$homePath = [Environment]::GetEnvironmentVariable('CENTINEL_CODEX_PRIVATE_HOME')
if ([String]::IsNullOrWhiteSpace($homePath)) { throw 'Missing Codex home path.' }

$root = Get-Item -LiteralPath $homePath -Force -ErrorAction Stop
if (-not $root.PSIsContainer) { throw 'Codex home must be a directory.' }

# Enumerate before changing any ACL so a reparse point cannot redirect the
# operation outside the app-owned home or leave a partially protected tree.
$items = New-Object 'System.Collections.Generic.List[System.IO.FileSystemInfo]'
$items.Add([System.IO.DirectoryInfo]$root)
for ($index = 0; $index -lt $items.Count; $index++) {
  $item = $items[$index]
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Codex home contains a reparse point.'
  }
  if ($item.PSIsContainer) {
    foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) {
      if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Codex home contains a reparse point.'
      }
      $items.Add([System.IO.FileSystemInfo]$child)
    }
  }
}

$ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($null -eq $ownerSid) { throw 'Unable to resolve the current Windows user.' }
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$none = [System.Security.AccessControl.PropagationFlags]::None

foreach ($item in $items) {
  $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existingRule in @($acl.Access)) {
    [void]$acl.RemoveAccessRuleSpecific($existingRule)
  }
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $ownerSid.Value) {
    throw 'Codex home must be owned by the current Windows user.'
  }
  if ($item.PSIsContainer) {
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  }
  $ownerRule = [System.Security.AccessControl.FileSystemAccessRule]::new($ownerSid, $fullControl, $inheritance, $none, $allow)
  $systemRule = [System.Security.AccessControl.FileSystemAccessRule]::new($systemSid, $fullControl, $inheritance, $none, $allow)
  $acl.AddAccessRule($ownerRule)
  $acl.AddAccessRule($systemRule)
  if ($item.PSIsContainer) {
    ([System.IO.DirectoryInfo]$item).SetAccessControl($acl)
  } else {
    ([System.IO.FileInfo]$item).SetAccessControl($acl)
  }
}
`;

function rejectReparsePoint(directory: string): void {
  const info = fs.lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Codex credential home must be a real directory, not a link.');
  }
}

function secureWindowsDirectory(directory: string): void {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
    windir: process.env.windir,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    [WINDOWS_PRIVATE_HOME_ENV]: directory,
  };

  try {
    execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PRIVATE_ACL_SCRIPT,
    ], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error('Codex credential home could not be secured with private Windows ACLs.', { cause: error });
  }
}

/** Restrict an app-managed Codex home while preserving all existing contents. */
export function securePrivateDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  rejectReparsePoint(resolved);

  if (process.platform === 'win32') {
    secureWindowsDirectory(resolved);
    return;
  }

  fs.chmodSync(resolved, 0o700);
  const authFile = path.join(resolved, 'auth.json');
  if (fs.existsSync(authFile)) {
    const authInfo = fs.lstatSync(authFile);
    if (authInfo.isSymbolicLink() || !authInfo.isFile()) {
      throw new Error('Codex credential file must be a regular file, not a link.');
    }
    fs.chmodSync(authFile, 0o600);
  }
}
