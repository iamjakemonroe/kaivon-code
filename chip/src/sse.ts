/** Server-sent events: pieces of a stream in, whole `data:` messages out. */
export class EventParser {
  private buffer = '';

  /** The messages completed by [chunk]; a message split across chunks waits for its end. */
  push(chunk: string): unknown[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const out: unknown[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        out.push(JSON.parse(data));
      } catch {
        // A line that isn't ours: nothing to show for it.
      }
    }
    return out;
  }
}
