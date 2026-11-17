import { spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WINDOWS_RUNTIME_VARIABLE = /^(SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|CENTINEL_JOB_ARGV)$/i;

// The supervisor joins a kill-on-close Job Object before it starts the app.
// Its stdin belongs to the sidecar. EOF after a sidecar exit terminates the job.
const supervisor = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CentinelJob {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long PerProcessTime, PerJobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }

    // Windows passes one command line to the executable. Escape each argv entry
    // using the Windows CRT rules without involving cmd.exe.
    static string Quote(string value) {
        var result = new StringBuilder().Append('"');
        int slashes = 0;
        foreach (char c in value) {
            if (c == (char)92) { slashes++; continue; }
            result.Append((char)92, c == '"' ? slashes * 2 + 1 : slashes).Append(c);
            slashes = 0;
        }
        return result.Append((char)92, slashes * 2).Append('"').ToString();
    }

    public static void Run(string executable, string[] args, string workingDirectory) {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(limits);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, 9, buffer, (uint)size) ||
                !AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
        } finally { Marshal.FreeHGlobal(buffer); }

        var watcher = new Thread(() => {
            try { Console.OpenStandardInput().ReadByte(); }
            finally { Environment.Exit(125); }
        });
        watcher.IsBackground = true;
        watcher.Start();

        var info = new ProcessStartInfo(executable, string.Join(" ", Array.ConvertAll(args, Quote)));
        info.UseShellExecute = false;
        info.WorkingDirectory = workingDirectory;
        info.RedirectStandardInput = true;
        using (var child = Process.Start(info)) {
            child.StandardInput.Close();
            child.WaitForExit();
            Environment.Exit(child.ExitCode);
        }
    }
}
"@
$config = ConvertFrom-Json $env:CENTINEL_JOB_ARGV
Remove-Item Env:CENTINEL_JOB_ARGV
[CentinelJob]::Run($config.executable, [string[]]$config.args, $config.cwd)
`;

export function windowsRuntimeEnvironment(home: string): NodeJS.ProcessEnv {
  const root = process.env.SystemRoot ?? 'C:\Windows';
  const temp = path.join(home, 'tmp');
  const appData = path.join(home, 'AppData', 'Roaming');
  const localAppData = path.join(home, 'AppData', 'Local');
  for (const directory of [temp, appData, localAppData]) fs.mkdirSync(directory, { recursive: true });
  return {
    SystemRoot: root, WINDIR: root, ComSpec: path.join(root, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData,
    TEMP: temp, TMP: temp, TMPDIR: temp,
  };
}

export function spawnWindowsJob(executable: string, args: string[], options: SpawnOptions & { cwd: string }) {
  if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== '.exe') {
    throw new Error('Windows workspace commands require an absolute executable path.');
  }
  if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) throw new Error('Workspace executable unavailable.');
  const root = process.env.SystemRoot ?? 'C:\Windows';
  const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return spawn(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(supervisor, 'utf16le').toString('base64')], {
    ...options, detached: false, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...options.env, CENTINEL_JOB_ARGV: JSON.stringify({ executable, args, cwd: options.cwd }) },
  });
}
