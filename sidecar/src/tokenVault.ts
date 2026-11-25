import crypto from 'node:crypto';
import { readSync } from 'node:fs';

const devicePrefix = 'device-v1.';
const workspacePrefix = 'workspace-v1.';
let modelDeviceKey: Buffer | undefined;

export function initializePackagedModelKey(): void {
  const supplied = process.env.CENTINEL_MODEL_KEY_PIPE === '1';
  delete process.env.CENTINEL_MODEL_KEY_PIPE;
  if (!supplied) return;
  const key = Buffer.alloc(32);
  try {
    let offset = 0;
    while (offset < key.length) {
      const length = readSync(0, key, offset, key.length - offset, null);
      if (!length) throw new Error('Incomplete device key');
      offset += length;
    }
    modelDeviceKey = key;
  } catch {
    key.fill(0);
    console.warn('[packaged] OS-protected model credentials could not be initialized.');
  }
}

const ownerBinding = (owner: string) => Buffer.from('centinel-model-device-v1\0' + owner, 'utf8');

export function encryptLocalModelSecret(owner: string, value: string): string {
  if (!modelDeviceKey) {
    if (process.env.CENTINEL_PACKAGED === '1') throw new Error('OS-protected model credentials are unavailable on this device.');
    return encryptSecret(value);
  }
  return devicePrefix + seal(value, modelDeviceKey, ownerBinding(owner));
}

export function decryptModelSecret(owner: string, value: string): string {
  if (!value.startsWith(devicePrefix)) return decryptSecret(value);
  if (!modelDeviceKey) throw new Error('OS-protected model credentials are unavailable on this device.');
  return open(value.slice(devicePrefix.length), modelDeviceKey, ownerBinding(owner));
}

export function encryptLocalWorkspaceSecret(scope: string, value: string): string {
  if (!modelDeviceKey) {
    if (process.env.CENTINEL_PACKAGED === '1') throw new Error('OS-protected workspace credentials are unavailable on this device.');
    return encryptSecret(value);
  }
  return workspacePrefix + seal(value, modelDeviceKey, Buffer.from('centinel-workspace-v1\0' + scope));
}

export function localWorkspaceEncryptionAvailable(): boolean {
  return Boolean(modelDeviceKey || (process.env.CENTINEL_PACKAGED !== '1' && process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim()));
}

export function decryptLocalWorkspaceSecret(scope: string, value: string): string {
  if (!value.startsWith(workspacePrefix)) return decryptSecret(value);
  if (!modelDeviceKey) throw new Error('OS-protected workspace credentials are unavailable on this device.');
  return open(value.slice(workspacePrefix.length), modelDeviceKey, Buffer.from('centinel-workspace-v1\0' + scope));
}

/** Encrypt provider credentials before they are persisted. The key is never
 * returned through the HTTP API and is deliberately not read from VITE_* env. */
function encryptionKey(): Buffer {
  const configured = process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('CENTINEL_TOKEN_ENCRYPTION_KEY is not configured.');
  return crypto.createHash('sha256').update(configured).digest();
}

export function encryptSecret(value: string): string {
  return seal(value, encryptionKey());
}

function seal(value: string, key: Buffer, context?: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (context) cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string {
  return open(value, encryptionKey());
}

function open(value: string, key: Buffer, context?: Buffer): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('Invalid encrypted provider credential.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
  if (context) decipher.setAAD(context);
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
}
