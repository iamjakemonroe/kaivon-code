import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { notebookText, rtfText } from './rtf';

/** Reads any file for Chip. What a file is comes from its bytes, not its name: Excel, Word, PowerPoint,
 * OpenDocument, EPUB, PDF, images, archives, text in any common encoding. Anything else still answers
 * with what it is and the text that can be found in it, so no file is ever a dead end. */

export type Reading =
  /** The file is text as it stands, so it can be edited. */
  | { kind: 'plain'; text: string; format: string }
  /** Text taken out of a document: for reading, not for editing. */
  | { kind: 'extracted'; text: string; format: string }
  | { kind: 'image'; media: string; data: string; format: string }
  /** A PDF with no text in it (a scan), for Chip to look at. */
  | { kind: 'scan'; data: string; format: string };

/** The readers too big to load until they're needed. */
export interface Heavy {
  sheet(bytes: Uint8Array, name: string): string;
  pdf(bytes: Uint8Array): Promise<{ text: string; pages: number }>;
}

/** Images and scans go whole, and every step of a conversation sends them again. */
export const MOST_MEDIA_BYTES = 3_000_000;

const starts = (b: Uint8Array, ...sig: number[]) => sig.every((v, i) => b[i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const base64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const sizeOf = (n: number) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, e: string) => {
    if (e[0] !== '#') return entities[e.toLowerCase()] ?? whole;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
const untag = (xml: string) =>
  decode(xml.replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const utf8 = new TextDecoder('utf-8');
const entry = (zip: Record<string, Uint8Array>, name: string) => (zip[name] ? utf8.decode(zip[name]) : '');
const byNumber = (a: string, b: string) => Number(/(\d+)\.\w+$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.\w+$/.exec(b)?.[1] ?? 0);

function wordXml(xml: string) {
  return untag(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:p>/g, '\n'),
  );
}

function wordText(zip: Record<string, Uint8Array>) {
  const parts = [wordXml(entry(zip, 'word/document.xml'))];
  for (const [file, title] of [['word/footnotes.xml', 'Footnotes'], ['word/endnotes.xml', 'Endnotes'], ['word/comments.xml', 'Comments']]) {
    const text = wordXml(entry(zip, file));
    if (text) parts.push(`## ${title}\n${text}`);
  }
  return parts.join('\n\n');
}

function slidesText(zip: Record<string, Uint8Array>) {
  const text = (xml: string) => untag(xml.replace(/<a:br[^>]*\/>/g, '\n').replace(/<\/a:p>/g, '\n'));
  const slides = Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
  return slides
    .map((name, i) => {
      const notes = text(entry(zip, name.replace('slides/slide', 'notesSlides/notesSlide')));
      return `## Slide ${i + 1}\n${text(entry(zip, name))}${notes ? `\n\nNotes: ${notes}` : ''}`;
    })
    .join('\n\n');
}

const openDocumentText = (zip: Record<string, Uint8Array>) => untag(entry(zip, 'content.xml').replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/text:(p|h)>/g, '\n'));

function epubText(zip: Record<string, Uint8Array>) {
  const pages = Object.keys(zip).filter((n) => /\.x?html?$/i.test(n)).sort();
  return pages.map((n) => untag(entry(zip, n).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n'))).filter(Boolean).join('\n\n');
}

const listing = (title: string, names: string[]) => `${title} (${names.length} file${names.length === 1 ? '' : 's'}):\n${names.slice(0, 2000).join('\n')}${names.length > 2000 ? `\n… and ${names.length - 2000} more` : ''}`;

async function readZip(name: string, bytes: Uint8Array, heavy: Heavy): Promise<Reading> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch (e) {
    return { kind: 'extracted', format: 'archive', text: `${name} is a zip file that couldn't be opened (${sizeOf(bytes.length)}). It may be damaged or password-protected. ${(e as Error).message}` };
  }
  const has = (file: string) => file in zip;
  if (has('xl/workbook.xml') || has('xl/workbook.bin')) return { kind: 'extracted', format: 'spreadsheet', text: heavy.sheet(bytes, name) };
  if (has('word/document.xml')) return { kind: 'extracted', format: 'Word document', text: wordText(zip) };
  if (has('ppt/presentation.xml')) return { kind: 'extracted', format: 'PowerPoint', text: slidesText(zip) };
  if (has('content.xml') && has('mimetype')) {
    if (entry(zip, 'mimetype').includes('spreadsheet')) return { kind: 'extracted', format: 'spreadsheet', text: heavy.sheet(bytes, name) };
    return { kind: 'extracted', format: 'OpenDocument', text: openDocumentText(zip) };
  }
  if (has('META-INF/container.xml')) return { kind: 'extracted', format: 'EPUB', text: epubText(zip) };
  if (/\.numbers$/i.test(name)) return { kind: 'extracted', format: 'spreadsheet', text: heavy.sheet(bytes, name) };
  return { kind: 'extracted', format: 'archive', text: listing(`${name} is a zip archive`, Object.keys(zip)) };
}

/** The names in a tar archive. */
function tarNames(b: Uint8Array) {
  const names: string[] = [];
  for (let at = 0; at + 512 <= b.length && b[at] !== 0; ) {
    const name = ascii(b, at, at + 100).replace(/\0.*$/, '');
    const size = parseInt(ascii(b, at + 124, at + 136).replace(/\0.*$/, '').trim() || '0', 8);
    if (name) names.push(name);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

/** Text a person could read inside a binary file, in one-byte and two-byte encodings. */
function strings(b: Uint8Array, most = 20_000) {
  const window = b.subarray(0, 8_000_000);
  const text = Buffer.from(window).toString('latin1');
  const found = [...(text.match(/[\x20-\x7e\t]{6,}/g) ?? []), ...(Buffer.from(window).toString('utf16le').match(/[\x20-\x7e -ɏ\t]{6,}/g) ?? [])];
  return [...new Set(found)].join('\n').slice(0, most);
}

const KINDS: [string, (b: Uint8Array) => boolean][] = [
  ['an SQLite database', (b) => ascii(b, 0, 15) === 'SQLite format 3'],
  ['an MP3 audio file', (b) => ascii(b, 0, 3) === 'ID3'],
  ['an MP4 or MOV video', (b) => ascii(b, 4, 8) === 'ftyp'],
  ['a WAV audio file', (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE'],
  ['an AVI video', (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'AVI '],
  ['an Ogg audio file', (b) => ascii(b, 0, 4) === 'OggS'],
  ['a FLAC audio file', (b) => ascii(b, 0, 4) === 'fLaC'],
  ['a BMP image', (b) => ascii(b, 0, 2) === 'BM'],
  ['a TIFF image', (b) => ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*'],
  ['a Windows program', (b) => ascii(b, 0, 2) === 'MZ'],
  ['a Mac program', (b) => starts(b, 0xcf, 0xfa, 0xed, 0xfe) || starts(b, 0xca, 0xfe, 0xba, 0xbe)],
  ['a Linux program', (b) => starts(b, 0x7f, 0x45, 0x4c, 0x46)],
  ['WebAssembly', (b) => starts(b, 0, 0x61, 0x73, 0x6d)],
  ['a font', (b) => ['OTTO', 'wOFF', 'wOF2', 'true'].includes(ascii(b, 0, 4)) || starts(b, 0, 1, 0, 0, 0)],
  ['a 7-Zip archive', (b) => ascii(b, 0, 2) === '7z'],
  ['a RAR archive', (b) => ascii(b, 0, 4) === 'Rar!'],
];

function binary(name: string, bytes: Uint8Array, what?: string): Reading {
  const kind = what ?? KINDS.find(([, test]) => test(bytes))?.[0] ?? 'a binary file';
  const said = `${name} is ${kind}, ${sizeOf(bytes.length)}.`;
  // Media and programs only hold noise that looks like text, and Chip pays to read it.
  if (/audio|video|program|font|image|WebAssembly|archive/.test(kind)) return { kind: 'extracted', format: kind, text: `${said} Chip can't read what's inside this kind of file.` };
  const found = strings(bytes);
  return { kind: 'extracted', format: kind, text: `${said} Chip can't read it in full.${found ? `\n\nText found inside it:\n${found}` : '\n\nNo readable text was found inside it.'}` };
}

/** Whether these bytes are text, and in which encoding. */
function asText(b: Uint8Array): string | null {
  if (starts(b, 0xff, 0xfe)) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (starts(b, 0xfe, 0xff)) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const sample = b.subarray(0, 65536);
  if (sample.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(starts(b, 0xef, 0xbb, 0xbf) ? b.subarray(3) : b);
  } catch {
    // Old files in Windows-1252: mostly plain text with the odd accent.
    let odd = 0;
    for (const v of sample) if (v < 9 || (v > 13 && v < 32)) odd++;
    return odd / Math.max(sample.length, 1) < 0.02 ? new TextDecoder('windows-1252').decode(b) : null;
  }
}

function media(name: string, bytes: Uint8Array, kind: string, type: string): Reading {
  if (bytes.length > MOST_MEDIA_BYTES) return { kind: 'extracted', format: kind, text: `${name} is ${kind} of ${sizeOf(bytes.length)}, too big to send to Chip (the limit is ${sizeOf(MOST_MEDIA_BYTES)}).` };
  return { kind: 'image', media: type, data: base64(bytes), format: kind };
}

export async function readAny(name: string, bytes: Uint8Array, heavy: Heavy): Promise<Reading> {
  if (bytes.length === 0) return { kind: 'plain', text: '', format: 'empty file' };
  if (starts(bytes, 0x25, 0x50, 0x44, 0x46)) {
    const { text, pages } = await heavy.pdf(bytes).catch((e: Error) => ({ text: '', pages: 0, failed: e.message }));
    if (text.trim().length > 40) return { kind: 'extracted', format: 'PDF', text };
    if (bytes.length > MOST_MEDIA_BYTES) return { kind: 'extracted', format: 'PDF', text: `${name} is a PDF of ${pages || 'some'} pages with no text in it, probably a scan, and at ${sizeOf(bytes.length)} it's too big to send to Chip (the limit is ${sizeOf(MOST_MEDIA_BYTES)}).` };
    return { kind: 'scan', data: base64(bytes), format: 'PDF' };
  }
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return media(name, bytes, 'a PNG image', 'image/png');
  if (starts(bytes, 0xff, 0xd8, 0xff)) return media(name, bytes, 'a JPEG image', 'image/jpeg');
  if (ascii(bytes, 0, 4) === 'GIF8') return media(name, bytes, 'a GIF image', 'image/gif');
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return media(name, bytes, 'a WebP image', 'image/webp');
  if (starts(bytes, 0x50, 0x4b, 3, 4) || starts(bytes, 0x50, 0x4b, 5, 6)) return readZip(name, bytes, heavy);
  if (starts(bytes, 0xd0, 0xcf, 0x11, 0xe0)) {
    // Office's older files. Excel's open fully; Word and PowerPoint's give up their text.
    if (/\.(xls|xlt|xla|xlsb|et)$/i.test(name) || strings(bytes.subarray(0, 4096)).includes('Workbook') || Buffer.from(bytes).includes(Buffer.from('Workbook', 'utf16le'))) return { kind: 'extracted', format: 'spreadsheet', text: heavy.sheet(bytes, name) };
    return binary(name, bytes, 'an older Microsoft Office file');
  }
  if (starts(bytes, 0x1f, 0x8b)) {
    try {
      const inner = gunzipSync(bytes);
      if (ascii(inner, 257, 262) === 'ustar') return { kind: 'extracted', format: 'archive', text: listing(`${name} is a compressed tar archive`, tarNames(inner)) };
      return await readAny(name.replace(/\.gz$/i, ''), inner, heavy);
    } catch {
      return binary(name, bytes, 'a gzip file');
    }
  }
  if (ascii(bytes, 257, 262) === 'ustar') return { kind: 'extracted', format: 'archive', text: listing(`${name} is a tar archive`, tarNames(bytes)) };
  const text = asText(bytes);
  if (text === null) return binary(name, bytes);
  if (/\.ipynb$/i.test(name)) {
    try {
      return { kind: 'extracted', format: 'notebook', text: notebookText(text) };
    } catch {
      return { kind: 'plain', text, format: 'text' };
    }
  }
  if (/\.rtf$/i.test(name) || text.startsWith('{\\rtf')) return { kind: 'extracted', format: 'rich text', text: rtfText(text) };
  return { kind: 'plain', text, format: 'text' };
}

/** A file as blocks of a message to Chip. */
export function asBlocks(name: string, reading: Reading, most = 150_000) {
  if (reading.kind === 'image') return [{ type: 'text', text: `The file ${name}:` }, { type: 'image', source: { type: 'base64', media_type: reading.media, data: reading.data } }];
  if (reading.kind === 'scan') return [{ type: 'text', text: `The file ${name}:` }, { type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: reading.data } }];
  const cut = reading.text.length > most ? `${reading.text.slice(0, most)}\n[…the rest is left out: ${reading.text.length - most} more characters…]` : reading.text;
  return [{ type: 'text', text: `<file name="${name.replace(/"/g, "'")}">\n${cut}\n</file>` }];
}
