import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Loaded here, it runs in this thread: an extension has no web workers.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/** A PDF's text, page by page. Loaded only when a PDF is opened. */
export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    parts.push(`## Page ${n}\n${text.trim()}`);
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text: parts.join('\n\n'), pages };
}
