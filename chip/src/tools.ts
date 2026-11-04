import type { ApprovalKind } from './protocol';

/** Chip's tools, as they run on the developer's machine. Everything that touches the editor or disk
 * goes through Host, so this logic can be tested on its own. Input is checked here because the API
 * doesn't validate tool inputs that stream as they're written. */

export interface Request {
  kind: ApprovalKind;
  title: string;
  body: string;
  added?: number;
  removed?: number;
  /** For a change: the file and its new text, so the developer can open a full diff. */
  change?: { path: string; before: string; after: string };
}

export interface Host {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ name: string; dir: boolean }[]>;
  find(glob: string): Promise<string[]>;
  search(query: string, regex: boolean, glob?: string): Promise<string[]>;
  problems(path?: string): Promise<string[]>;
  write(path: string, text: string): Promise<void>;
  run(command: string, timeoutMs: number, signal: AbortSignal, onOutput: (text: string) => void): Promise<{ code: number | null; output: string; timedOut: boolean }>;
  approve(request: Request): Promise<boolean>;
}

export interface Outcome {
  /** What goes back to Chip. */
  text: string;
  failed?: boolean;
  /** The developer said no. */
  skipped?: boolean;
  /** One line for the chat, and what's behind it. */
  label: string;
  detail?: string;
}

const MOST_CHARS = 60_000;
const MOST_LINES = 2_000;
const MOST_OUTPUT = 20_000;

type Input = Record<string, unknown>;

class BadInput extends Error {}

const text = (input: Input, key: string): string => {
  const v = input[key];
  if (typeof v !== 'string') throw new BadInput(`${key} must be text`);
  return v;
};
const optional = <T>(input: Input, key: string, type: 'string' | 'number' | 'boolean'): T | undefined => {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== type) throw new BadInput(`${key} must be a ${type}`);
  return v as T;
};

/** [path] inside the project, as a clean relative path. Anything that leaves the project is refused:
 * Chip only works on what the developer opened. */
