/** Rich text and notebooks as plain text, for Chip. */

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'expandedcolortbl', 'shppict', 'nonshppict']);
const RTF_CHARS: Record<string, string> = { par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: '\t', tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };

export function rtfText(rtf: string): string {
  const cp1252 = new TextDecoder('windows-1252');
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pending = 0; // Fallback characters still to drop after a \u.
  let out = '';
  const token = /\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|([^\\{}\r\n]+)/gi;
  for (const [, word, arg, hex, symbol, brace, text] of rtf.matchAll(token)) {
    if (brace) {
      pending = 0;
      if (brace === '{') stack.push({ skip, uc });
      else ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
    } else if (symbol) {
      pending = 0;
      if (symbol === '*') skip = true;
      else if (!skip && symbol === '~') out += ' ';
      else if (!skip && '{}\\'.includes(symbol)) out += symbol;
      else if (!skip && symbol === '\n') out += '\n';
    } else if (word) {
      pending = 0;
      if (RTF_SKIP.has(word)) skip = true;
      else if (skip) continue;
      else if (word in RTF_CHARS) out += RTF_CHARS[word];
      else if (word === 'uc') uc = Number(arg ?? 1);
      else if (word === 'u') {
        const code = Number(arg ?? 0);
        out += String.fromCharCode(code < 0 ? code + 0x10000 : code);
        pending = uc;
      }
    } else if (hex) {
      if (pending > 0) pending--;
      else if (!skip) out += cp1252.decode(new Uint8Array([parseInt(hex, 16)]));
    } else if (text) {
      let t = text;
      if (pending > 0) {
        const drop = Math.min(pending, t.length);
        t = t.slice(drop);
        pending -= drop;
      }
      if (!skip) out += t;
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type NotebookCell = { cell_type?: string; source?: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[] };

/** A Jupyter notebook (.ipynb): its cells in order, with their text output. */
export function notebookText(json: string): string {
  let nb: { cells?: NotebookCell[]; worksheets?: { cells?: NotebookCell[] }[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } };
  try {
    nb = JSON.parse(json);
  } catch {
    throw new Error('That notebook couldn’t be opened.');
  }
  const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''));
  const language = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? '';
  const cells = nb.cells ?? nb.worksheets?.[0]?.cells ?? [];
  return cells
    .map((cell, i) => {
      const source = join(cell.source).trim();
      if (cell.cell_type !== 'code') return source;
      const outputs = (cell.outputs ?? [])
        .map((o) => (o.ename ? `${o.ename}: ${o.evalue ?? ''}` : join(o.text ?? o.data?.['text/plain'])))
        .map((t) => t.trim())
        .filter(Boolean);
      return [`In [${i + 1}]:`, '```' + language, source, '```', ...(outputs.length ? ['Out:', outputs.join('\n')] : [])].join('\n');
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
