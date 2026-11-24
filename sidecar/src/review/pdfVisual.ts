import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Artifact } from '../artifacts.js';
import { sourceByteHash } from './sourceText.js';

export const MAX_PDF_PAGES_PER_REVIEW = 64;
const PAGES_PER_REQUEST = 4;

export type PdfVisualCoverage = {
  artifactId: string;
  sourceVersion: string;
  fileName: string;
  totalPages: number;
  pages: Array<{ page: number; summary: string }>;
};

type PageImage = { number: number; png: Uint8Array };

async function renderPages(bytes: Uint8Array, pageCount: number, limit: number, signal: AbortSignal): Promise<PageImage[]> {
  signal.throwIfAborted();
  const copy = Uint8Array.from(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdfVisualWorker.mjs', import.meta.url), { workerData: { bytes: copy, pageCount, limit }, transferList: [copy.buffer], env: {}, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    let settled = false;
    const finish = (pages: PageImage[], abort = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      void worker.terminate();
      if (abort) reject(signal.reason); else resolve(pages);
    };
    const onAbort = () => finish([], true);
    const timer = setTimeout(() => finish([]), 60_000);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    worker.once('message', value => finish(Array.isArray(value) ? value : []));
    worker.once('error', () => finish([]));
    worker.once('exit', () => finish([]));
  });
}

export const PDF_VISUAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pages'],
  properties: { pages: { type: 'array', minItems: 1, maxItems: PAGES_PER_REQUEST, items: {
    type: 'object', additionalProperties: false, required: ['page', 'readable', 'summary'],
    properties: { page: { type: 'integer' }, readable: { type: 'boolean' }, summary: { type: 'string', maxLength: 360 } },
  } } },
};

/** A coverage receipt requires one exact response row per attached page. */
export function visualPageReceipts(value: unknown, expected: number[]): PdfVisualCoverage['pages'] {
  const rows = (value as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(rows) || rows.length !== expected.length) return [];
  if (rows.some((row, i) => row?.page !== expected[i] || typeof row.readable !== 'boolean'
    || typeof row.summary !== 'string' || row.summary.length > 360 || row.readable && !row.summary.trim())) return [];
  return rows.filter(row => row.readable).map(row => ({ page: row.page, summary: row.summary.trim() }));
}

export async function inspectPdfVisuals(artifact: Artifact, bytes: Uint8Array, pageCount: number, limit: number, signal: AbortSignal,
  analyze: (pageNumbers: number[], imagePaths: string[]) => Promise<unknown>): Promise<PdfVisualCoverage> {
  if (bytes.length > 100 * 1024 * 1024 || sourceByteHash(bytes) !== artifact.contentHash.replace(/^sha256:/i, '').toLowerCase()) {
    throw new Error('Original PDF bytes do not match the frozen source.');
  }
  const images = await renderPages(bytes, pageCount, Math.min(pageCount, limit, MAX_PDF_PAGES_PER_REVIEW), signal);
  const coverage: PdfVisualCoverage = { artifactId: artifact.id, fileName: artifact.fileName, sourceVersion: artifact.contentHash, totalPages: pageCount, pages: [] };
  if (!images.length) return coverage;
  const folder = await mkdtemp(path.join(tmpdir(), 'orin-pdf-'));
  const files: string[] = [];
  try {
    for (let i = 0; i < images.length; i += PAGES_PER_REQUEST) {
      signal.throwIfAborted();
      const batch = images.slice(i, i + PAGES_PER_REQUEST);
      const imagePaths: string[] = [];
      for (const { number, png } of batch) {
        const file = path.join(folder, `page-${number}.png`);
        files.push(file);
        await writeFile(file, png, { mode: 0o600, flag: 'wx', signal });
        imagePaths.push(file);
      }
      const numbers = batch.map(page => page.number);
      const response = await analyze(numbers, imagePaths);
      if (response === undefined) break;
      coverage.pages.push(...visualPageReceipts(response, numbers));
    }
    return coverage;
  } finally {
    await Promise.all(files.map(file => rm(file, { force: true })));
    await rmdir(folder);
  }
}
