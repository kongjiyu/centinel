import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Artifact } from '../artifacts.js';

export const PDF_TEXT_POLICY = 'pdfjs-6.4.299-text-v1';
export const isPdfSource = (artifact: Pick<Artifact, 'fileName'>) => /\.pdf$/i.test(artifact.fileName);
export const sourceByteHash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
export type VerifiedSourceText = Readonly<{ text: string; pageCount?: number; policy?: string }>;
type TextReader = (artifact: Artifact, signal?: AbortSignal) => Promise<string>;
const issuedTexts = new WeakMap<VerifiedSourceText, { hash: string; fileName: string }>();
const readerTexts = new WeakMap<TextReader, Map<string, { identity: string; result: VerifiedSourceText }>>();
const normalizedHash = (value: string) => value.replace(/^sha256:/i, '').toLowerCase();
const sourceIdentity = (artifact: Artifact) => JSON.stringify([artifact.projectId, artifact.id, artifact.versionId,
  normalizedHash(artifact.contentHash), artifact.filePath, artifact.fileName]);

function issueText(artifact: Pick<Artifact, 'fileName' | 'contentHash'>, result: VerifiedSourceText): VerifiedSourceText {
  const value = Object.freeze(result);
  issuedTexts.set(value, { hash: normalizedHash(artifact.contentHash), fileName: artifact.fileName });
  return value;
}

/** Bind already byte-verified results to this Review's exact reader identity.
 * Weak references do not introduce a durable or cross-owner content cache. */
export function registerVerifiedSourceTexts(reader: TextReader, entries: Array<{ artifact: Artifact; result: VerifiedSourceText }>): void {
  const texts = new Map<string, { identity: string; result: VerifiedSourceText }>();
  for (const { artifact, result } of entries) {
    const issued = issuedTexts.get(result);
    if (!issued || issued.hash !== normalizedHash(artifact.contentHash) || issued.fileName !== artifact.fileName
      || isPdfSource(artifact) && result.policy !== PDF_TEXT_POLICY) throw new Error('Verified frozen text provenance does not match the source.');
    texts.set(artifact.id, { identity: sourceIdentity(artifact), result });
  }
  readerTexts.set(reader, texts);
}

export function verifiedTextForReader(reader: TextReader | undefined, artifact: Artifact, signal?: AbortSignal): VerifiedSourceText | undefined {
  signal?.throwIfAborted();
  const texts = reader && readerTexts.get(reader);
  if (!texts) return undefined;
  const saved = texts.get(artifact.id);
  if (!saved || saved.identity !== sourceIdentity(artifact)) throw new Error('Verified frozen text identity does not match the source.');
  return saved.result;
}

/** Hash original bytes first. Extracted text never substitutes for original evidence. */
export async function verifiedSourceText(artifact: Pick<Artifact, 'fileName' | 'contentHash'>, bytes: Uint8Array, signal?: AbortSignal): Promise<VerifiedSourceText> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const expected = artifact.contentHash.replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || sourceByteHash(bytes) !== expected) throw new Error('Original source bytes do not match the frozen source-manifest hash.');
  if (!isPdfSource(artifact)) return issueText(artifact, { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) });
  if (bytes.byteLength > 100 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('PDF text extraction requires a valid PDF within the 100 MiB limit.');
  const copy = Uint8Array.from(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdfTextWorker.mjs', import.meta.url), { workerData: copy, transferList: [copy.buffer], env: {}, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let settled = false;
    const finish = (error?: Error, value?: { text: string; pageCount: number }) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate();
      if (error) reject(error); else resolve(issueText(artifact, { ...value!, policy: PDF_TEXT_POLICY }));
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('PDF text extraction exceeded its bounded deadline.')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.once('message', value => {
      if (!value || typeof value.text !== 'string' || !Number.isInteger(value.pageCount) || value.text.length > 2100000) finish(new Error('PDF text is unavailable, encrypted, image-only, malformed or exceeds extraction limits.'));
      else finish(undefined, value);
    });
    worker.once('error', () => finish(new Error('PDF text extraction failed.')));
    worker.once('exit', () => { if (!settled) finish(new Error('PDF text extraction stopped.')); });
  });
}
