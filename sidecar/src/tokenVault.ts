import crypto from 'node:crypto';

/** Encrypt provider credentials before they are persisted. The key is never
 * returned through the HTTP API and is deliberately not read from VITE_* env. */
function encryptionKey(): Buffer {
  const configured = process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('CENTINEL_TOKEN_ENCRYPTION_KEY is not configured.');
  return crypto.createHash('sha256').update(configured).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('Invalid encrypted provider credential.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
}