export function safePath(path: string): string {
  const clean = path.trim().replace(/\\/g, '/');
  if (!clean || clean === '.') return '';
  if (clean.startsWith('/') || /^[a-z]:/i.test(clean) || clean.startsWith('~')) throw new BadInput(`${path} is outside the project: use a path relative to its root`);
  const parts: string[] = [];
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new BadInput(`${path} is outside the project`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** Files that hold secrets: Chip asks before reading one, since what it reads leaves the machine. */
export const looksSecret = (path: string) => /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|id_(rsa|ed25519|ecdsa)|credentials(\.json)?|.*\.(pem|key|p12|pfx))$/i.test(path) && !/\.(example|sample|template)$/i.test(path);

/** [before] with [oldText] replaced, or why it can't be. */
export function applyEdit(before: string, oldText: string, newText: string, all: boolean): { after: string } | { error: string } {
  if (!oldText) return { error: 'old_text is empty. To create a file, use write_file.' };
  // Files with Windows line endings: Chip's text uses \n.
  const crlf = before.includes('\r\n');
  const from = crlf ? oldText.replace(/\r?\n/g, '\r\n') : oldText;
  const to = crlf ? newText.replace(/\r?\n/g, '\r\n') : newText;
  const count = before.split(from).length - 1;
  if (count === 0) return { error: 'old_text was not found. Read the file again and copy the text exactly, including whitespace.' };
  if (count > 1 && !all) return { error: `old_text appears ${count} times. Add more surrounding text so it's unique, or set replace_all.` };
  return { after: all ? before.split(from).join(to) : before.replace(from, () => to) };
}

/** The changed lines of a file, for the chat: what's between the unchanged start and end. */
export function changedLines(before: string, after: string, most = 80): { body: string; added: number; removed: number } {
  const a = before === '' ? [] : before.split(/\r?\n/);
  const b = after === '' ? [] : after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const removed = a.slice(start, a.length - end);
  const added = b.slice(start, b.length - end);
  const lines = [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
  const shown = lines.length > most ? [...lines.slice(0, most), ` … ${lines.length - most} more lines`] : lines;
  return { body: shown.join('\n'), added: added.length, removed: removed.length };
}

const tail = (s: string, most: number) => (s.length > most ? `[…the first ${s.length - most} characters are left out…]\n${s.slice(-most)}` : s);

async function readFile(input: Input, host: Host): Promise<Outcome> {
  const path = safePath(text(input, 'path'));
  const first = optional<number>(input, 'start_line', 'number');
  const last = optional<number>(input, 'end_line', 'number');
  if (looksSecret(path) && !(await host.approve({ kind: 'secret', title: `Let Chip read ${path}?`, body: 'This file may hold secrets. What Chip reads is sent to its servers.' }))) {
    return { text: `The developer chose not to share ${path}.`, skipped: true, label: `Kept ${path} private` };
  }
  const lines = (await host.read(path)).split(/\r?\n/);
  const from = Math.max((first ?? 1) - 1, 0);
  const to = Math.min(last ?? from + MOST_LINES, lines.length, from + MOST_LINES);
  let body = lines.slice(from, to).map((line, i) => `${from + i + 1}\t${line}`).join('\n');
  if (body.length > MOST_CHARS) body = `${body.slice(0, MOST_CHARS)}\n[…cut here: read a smaller range…]`;
  const rest = to < lines.length ? `\n[…${lines.length - to} more lines: read on with start_line ${to + 1}…]` : '';
  return { text: `${body}${rest}`, label: `Read ${path}${first ? ` (lines ${from + 1}–${to})` : ''}` };
}

async function change(path: string, before: string, after: string, exists: boolean, host: Host): Promise<Outcome> {
  if (before === after && exists) return { text: 'That changes nothing.', failed: true, label: `No change to ${path}` };
  const lines = changedLines(before, after);
  const ok = await host.approve({
    kind: 'edit',
    title: exists ? path : `New file: ${path}`,
    body: lines.body,
    added: lines.added,
    removed: lines.removed,
    change: { path, before, after },
  });
  if (!ok) return { text: `The developer declined this change to ${path}.`, skipped: true, label: `Skipped ${path}` };
  await host.write(path, after);
  return { text: `Saved ${path} (+${lines.added} −${lines.removed}).`, label: `${exists ? 'Edited' : 'Created'} ${path}`, detail: `+${lines.added} −${lines.removed}` };
}

async function editFile(input: Input, host: Host): Promise<Outcome> {
  const path = safePath(text(input, 'path'));
  const before = await host.read(path);
  const result = applyEdit(before, text(input, 'old_text'), text(input, 'new_text'), optional<boolean>(input, 'replace_all', 'boolean') ?? false);
  if ('error' in result) return { text: result.error, failed: true, label: `Couldn't edit ${path}` };
  return change(path, before, result.after, true, host);
}

async function writeFile(input: Input, host: Host): Promise<Outcome> {
  const path = safePath(text(input, 'path'));
  if (!path) throw new BadInput('path is empty');
  const exists = await host.exists(path);
  return change(path, exists ? await host.read(path) : '', text(input, 'content'), exists, host);
}

async function runCommand(input: Input, host: Host, signal: AbortSignal, onOutput: (text: string) => void): Promise<Outcome> {
  const command = text(input, 'command').trim();
  if (!command) throw new BadInput('command is empty');
  const seconds = Math.min(Math.max(optional<number>(input, 'timeout_seconds', 'number') ?? 120, 1), 600);
  if (!(await host.approve({ kind: 'command', title: 'Run this command?', body: command }))) {
    return { text: 'The developer declined this command.', skipped: true, label: `Skipped: ${command}` };
  }
  const result = await host.run(command, seconds * 1000, signal, onOutput);
  const output = tail(result.output, MOST_OUTPUT);
  const end = result.timedOut ? `Stopped after ${seconds} seconds.` : `Exit code ${result.code}.`;
  return { text: `${output}\n${end}`.trim(), failed: result.timedOut || result.code !== 0, label: command, detail: output };
}

/** Runs one tool call. Never throws: what went wrong goes back to Chip, which can usually fix it. */
export async function runTool(name: string, input: unknown, host: Host, signal: AbortSignal, onOutput: (text: string) => void = () => {}): Promise<Outcome> {
  try {
    if (typeof input !== 'object' || input === null) throw new BadInput('input must be an object');
    const i = input as Input;
    switch (name) {
      case 'read_file':
        return await readFile(i, host);
      case 'list_files': {
        const path = safePath(optional<string>(i, 'path', 'string') ?? '');
        const entries = await host.list(path);
        return { text: entries.map((e) => `${e.name}${e.dir ? '/' : ''}`).join('\n') || '(empty)', label: `Listed ${path || 'the project'}` };
      }
      case 'find_files': {
        const glob = text(i, 'glob');
        const found = await host.find(glob);
        return { text: found.join('\n') || 'No files match.', label: `Found ${found.length} file${found.length === 1 ? '' : 's'} for ${glob}` };
      }
      case 'search_text': {
        const query = text(i, 'query');
        const found = await host.search(query, optional<boolean>(i, 'regex', 'boolean') ?? false, optional<string>(i, 'glob', 'string'));
        return { text: found.join('\n') || 'No matches.', label: `Searched for “${query}”`, detail: `${found.length} match${found.length === 1 ? '' : 'es'}` };
      }
      case 'get_problems': {
        const path = optional<string>(i, 'path', 'string');
        const found = await host.problems(path === undefined ? undefined : safePath(path));
        return { text: found.join('\n') || 'No problems.', label: `Checked for problems`, detail: `${found.length} found` };
      }
      case 'edit_file':
        return await editFile(i, host);
      case 'write_file':
        return await writeFile(i, host);
      case 'run_command':
        return await runCommand(i, host, signal, onOutput);
      default:
        return { text: `There's no tool called ${name}.`, failed: true, label: name };
    }
  } catch (e) {
    if (e instanceof BadInput) return { text: JSON.stringify({ INVALID_JSON: e.message, input }), failed: true, label: `${name}: ${e.message}` };
    return { text: (e as Error).message, failed: true, label: `${name}: ${(e as Error).message}` };
  }
}
