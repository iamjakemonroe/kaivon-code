import * as vscode from 'vscode';
import { Agent, StepError, type AgentView, type StepEvent } from './agent';
import type { ChipApi, ServerEvent } from './api';
import { surroundings, VsCodeHost } from './host';
import type { FromPanel, Model, PanelState, ToolStatus, ToPanel } from './protocol';
import type { Request } from './tools';

/** The chat panel: shows the conversation, asks for approvals, and owns the sign-in steps. */

const SCHEME = 'chip-change';

/** The two sides of a change Chip proposes, for VS Code's diff view. */
export class ChangeDocuments implements vscode.TextDocumentContentProvider {
  readonly texts = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri) {
    return this.texts.get(uri.path) ?? '';
  }

  put(key: string, text: string) {
    this.texts.set(key, text);
    return vscode.Uri.from({ scheme: SCHEME, path: key });
  }
}

export const changeScheme = SCHEME;

export class ChipView implements vscode.WebviewViewProvider, AgentView {
  private view: vscode.WebviewView | null = null;
  private model: Model;
  private agent: Agent;
  private readonly host: VsCodeHost;
  private readonly waiting = new Map<string, { resolve: (ok: boolean) => void; change?: Request['change'] }>();
  private allowEdits = false;
  private approvals = 0;
  private tier: string | null = null;
  private left: string | null = null;
  private email: string | null = null;
  private signedIn = false;
  private queued: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ChipApi,
    private readonly documents: ChangeDocuments,
  ) {
    this.model = context.globalState.get<Model>('chip.model') ?? 'best';
    this.host = new VsCodeHost((r) => this.approve(r));
    this.agent = this.newAgent();
  }

  get currentModel() {
    return this.model;
  }

  private newAgent() {
    return new Agent(
      (messages, model, onEvent, signal) => this.api.step(messages, model, (e) => this.forward(e, onEvent), signal),
      this.host,
      this,
    );
  }

  private forward(e: ServerEvent, onEvent: (e: StepEvent) => void) {
    if (e.t === 'think' || e.t === 'text' || e.t === 'tool') onEvent(e);
    else if (e.t === 'start' && e.note === 'best_used') this.note('You’ve used today’s best model, so this is Chip Fast.');
    else if (e.t === 'start' && e.note === 'pro' && this.model === 'best') {
      this.setModel('fast');
      this.note('Chip’s best model comes with Pro. This is Chip Fast.');
    }
  }

  private post(message: ToPanel) {
    void this.view?.webview.postMessage(message);
  }

  turn() {
    this.post({ type: 'turn' });
  }
  think(text: string) {
    this.post({ type: 'think', text });
  }
  text(text: string) {
    this.post({ type: 'text', text });
  }
  tool(id: string, label: string, status: ToolStatus, detail?: string) {
    this.post({ type: 'tool', id, label, status, detail });
  }
  note(text: string, tone?: 'warn') {
    this.post({ type: 'note', text, tone });
  }

  private setModel(model: Model) {
    this.model = model;
    void this.context.globalState.update('chip.model', model);
    this.pushState();
  }

  private pushState() {
    const state: PanelState = { signedIn: this.signedIn, email: this.email, model: this.model, tier: this.tier, left: this.left };
    this.post({ type: 'state', state });
  }

  /** Reads who's signed in and what's left today. */
  async refreshAccount() {
    try {
      const me = await this.api.me();
      this.signedIn = true;
      this.email = typeof me.email === 'string' ? me.email : null;
      this.tier = typeof me.tier === 'string' ? me.tier : null;
      const fast = me.fast as { used?: number; cap?: number } | undefined;
      this.left = fast?.cap ? `${Math.max(0, Math.round((1 - (fast.used ?? 0) / fast.cap) * 100))}% of today’s Chip Fast left` : null;
    } catch (e) {
      if (e instanceof StepError && e.why === 'account') {
        this.signedIn = false;
        this.email = null;
        this.post({ type: 'signin', step: 'email' });
      }
    }
    this.pushState();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist, media] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; img-src ${view.webview.cspSource} data:; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><title>Chip</title></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m: FromPanel) => void this.receive(m));
  }

  private async receive(m: FromPanel) {
    switch (m.type) {
      case 'ready':
        this.pushState();
        this.sendContext();
        await this.refreshAccount();
        if (this.queued) this.prefill(this.queued);
        break;
      case 'send':
        await this.send(m.text);
        break;
      case 'stop':
        this.agent.stop();
        for (const [id, wait] of this.waiting) {
          wait.resolve(false);
          this.post({ type: 'approved', id, ok: false });
        }
        this.waiting.clear();
        break;
      case 'new':
        this.newChat();
        break;
      case 'answer': {
        if (m.always) this.allowEdits = true;
        const wait = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        this.post({ type: 'approved', id: m.id, ok: m.ok });
        wait?.resolve(m.ok);
        break;
      }
      case 'diff':
        await this.showDiff(m.id);
        break;
      case 'open':
        await this.open(m.path, m.line);
        break;
      case 'model':
        this.setModel(m.model);
        break;
      case 'insert':
        await vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(m.code.replace(/[$}\\]/g, '\\$&')));
        break;
      case 'otp':
        await this.sendCode(m.email);
        break;
      case 'verify':
        await this.verify(m.email, m.code);
        break;
      case 'restart-signin':
        this.post({ type: 'signin', step: 'email' });
        break;
      case 'signout':
        await vscode.commands.executeCommand('chip.signOut');
        break;
    }
  }

  private async sendCode(email: string) {
    this.post({ type: 'signin', step: 'email', email, busy: true });
    try {
      await this.api.sendCode(email);
      this.post({ type: 'signin', step: 'code', email });
    } catch (e) {
      this.post({ type: 'signin', step: 'email', email, error: (e as Error).message });
    }
  }

  private async verify(email: string, code: string) {
    this.post({ type: 'signin', step: 'code', email, busy: true });
    try {
      await this.api.verify(email, code);
      await this.refreshAccount();
    } catch (e) {
      this.post({ type: 'signin', step: 'code', email, error: (e as Error).message });
    }
  }

  async signedOut() {
    this.signedIn = false;
    this.email = null;
    this.tier = null;
    this.left = null;
    this.newChat();
    this.pushState();
    this.post({ type: 'signin', step: 'email' });
  }

  newChat() {
    this.agent.stop();
    this.agent = this.newAgent();
    this.allowEdits = false;
    this.post({ type: 'reset' });
  }

  /** Puts [text] in the box, ready to send (the panel may still be opening). */
  prefill(text: string) {
    if (!this.view) {
      this.queued = text;
      return;
    }
    this.queued = null;
    this.post({ type: 'prefill', text });
  }

  sendContext() {
    const editor = vscode.window.activeTextEditor;
    const file = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : null;
    const sel = editor && !editor.selection.isEmpty ? editor.selection : null;
    this.post({ type: 'context', file, lines: sel ? `${sel.start.line + 1}–${sel.end.line + 1}` : null });
  }

  async send(text: string) {
    const clean = text.trim();
    if (!clean || this.agent.busy) return;
    const around = surroundings();
    this.post({ type: 'user', text: clean, files: around.files });
    this.post({ type: 'busy', busy: true });
    try {
      await this.agent.send(`${around.text}\n\n${clean}`, this.model);
    } catch (e) {
      const error = e as StepError;
      this.note(error.message, 'warn');
      if (error.why === 'account') await this.refreshAccount();
    } finally {
      this.post({ type: 'busy', busy: false });
      void this.refreshAccount();
    }
  }

  private approve(request: Request): Promise<boolean> {
    if (request.kind === 'edit' && this.allowEdits) return Promise.resolve(true);
    const id = `a${++this.approvals}`;
    return new Promise((resolve) => {
      this.waiting.set(id, { resolve, change: request.change });
      this.post({ type: 'approve', approval: { id, kind: request.kind, title: request.title, body: request.body, added: request.added, removed: request.removed } });
    });
  }

  private async showDiff(id: string) {
    const change = this.waiting.get(id)?.change;
    if (!change) return;
    const left = this.documents.put(`/before/${id}/${change.path}`, change.before);
    const right = this.documents.put(`/after/${id}/${change.path}`, change.after);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path}: Chip’s change`, { preview: true });
  }

  private async open(path: string, line?: number) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, path));
      const at = new vscode.Position(Math.max((line ?? 1) - 1, 0), 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at), preview: true });
    } catch {
      void vscode.window.showWarningMessage(`Couldn’t open ${path}.`);
    }
  }
}
