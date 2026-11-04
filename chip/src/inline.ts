import * as vscode from 'vscode';
import type { ChipApi } from './api';
import { StepError } from './agent';
import type { Model } from './protocol';

/** Select code, say what you want, and Chip rewrites it in place: you keep or undo the change. */

const changed = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(124, 112, 255, 0.14)',
  isWholeLine: true,
  overviewRulerColor: 'rgba(139, 124, 255, 0.8)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

/** The model's answer without code fences, in case it added them. */
export const unfenced = (text: string) => text.replace(/^```[^\n]*\n/, '').replace(/\n?```\s*$/, '');

export async function inlineEdit(api: ChipApi, model: () => Model, signIn: () => void) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const selection = editor.selection.isEmpty ? doc.lineAt(editor.selection.active.line).range : new vscode.Range(editor.selection.start, editor.selection.end);
  const instruction = await vscode.window.showInputBox({ title: 'Edit with Chip', prompt: 'What should change?', placeHolder: 'Add error handling, make this async, rename to…', ignoreFocusOut: true });
  if (!instruction?.trim()) return;

  const version = doc.version;
  const start = doc.offsetAt(selection.start);
  const end = doc.offsetAt(selection.end);
  const all = doc.getText();
  const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Chip is editing…', cancellable: true }, async (_p, cancel) => {
    const stop = new AbortController();
    cancel.onCancellationRequested(() => stop.abort());
    let text = '';
    try {
      const last = await api.stream(
        { action: 'edit', instruction, path: vscode.workspace.asRelativePath(doc.uri, false), language: doc.languageId, before: all.slice(Math.max(0, start - 30000), start), selection: all.slice(start, end), after: all.slice(end, end + 30000), model: model() },
        (e) => {
          if (e.t === 'text') text += e.text;
        },
        stop.signal,
      );
      if (last.t === 'refusal') throw new StepError('Chip won’t help with this one.');
      if (last.t === 'error') throw new StepError(last.error);
      return text;
    } catch (e) {
      if (stop.signal.aborted) return null;
      if (e instanceof StepError && e.why === 'account') signIn();
      else void vscode.window.showErrorMessage((e as Error).message);
      return null;
    }
  });
  if (answer === null) return;
  if (doc.version !== version) {
    void vscode.window.showWarningMessage('The file changed while Chip was working, so nothing was applied.');
    return;
  }
  const next = unfenced(answer);
  await editor.edit((b) => b.replace(selection, next));
  const lines = next.split('\n').length;
  const range = new vscode.Range(selection.start.line, 0, selection.start.line + lines - 1, 0);
  editor.setDecorations(changed, [range]);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  const choice = await vscode.window.showInformationMessage(`Chip changed ${lines} line${lines === 1 ? '' : 's'}.`, 'Keep', 'Undo');
  editor.setDecorations(changed, []);
  if (choice === 'Undo') await vscode.commands.executeCommand('undo');
}
