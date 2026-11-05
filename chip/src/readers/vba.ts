/** The macros (VBA code) in an Excel file (.xlsm), read as text for Chip: nothing is ever run.
 * They're in xl/vbaProject.bin, a Compound File (MS-CFB) holding the project's "dir" stream
 * (which modules there are, and where each one's code starts) and a stream per module, all
 * compressed as MS-OVBA describes. */

export interface VbaModule {
  name: string;
  code: string;
}

const END = 0xfffffffa; // Sector numbers from here up mark the end of a chain, or no sector.

/** The streams in a Compound File, by their path in lower case ("vba/dir"). */
export function compoundFile(bin: Uint8Array): Map<string, Uint8Array> | null {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (bin.length < 512 || view.getUint32(0, true) !== 0xe011cfd0 || view.getUint32(4, true) !== 0xe11ab1a1) return null;
  const u32 = (at: number) => (at + 4 <= bin.length ? view.getUint32(at, true) : END);
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSize = 1 << view.getUint16(32, true);
  const fatCount = u32(44);
  const cutoff = u32(56);

  // The FAT's own sectors: the first 109 listed in the header, the rest in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(u32(76 + i * 4));
  const perDifat = sectorSize / 4 - 1;
  for (let next = u32(68), n = u32(72); n > 0 && next < END && fatSectors.length < fatCount; n--) {
    const base = (next + 1) * sectorSize;
    for (let i = 0; i < perDifat && fatSectors.length < fatCount; i++) fatSectors.push(u32(base + i * 4));
    next = u32(base + perDifat * 4);
  }
  const table = (sectors: number[]): number[] => {
    const out: number[] = [];
    for (const s of sectors) for (let i = 0; i < sectorSize / 4; i++) out.push(u32((s + 1) * sectorSize + i * 4));
    return out;
  };
  const fat = table(fatSectors);
  const chain = (start: number, links: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s < END && s < links.length && !seen.has(s); s = links[s]) {
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const read = (start: number, size = Infinity): Uint8Array => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(Math.min(size, sectors.length * sectorSize));
    sectors.forEach((s, i) => {
      const from = (s + 1) * sectorSize;
      const piece = bin.subarray(from, Math.min(from + sectorSize, bin.length));
      if (i * sectorSize < out.length) out.set(piece.subarray(0, out.length - i * sectorSize), i * sectorSize);
    });
    return out;
  };

  // The directory: 128 bytes an entry, a red-black tree of each storage's children.
  const dir = read(u32(48));
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = Array.from({ length: Math.floor(dir.length / 128) }, (_, i) => {
    const at = i * 128;
    const nameBytes = Math.max(0, Math.min(64, dv.getUint16(at + 64, true)) - 2);
    return {
      name: new TextDecoder('utf-16le').decode(dir.subarray(at, at + nameBytes)),
      type: dir[at + 66],
      left: dv.getUint32(at + 68, true),
      right: dv.getUint32(at + 72, true),
      child: dv.getUint32(at + 76, true),
      start: dv.getUint32(at + 116, true),
      size: dv.getUint32(at + 120, true),
    };
  });
  const root = entries[0];
  if (!root) return null;
  // Small streams live in the mini stream (the root's), in 64-byte sectors with their own FAT.
  const mini = read(root.start, root.size);
  const miniFat = table(chain(u32(60), fat));
  const readMini = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    chain(start, miniFat).forEach((s, i) => {
      if (i * miniSize < size) out.set(mini.subarray(s * miniSize, s * miniSize + Math.min(miniSize, size - i * miniSize)), i * miniSize);
    });
    return out;
  };

  const files = new Map<string, Uint8Array>();
  const seen = new Set<number>();
  const walk = (id: number, prefix: string) => {
    if (id >= entries.length || seen.has(id)) return;
    seen.add(id);
    const e = entries[id];
    walk(e.left, prefix);
    walk(e.right, prefix);
    const path = prefix + e.name.toLowerCase();
    if (e.type === 2) files.set(path, e.size < cutoff ? readMini(e.start, e.size) : read(e.start, e.size));
    else if (e.type === 1) walk(e.child, `${path}/`);
  };
  walk(root.child, '');
  return files;
}

