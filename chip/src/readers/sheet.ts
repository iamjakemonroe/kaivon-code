import * as XLSX from 'xlsx';
import { vbaModules } from './vba';

/** Every spreadsheet as text for Chip: .xlsx, .xlsm, .xlsb, .xls, .ods, .numbers and more. Each row is
 * one line, with formulas and their results, then named ranges and the code of any macros. Macros are
 * read as text and never run. Loaded only when a spreadsheet is opened. */

export function sheetText(bytes: Uint8Array, name = ''): string {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, bookVBA: true, sheetStubs: false });
  } catch (e) {
    const message = (e as Error).message;
    if (/password|encrypt/i.test(message)) return `${name} is password-protected, so Chip can't open it. Remove the password in Excel and try again.`;
    return `${name} couldn't be opened as a spreadsheet: ${message}`;
  }
  const out: string[] = [];
  const states = book.Workbook?.Sheets ?? [];
  book.SheetNames.forEach((sheet, index) => {
    const ws = book.Sheets[sheet];
    const hidden = states[index]?.Hidden ? ' (hidden)' : '';
    out.push(`## Sheet "${sheet}"${hidden}${ws?.['!ref'] ? ` ${ws['!ref']}` : ' (empty)'}`);
    if (!ws) return;
    const rows = new Map<number, [number, string][]>();
    for (const key of Object.keys(ws)) {
      if (key[0] === '!') continue;
      const cell = ws[key] as XLSX.CellObject;
      const at = XLSX.utils.decode_cell(key);
      const shown = cell.w ?? (cell.v === undefined ? '' : String(cell.v));
      const text = cell.f ? `=${cell.f} → ${shown}` : shown;
      if (!text) continue;
      const row = rows.get(at.r) ?? [];
      row.push([at.c, `${key}: ${text.replace(/\s*\n\s*/g, ' ')}`]);
      rows.set(at.r, row);
    }
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      out.push(rows.get(r)!.sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(' | '));
    }
    out.push('');
  });
  const names = (book.Workbook?.Names ?? []).filter((n) => n.Name && !n.Name.startsWith('_xlnm'));
  if (names.length) out.push('## Named ranges', ...names.map((n) => `${n.Name}: ${n.Ref}`), '');
  if (book.vbaraw) {
    try {
      const modules = vbaModules(book.vbaraw as Uint8Array);
      for (const m of modules) out.push(`## Macro module "${m.name}"`, m.code, '');
      if (!modules.length) out.push('## Macros', 'This file has a macro project, but its code could not be read.');
    } catch {
      out.push('## Macros', 'This file has a macro project, but its code could not be read.');
    }
  }
  return out.join('\n').trim();
}
