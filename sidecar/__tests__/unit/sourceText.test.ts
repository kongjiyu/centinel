import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { describe, it, expect } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { verifiedSourceText, registerVerifiedSourceTexts, verifiedTextForReader } from '../../src/review/sourceText.js';
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
async function pdf(text: string): Promise<Buffer> {
  return new Promise(resolve => { const doc = new PDFDocument({ compress: false }); const chunks: Buffer[] = []; doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.text(text); doc.end(); });
}
describe('binary-safe frozen source text', () => {
  it('verifies original PDF bytes then extracts bounded page-labelled text', async () => {
    const bytes = await pdf('CargoChain requirement one');
    const result = await verifiedSourceText({ fileName: 'report.pdf', contentHash: hash(bytes) }, bytes);
    expect(result.text).toContain('CargoChain requirement one'); expect(result.text).toContain('[Page 1]');
    expect(result.text).toContain('remain unverified'); expect(result.pageCount).toBe(1);
    expect(hash(Buffer.from(result.text))).not.toBe(hash(bytes));
    const artifact = { id: 'pdf', projectId: 'project', versionId: 'version', fileName: 'report.pdf', filePath: 'report.pdf', contentHash: hash(bytes) } as Artifact;
    const reader = async () => result.text;
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => registerVerifiedSourceTexts(reader, [{ artifact, result: { ...result } }])).toThrow('provenance');
    registerVerifiedSourceTexts(reader, [{ artifact, result }]);
    expect(verifiedTextForReader(reader, artifact)).toBe(result);
    expect(verifiedTextForReader(async () => result.text, artifact)).toBeUndefined();
    for (const changed of [{ projectId: 'other' }, { versionId: 'other' }, { contentHash: 'a'.repeat(64) }, { filePath: 'other.pdf' }]) {
      expect(() => verifiedTextForReader(reader, { ...artifact, ...changed })).toThrow('identity');
    }
    const controller = new AbortController(); controller.abort();
    expect(() => verifiedTextForReader(reader, artifact, controller.signal)).toThrow();
  });
  it('rejects changed original bytes before extraction', async () => {
    const bytes = await pdf('Original'); const changed = Buffer.from(bytes); changed[20] ^= 1;
    await expect(verifiedSourceText({ fileName: 'report.pdf', contentHash: hash(bytes) }, changed)).rejects.toThrow('Original source bytes');
  });
  it('rejects image-only or empty PDFs without inventing text', async () => {
    const bytes = await pdf('');
    await expect(verifiedSourceText({ fileName: 'empty.pdf', contentHash: hash(bytes) }, bytes)).rejects.toThrow('PDF text is unavailable');
  });
  it('preserves UTF-8 BOM bytes for subsequent frozen text hash validation', async () => {
    const bytes = Buffer.from('\ufeffexport const value = 1;');
    const result = await verifiedSourceText({ fileName: 'bom.ts', contentHash: hash(bytes) }, bytes);
    expect(hash(Buffer.from(result.text))).toBe(hash(bytes));
  });
  it('preserves plain UTF-8 hash validation and stops pre-cancelled work', async () => {
    const bytes = Buffer.from('valid text');
    expect((await verifiedSourceText({ fileName: 'a.ts', contentHash: hash(bytes) }, bytes)).text).toBe('valid text');
    const controller = new AbortController(); controller.abort();
    await expect(verifiedSourceText({ fileName: 'a.ts', contentHash: hash(bytes) }, bytes, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
