import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A process-local, expiring capability for downloads opened outside the webview. */
export class LocalDownloadToken<T extends { expires: number }> {
  private readonly key = randomBytes(32);

  issue(value: T): string {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return payload + '.' + this.sign(payload).toString('base64url');
  }

  read(key: string | null): T | null {
    if (!key || key.length > 2048) return null;
    const token = /^([\w-]+)\.([\w-]{43})$/.exec(key);
    if (!token) return null;
    const signature = Buffer.from(token[2], 'base64url');
    if (signature.length !== 32 || !timingSafeEqual(signature, this.sign(token[1]))) return null;
    const value = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8')) as T;
    return value.expires > Date.now() ? value : null;
  }

  private sign(payload: string): Buffer {
    return createHmac('sha256', this.key).update(payload).digest();
  }
}
