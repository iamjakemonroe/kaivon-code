import * as vscode from 'vscode';
import { ChipApi, type Session, type SessionStore } from './api';
import { inlineEdit } from './inline';
import { changeScheme, ChangeDocuments, ChipView } from './view';

/** Chip: a coding partner in the editor. It works in Kaivon Code and in any VS Code. */

const SESSION_KEY = 'chip.session';

class Secrets implements SessionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get() {
    const raw = await this.secrets.get(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  async set(session: Session | null) {
    if (session) await this.secrets.store(SESSION_KEY, JSON.stringify(session));
    else await this.secrets.delete(SESSION_KEY);
  }
}

/** Offers Chip wherever the editor shows an error. */
class FixWithChip implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext) {
    const problems = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    if (!problems.length) return [];
    const action = new vscode.CodeAction('Fix with Chip', vscode.CodeActionKind.QuickFix);
    const line = problems[0].range.start.line + 1;
    action.command = { command: 'chip.ask', title: 'Fix with Chip', arguments: [`Fix this in ${vscode.workspace.asRelativePath(doc.uri, false)} line ${line}: ${problems[0].message}`] };
    return [action];
  }
}

export function activate(context: vscode.ExtensionContext) {
  const store = new Secrets(context.secrets);
  const api = new ChipApi(store, () => vscode.workspace.getConfiguration('chip').get<string>('server') ?? '');
  const documents = new ChangeDocuments();
  const view = new ChipView(context, api, documents);
  const open = () => vscode.commands.executeCommand('chip.chat.focus');

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(sparkle) Chip';
  status.tooltip = 'Open Chip';
  status.command = 'chip.open';
  status.show();

  context.subscriptions.push(
    status,
    vscode.window.registerWebviewViewProvider('chip.chat', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(changeScheme, documents),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixWithChip(), { providedCodeActionKinds: FixWithChip.kinds }),
    vscode.window.onDidChangeActiveTextEditor(() => view.sendContext()),
    vscode.window.onDidChangeTextEditorSelection(() => view.sendContext()),
    vscode.commands.registerCommand('chip.open', open),
    vscode.commands.registerCommand('chip.newChat', () => view.newChat()),
    vscode.commands.registerCommand('chip.inlineEdit', () => inlineEdit(api, () => view.currentModel, () => void open())),
    vscode.commands.registerCommand('chip.ask', async (text: string) => {
      await open();
      await view.send(text);
    }),
    vscode.commands.registerCommand('chip.explain', async () => {
      await open();
      await view.send('Explain the selected code: what it does, and anything that could go wrong with it.');
    }),
    vscode.commands.registerCommand('chip.askTerminal', async () => {
      const before = await vscode.env.clipboard.readText();
      await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
      const selected = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText(before);
      await open();
      view.prefill(`What does this mean?\n\n\`\`\`\n${selected.slice(0, 6000)}\n\`\`\``);
    }),
    vscode.commands.registerCommand('chip.signOut', async () => {
      await store.set(null);
      await view.signedOut();
    }),
  );
}

export function deactivate() {}
