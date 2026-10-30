import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const task = getDocument({ data: workerData, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
try {
  const pdf = await task.promise;
  if (pdf.numPages > 1000) throw Error();
  let chars = 0; let textItems = 0;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const lines = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      chars += item.str.length + 1;
      if (chars > 2000000 || ++textItems > 200000) throw Error();
      lines.push(item.str + (item.hasEOL ? '\n' : ' '));
    }
    pages.push(`[Page ${number}]\n${lines.join('').trim()}`);
    page.cleanup();
  }
  if (!textItems || !pages.some(page => page.replace(/\[Page \d+\]/g, '').trim())) throw Error();
  parentPort.postMessage({ text: 'PDF extracted text. Diagrams, image-only content and visual layout remain unverified.\n' + pages.join('\n\n'), pageCount: pdf.numPages });
} catch { parentPort.postMessage({ error: 'pdf_text_unavailable' }); }
finally { await task.destroy(); }
