import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { VsCodeHost } from '../../src/host';

/** Chip inside a real VS Code: it activates, its commands exist, its panel opens, and the host's
 * files, search, problems and commands work on a real folder. Run with npm run test:host. */
export async function run() {
  const chip = vscode.extensions.getExtension('kaivon.chip');
  assert.ok(chip, 'Chip is installed');
  await chip.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const name of ['chip.open', 'chip.newChat', 'chip.inlineEdit', 'chip.explain', 'chip.askTerminal', 'chip.signOut', 'chip.ask']) assert.ok(commands.includes(name), name);
  await vscode.commands.executeCommand('chip.open');
  await vscode.commands.executeCommand('chip.newChat');

  const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  assert.ok(root, 'a folder is open');
  writeFileSync(`${root}/hello.js`, 'export const greeting = "hello";\n');
  const host = new VsCodeHost(async () => true);

  assert.equal(await host.read('hello.js'), 'export const greeting = "hello";\n');
  assert.equal(await host.exists('hello.js'), true);
  assert.equal(await host.exists('nope.js'), false);
  await assert.rejects(host.read('nope.js'), /doesn't exist/);
  assert.ok((await host.list('')).some((e) => e.name === 'hello.js'));
  assert.deepEqual(await host.find('**/*.js'), ['hello.js']);
  const found = await host.search('greeting', false);
  assert.ok(found.some((l) => l.startsWith('hello.js:1:')), `search found: ${found}`);
  assert.deepEqual(await host.problems('hello.js'), []);

  // Through the editor when it exists, straight to disk when it's new.
  await host.write('hello.js', 'export const greeting = "hi";\n');
  assert.equal(await host.read('hello.js'), 'export const greeting = "hi";\n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(`${root}/hello.js`));
  assert.equal(doc.isDirty, false);
  await host.write('new/deep/file.txt', 'made');
  assert.equal(await host.read('new/deep/file.txt'), 'made');

  const stop = new AbortController();
  const ok = await host.run('echo out && echo err 1>&2', 5000, stop.signal, () => {});
  assert.equal(ok.code, 0);
  assert.match(ok.output, /out/);
  assert.match(ok.output, /err/);
  const bad = await host.run('exit 3', 5000, stop.signal, () => {});
  assert.equal(bad.code, 3);
  const slow = await host.run('sleep 30', 300, stop.signal, () => {});
  assert.equal(slow.timedOut, true);
  const gone = new AbortController();
  const stopped = host.run('sleep 30', 20000, gone.signal, () => {});
  setTimeout(() => gone.abort(), 200);
  assert.notEqual((await stopped).code, 0);

  await vscode.commands.executeCommand('chip.signOut');

}