/** Decompresses an MS-OVBA compressed container, from [from]. */
export function decompress(data: Uint8Array, from = 0): Uint8Array {
  if (data[from] !== 1) throw new Error('Not VBA’s compression.');
  const out: number[] = [];
  let at = from + 1;
  while (at + 2 <= data.length) {
    const header = data[at] | (data[at + 1] << 8);
    const end = Math.min(data.length, at + (header & 0x0fff) + 3);
    at += 2;
    const chunkStart = out.length;
    if (!(header & 0x8000)) {
      // A chunk stored as it is: 4096 bytes.
      for (let i = 0; i < 4096 && at < data.length; i++) out.push(data[at++]);
      continue;
    }
    while (at < end) {
      const flags = data[at++];
      for (let bit = 0; bit < 8 && at < end; bit++) {
        if (!((flags >> bit) & 1)) {
          out.push(data[at++]);
          continue;
        }
        if (at + 2 > end) {
          at = end;
          break;
        }
        // A copy token: how far back and how long, split by how far into the chunk we are.
        const token = data[at] | (data[at + 1] << 8);
        at += 2;
        let bits = 4;
        while (1 << bits < out.length - chunkStart) bits++;
        const length = (token & (0xffff >> bits)) + 3;
        const source = out.length - ((token >> (16 - bits)) + 1);
        if (source < chunkStart) throw new Error('Broken VBA compression.');
        for (let i = 0; i < length; i++) out.push(out[source + i]);
      }
    }
  }
  return Uint8Array.from(out);
}

const decoderFor = (codepage: number): TextDecoder => {
  const label =
    codepage === 65001 ? 'utf-8'
    : codepage === 932 ? 'shift_jis'
    : codepage === 936 ? 'gbk'
    : codepage === 949 ? 'euc-kr'
    : codepage === 950 ? 'big5'
    : codepage === 10000 ? 'macintosh'
    : `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
};

/** The modules in a vbaProject.bin with code in them (beyond VBA's own Attribute lines). */
export function vbaModules(bin: Uint8Array): VbaModule[] {
  const files = compoundFile(bin);
  const dirStream = files?.get('vba/dir');
  if (!files || !dirStream) return [];
  const dir = decompress(dirStream);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const utf16 = new TextDecoder('utf-16le');
  let decoder = decoderFor(1252);
  const found: { name: string; stream: string; offset: number }[] = [];
  let current: (typeof found)[number] | null = null;
  for (let at = 0; at + 6 <= dir.length; ) {
    const id = dv.getUint16(at, true);
    // PROJECTVERSION says its size is 4, but 6 bytes follow.
    const size = id === 0x0009 ? 6 : dv.getUint32(at + 2, true);
    const body = dir.subarray(at + 6, at + 6 + size);
    at += 6 + size;
    if (id === 0x0003 && body.length >= 2) decoder = decoderFor(body[0] | (body[1] << 8));
    else if (id === 0x0019) found.push((current = { name: decoder.decode(body), stream: decoder.decode(body), offset: 0 }));
    else if (current && id === 0x0047) current.name = utf16.decode(body);
    else if (current && id === 0x001a) current.stream = decoder.decode(body);
    else if (current && id === 0x0032) current.stream = utf16.decode(body);
    else if (current && id === 0x0031 && body.length >= 4) current.offset = new DataView(body.buffer, body.byteOffset, 4).getUint32(0, true);
  }
  const modules: VbaModule[] = [];
  for (const m of found) {
    const stream = files.get(`vba/${m.stream.toLowerCase()}`);
    if (!stream || m.offset >= stream.length) continue;
    try {
      const code = decoder
        .decode(decompress(stream, m.offset))
        .split(/\r\n|\r|\n/)
        .filter((line) => !/^Attribute VB_/.test(line))
        .join('\n')
        .trim();
      if (code && !/^(Option \w+(\s+\w+)?\s*)+$/i.test(code)) modules.push({ name: m.name, code });
    } catch {
      // A module we can't read is left out.
    }
  }
  return modules;
}
