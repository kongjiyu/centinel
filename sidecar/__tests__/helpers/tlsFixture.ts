import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Ephemeral localhost certificate for TLS policy tests. Explicit configuration
 * avoids MSYS/UCRT OpenSSL looking for a Unix-only /etc path on Windows. */
export function createLocalTlsFixture(directory: string, hostname: 'localhost' | '127.0.0.1' = 'localhost') {
  const gitRoot = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git');
  const executable = process.platform === 'win32' ? path.join(gitRoot, 'usr/bin/openssl.exe') : 'openssl';
  const config = path.join(gitRoot, 'usr/ssl/openssl.cnf');
  if (process.platform === 'win32' && (!fs.existsSync(executable) || !fs.existsSync(config))) {
    throw new Error('TLS tests need Git for Windows with its bundled OpenSSL and configuration.');
  }
  const key = path.join(directory, 'key.pem');
  const cert = path.join(directory, 'cert.pem');
  execFileSync(executable, ['req', ...(process.platform === 'win32' ? ['-config', config] : []),
    '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', `/CN=${hostname}`, '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'],
  { stdio: 'ignore', windowsHide: true });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
