import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const task = getDocument({ data: workerData.bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
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
  const hasText = textItems > 0 && pages.some(page => page.replace(/\[Page \d+\]/g, '').trim());
  if (!hasText && !workerData.allowImageOnly) throw Error();
  parentPort.postMessage({ text: 'PDF extracted text. Visual content requires a separate page review.\n' + (hasText ? pages.join('\n\n') : 'This PDF has no extractable text.'), pageCount: pdf.numPages });
} catch { parentPort.postMessage({ error: 'pdf_text_unavailable' }); }
finally { await task.destroy(); }
