import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { asBlocks, MOST_MEDIA_BYTES, readAny, type Heavy, type Reading } from '../src/readers';
import { pdfText } from '../src/readers/pdf';
import { sheetText } from '../src/readers/sheet';
import { runTool, type Host } from '../src/tools';

const heavy: Heavy = { sheet: sheetText, pdf: pdfText };
const read = (name: string, bytes: Uint8Array) => readAny(name, bytes, heavy);
const textOf = (r: Reading) => ('text' in r ? r.text : '');

function book(bookType: XLSX.BookType) {
  const ws = XLSX.utils.aoa_to_sheet([['Metres lost', 3, { t: 'n', v: 6, f: 'B1*2' }], ['Coast', 'North']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Erosion');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer);
}

describe('every spreadsheet', () => {
  for (const [ext, type] of [['xlsx', 'xlsx'], ['xlsm', 'xlsm'], ['xlsb', 'xlsb'], ['xls', 'biff8'], ['ods', 'ods']] as const) {
    it(`.${ext}: sheets, cells and formulas`, async () => {
      const r = await read(`data.${ext}`, book(type));
      expect(r.kind).toBe('extracted');
      expect(textOf(r)).toContain('## Sheet "Erosion"');
      expect(textOf(r)).toContain('A1: Metres lost');
      // The library that makes these test files can't write formulas into .xlsb or .xls.
      expect(textOf(r)).toMatch(ext === 'xlsb' || ext === 'xls' ? /C1: 6/ : /C1: =.*B1\*2 → 6/);
    });
  }

  it('reads .csv as the text it is', async () => {
    expect(await read('a.csv', strToU8('a,b\n1,2\n'))).toMatchObject({ kind: 'plain', text: 'a,b\n1,2\n' });
  });

  it('goes by what a file is, not what it’s called', async () => {
    expect(textOf(await read('renamed.txt', book('xlsx')))).toContain('Metres lost');
    expect(textOf(await read('no-extension', book('xlsx')))).toContain('Metres lost');
  });
});

describe('every document', () => {
  it('Word, with tables and comments', async () => {
    const zip = zipSync({
      'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>B</w:t></w:p></w:tc></w:tr></w:tbl></w:document>'),
      'word/comments.xml': strToU8('<w:comments><w:p><w:t>Check this</w:t></w:p></w:comments>'),
    });
    const text = textOf(await read('a.docx', zip));
    expect(text).toContain('Hello & welcome');
    expect(text).toContain('A');
    expect(text).toContain('## Comments\nCheck this');
  });

  it('PowerPoint, slides in order, with notes', async () => {
    const zip = zipSync({
      'ppt/presentation.xml': strToU8('<p/>'),
      'ppt/slides/slide10.xml': strToU8('<a:p><a:t>Tenth</a:t></a:p>'),
      'ppt/slides/slide2.xml': strToU8('<a:p><a:t>Second</a:t></a:p>'),
      'ppt/notesSlides/notesSlide2.xml': strToU8('<a:p><a:t>Say this</a:t></a:p>'),
    });
    const text = textOf(await read('a.pptx', zip));
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Tenth'));
    expect(text).toContain('Notes: Say this');
  });

  it('OpenDocument text and EPUB', async () => {
    expect(textOf(await read('a.odt', zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8('<text:p>Open words</text:p>') })))).toBe('Open words');
    expect(textOf(await read('a.epub', zipSync({ 'META-INF/container.xml': strToU8('<c/>'), 'one.xhtml': strToU8('<p>A chapter</p>') })))).toBe('A chapter');
  });

  it('rich text and notebooks', async () => {
    expect(textOf(await read('a.rtf', strToU8('{\\rtf1\\ansi Hello\\par world}')))).toContain('Hello');
    const notebook = JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(1)'], outputs: [] }] });
    expect(textOf(await read('a.ipynb', strToU8(notebook)))).toContain('print(1)');
  });

  const pdf = (content: string) => {
    const stream = content;
    return strToU8(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
`);
  };

  it('a PDF with text is read as text', async () => {
    const r = await read('a.pdf', pdf('BT /F1 14 Tf 20 100 Td (The quarterly coastal erosion report for the northern shoreline) Tj ET'));
    expect(r.kind).toBe('extracted');
    expect(textOf(r)).toContain('## Page 1');
    expect(textOf(r)).toContain('quarterly coastal erosion');
  });

  it('a PDF with no text goes to Chip to look at, like a scan', async () => {
    const r = await read('scan.pdf', pdf('0 0 100 100 re f'));
    expect(r.kind).toBe('scan');
    expect(asBlocks('scan.pdf', r)[1]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
  });
});

describe('images and archives', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('images go to Chip to look at', async () => {
    const r = await read('a.png', png);
    expect(r).toMatchObject({ kind: 'image', media: 'image/png' });
    expect(asBlocks('a.png', r)[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(await read('a.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toMatchObject({ media: 'image/jpeg' });
    expect(await read('a.gif', strToU8('GIF89a...'))).toMatchObject({ media: 'image/gif' });
    expect(await read('a.webp', strToU8('RIFF....WEBPVP8 '))).toMatchObject({ media: 'image/webp' });
  });

  it('says so when an image is too big to send', async () => {
    const big = new Uint8Array(MOST_MEDIA_BYTES + 1);
    big.set(png);
    const r = await read('big.png', big);
    expect(r.kind).toBe('extracted');
    expect(textOf(r)).toContain('too big');
  });

  it('lists what’s in a zip or a tar, and opens a gzip', async () => {
    expect(textOf(await read('a.zip', zipSync({ 'src/a.ts': strToU8('x'), 'b.txt': strToU8('y') })))).toContain('src/a.ts');
    const tar = new Uint8Array(1024);
    tar.set(strToU8('notes/todo.txt'), 0);
    tar.set(strToU8('00000000000\0'), 124);
    tar.set(strToU8('ustar'), 257);
    expect(textOf(await read('a.tar', tar))).toContain('notes/todo.txt');
    expect(textOf(await read('a.tar.gz', gzipSync(tar)))).toContain('notes/todo.txt');
    expect(await read('a.log.gz', gzipSync('hello there'))).toMatchObject({ kind: 'plain', text: 'hello there' });
  });
});

describe('text in any encoding', () => {
  it('UTF-8, with and without a byte order mark', async () => {
    expect(await read('a.txt', strToU8('naïve ₦'))).toMatchObject({ kind: 'plain', text: 'naïve ₦' });
    expect(await read('a.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toMatchObject({ text: 'hi' });
  });

  it('UTF-16 and old Windows text', async () => {
    expect(await read('a.txt', new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toMatchObject({ kind: 'plain', text: 'hi' });
    expect(await read('a.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b]))).toMatchObject({ kind: 'plain', text: 'café ok' });
  });

  it('an empty file is an empty file', async () => {
    expect(await read('a', new Uint8Array())).toMatchObject({ kind: 'plain', text: '' });
  });
});

describe('no file is a dead end', () => {
  it('names what it is, and finds any text inside', async () => {
    const r = await read('data.db', new Uint8Array([...strToU8('SQLite format 3\0'), 1, 2, 0, 0, ...strToU8('CREATE TABLE users (id)')]));
    expect(textOf(r)).toContain('an SQLite database');
    expect(textOf(r)).toContain('CREATE TABLE users');
  });

  it('a binary it doesn’t know, a damaged zip, an old Word file', async () => {
    const random = Uint8Array.from({ length: 4000 }, (_, i) => (i * 37) % 256);
    expect(textOf(await read('x.bin', random))).toContain('a binary file');
    expect(textOf(await read('x.zip', new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])))).toContain('couldn\'t be opened');
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...strToU8('Some old report text')]);
    expect(textOf(await read('old.doc', doc))).toContain('Some old report text');
  });

  it('video and programs say what they are, without paying for noise', async () => {
    const video = new Uint8Array([0, 0, 0, 24, ...strToU8('ftypisom'), ...strToU8('looks-like-text-but-is-noise')]);
    const text = textOf(await read('clip.mp4', video));
    expect(text).toContain('an MP4 or MOV video');
    expect(text).not.toContain('noise');
  });

  it('a damaged spreadsheet says so instead of crashing', async () => {
    const zip = zipSync({ 'xl/workbook.xml': strToU8('not really a workbook') });
    await expect(read('bad.xlsx', zip)).resolves.toBeTruthy();
  });
});

describe('Chip’s tools with these files', () => {
  const host = (files: Record<string, Uint8Array>): Host =>
    ({
      heavy,
      read: async (p: string) => new TextDecoder().decode(files[p]),
      readBytes: async (p: string) => files[p],
      exists: async (p: string) => p in files,
      write: async (p: string, t: string) => void (files[p] = strToU8(t)),
      approve: async () => true,
    }) as unknown as Host;
  const never = new AbortController().signal;

  it('reads a workbook in the project', async () => {
    const r = await runTool('read_file', { path: 'data.xlsm' }, host({ 'data.xlsm': book('xlsm') }), never);
    expect(r.text).toContain('Metres lost');
    expect(r.text).toContain('Line numbers are for this reading');
    expect(r.detail).toBe('spreadsheet');
  });

  it('looks at an image', async () => {
    const r = await runTool('read_file', { path: 'a.png' }, host({ 'a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]) }), never);
    expect(r.blocks?.[1]).toMatchObject({ type: 'image' });
  });

  it('won’t overwrite a binary file with text', async () => {
    const files = { 'data.xlsx': book('xlsx') };
    const before = files['data.xlsx'];
    for (const [tool, input] of [['write_file', { path: 'data.xlsx', content: 'oops' }], ['edit_file', { path: 'data.xlsx', old_text: 'a', new_text: 'b' }]] as const) {
      const r = await runTool(tool, input, host(files), never);
      expect(r.failed, tool).toBe(true);
    }
    expect(files['data.xlsx']).toBe(before);
  });
});
