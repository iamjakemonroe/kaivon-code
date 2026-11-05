import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import type { Heavy } from './readers';
import type { Host, Request } from './tools';

/** The tools' hands: VS Code's workspace, its open files and a shell. */

const SKIP = '**/{node_modules,.git,dist,build,out,.next,.dart_tool,target,vendor,__pycache__,.venv,venv}/**';

const severity = ['Error', 'Warning', 'Info', 'Hint'];

/** Spreadsheets and PDFs have big readers of their own, built beside this file and loaded on first
 * use, so Chip starts fast. */
export const heavy: Heavy = {
  sheet: (bytes, name) => (require(join(__dirname, 'reader-sheet.js')) as { sheetText: Heavy['sheet'] }).sheetText(bytes, name),
  pdf: async (bytes) => ((await import(pathToFileURL(join(__dirname, 'reader-pdf.mjs')).href)) as { pdfText: Heavy['pdf'] }).pdfText(bytes),
};

export class VsCodeHost implements Host {
  readonly heavy = heavy;

  constructor(readonly approve: (request: Request) => Promise<boolean>) {}

  private get root(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('No folder is open. Open your project first.');
    return folder.uri;
  }

  private uri(path: string) {
    return path ? vscode.Uri.joinPath(this.root, path) : this.root;
  }

  private relative(uri: vscode.Uri) {
    return vscode.workspace.asRelativePath(uri, false);
  }

  async read(path: string) {
    const uri = this.uri(path);
    // An open file may have unsaved changes: that's the file as the developer sees it.
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      throw new Error(`${path} doesn't exist.`);
    }
  }

  async readBytes(path: string) {
    try {
      return await vscode.workspace.fs.readFile(this.uri(path));
    } catch {
      throw new Error(`${path} doesn't exist.`);
    }
  }

  async exists(path: string) {
    try {
      await vscode.workspace.fs.stat(this.uri(path));
      return true;
    } catch {
      return false;
    }
  }

  async list(path: string) {
    const entries = await vscode.workspace.fs.readDirectory(this.uri(path));
    return entries
      .filter(([name]) => !/^(node_modules|\.git|dist|build|out|\.next|\.dart_tool|target|__pycache__)$/.test(name))
      .map(([name, type]) => ({ name, dir: (type & vscode.FileType.Directory) !== 0 }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async find(glob: string) {
    const found = await vscode.workspace.findFiles(glob, SKIP, 300);
    return found.map((u) => this.relative(u)).sort();
  }

  private ripgrep() {
    const app = vscode.env.appRoot;
    const name = process.platform === 'win32' ? 'rg.exe' : 'rg';
    return ['node_modules', 'node_modules.asar.unpacked'].map((m) => join(app, m, '@vscode', 'ripgrep', 'bin', name)).find(existsSync);
  }

  async search(query: string, regex: boolean, glob?: string) {
    const rg = this.ripgrep();
    if (rg) return this.searchWith(rg, query, regex, glob);
    // No ripgrep to hand (another editor's layout): slower, the same answers.
    const test = regex ? new RegExp(query) : null;
    const files = await vscode.workspace.findFiles(glob ?? '**/*', SKIP, 1500);
    const out: string[] = [];
    for (const uri of files) {
      if (out.length >= 200) break;
      const lines = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (out.length < 200 && line.length < 2000 && (test ? test.test(line) : line.includes(query))) out.push(`${this.relative(uri)}:${i + 1}: ${line.trim()}`);
      });
    }
    return out;
  }

  private searchWith(rg: string, query: string, regex: boolean, glob?: string): Promise<string[]> {
    const args = ['--line-number', '--no-heading', '--color', 'never', '--max-count', '30', '--max-columns', '300', '--glob', '!{node_modules,.git,dist,build,out}/**'];
    if (!regex) args.push('--fixed-strings');
    if (glob) args.push('--glob', glob);
    args.push('--', query, '.');
    return new Promise((resolve, reject) => {
      const child = spawn(rg, args, { cwd: this.root.fsPath });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('error', reject);
      child.on('close', () => resolve(out.split('\n').filter(Boolean).slice(0, 200).map((l) => l.replace(/^\.\//, ''))));
    });
  }

  async problems(path?: string) {
    const all = path ? ([[this.uri(path), vscode.languages.getDiagnostics(this.uri(path))]] as const) : vscode.languages.getDiagnostics();
    const out: string[] = [];
    for (const [uri, diagnostics] of all) {
      for (const d of diagnostics) {
        if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
        out.push(`${this.relative(uri)}:${d.range.start.line + 1}: ${severity[d.severity]}: ${d.message}${d.source ? ` (${d.source})` : ''}`);
      }
    }
    return out.slice(0, 200);
  }

  async write(path: string, text: string) {
    const uri = this.uri(path);
    if (await this.exists(path)) {
      // Through the editor, so it can be undone and open tabs follow.
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`Couldn't change ${path}.`);
      await doc.save();
    } else {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    }
  }

  run(command: string, timeoutMs: number, signal: AbortSignal, onOutput: (text: string) => void) {
    return new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve, reject) => {
      const child = spawn(command, { cwd: this.root.fsPath, shell: true, detached: process.platform !== 'win32', env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
      let output = '';
      let timedOut = false;
      const take = (d: Buffer) => {
        const text = d.toString();
        output = (output + text).slice(-200_000);
        onOutput(text);
      };
      // The whole process group: `npm test` starts children of its own.
      const kill = () => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
          else child.kill();
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      signal.addEventListener('abort', kill);
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', kill);
        resolve({ code, output, timedOut });
      });
    });
  }
}

/** What Chip should know about where the developer is, sent with each message. */
export function surroundings(): { text: string; files: string[] } {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const editor = vscode.window.activeTextEditor;
  const lines = [`Project: ${folder?.name ?? '(no folder open)'}`, `System: ${process.platform}`];
  const files: string[] = [];
  if (editor) {
    const file = vscode.workspace.asRelativePath(editor.document.uri, false);
    files.push(file);
    lines.push(`Open file: ${file} (${editor.document.languageId}), cursor on line ${editor.selection.active.line + 1}`);
    if (!editor.selection.isEmpty) {
      const selected = editor.document.getText(editor.selection).slice(0, 8000);
      lines.push(`Selected, lines ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}:\n${selected}`);
    }
  }
  return { text: `<surroundings>\n${lines.join('\n')}\n</surroundings>`, files };
}
