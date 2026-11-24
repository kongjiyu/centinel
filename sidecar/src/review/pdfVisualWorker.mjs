import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const task = getDocument({ data: workerData.bytes, isEvalSupported: false, useSystemFonts: false,
  disableFontFace: true, enableXfa: false, verbosity: 0, maxImageSize: 25_000_000 });
try {
  const pdf = await task.promise;
  if (pdf.numPages !== workerData.pageCount) throw new Error('Page count mismatch');
  const factory = pdf.canvasFactory;
  const pages = [];
  let total = 0;
  for (let number = 1; number <= workerData.limit; number++) {
    const page = await pdf.getPage(number);
    const size = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1600 / Math.max(size.width, size.height));
    const viewport = page.getViewport({ scale });
    if (viewport.width < 1 || viewport.height < 1) break;
    const surface = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvasContext: surface.context, canvas: surface.canvas, viewport }).promise;
      const bytes = surface.canvas.toBuffer('image/png');
      total += bytes.length;
      if (bytes.length > 3 * 1024 * 1024 || total > 32 * 1024 * 1024) break;
      pages.push({ number, png: Uint8Array.from(bytes) });
    } finally {
      factory.destroy(surface);
      page.cleanup();
    }
  }
  parentPort.postMessage(pages, pages.map(page => page.png.buffer));
} catch { parentPort.postMessage(null); }
finally { await task.destroy(); }
