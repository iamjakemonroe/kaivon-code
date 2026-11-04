import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import { conf, language } from 'monaco-editor/languages/definitions/javascript/javascript.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/features/json/register.js';
import { javascriptDefaults, ModuleKind, ModuleResolutionKind, ScriptTarget } from 'monaco-editor/languages/features/typescript/register.js';
import night from '../../src/stable/extensions/theme-defaults/themes/kaivon-night.json';

/** The window on the landing page, made real: Monaco is the editor inside VS Code and Kaivon Code, in
 * Kaivon Night with the app's smooth defaults. The tests really run. Chip's panel is a replay of a
 * real fix, and says so: a live model on a public page would be open to anyone. */

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    const file = label === 'typescript' || label === 'javascript' ? 'ts' : label === 'json' ? 'json' : 'editor';
    return new Worker(`/editor/${file}.worker.js`, { type: 'module', name: label });
  },
};

const FILES: Record<string, string> = {
  'cart.js': `/** @typedef {{ name: string, price: number }} Item */

/** @param {Item[]} items @param {number} coupon A percentage. */
export function total(items, coupon) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  // A coupon takes a percentage off.
  return subtotal - coupon;
}
`,
  'cart.test.js': `import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from './cart.js';

test('a 10% coupon on 200 leaves 180', () => {
  assert.equal(total([{ name: 'Shoes', price: 200 }], 10), 180);
});
`,
  'package.json': `{
  "name": "shop",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
`,
};

const BUG = 'return subtotal - coupon;';
const FIX = 'return subtotal - (subtotal * coupon) / 100;';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function theme() {
  // The app's own colours, for everything the editor draws.
  const colors = Object.fromEntries(Object.entries(night.colors as Record<string, string>).filter(([key]) => /^(editor|list\.|input|quickInput|pickerGroup|keybindingLabel|scrollbarSlider|focusBorder|widget|menu|foreground|descriptionForeground|peekView|diffEditor|minimap)/.test(key)));
  monaco.editor.defineTheme('kaivon-night', {
    base: 'vs-dark',
    inherit: true,
    colors,
    rules: [
      { token: 'keyword', foreground: 'b9a8ff' },
      { token: 'string', foreground: '7fe0b4' },
      { token: 'number', foreground: 'ffb46b' },
      { token: 'comment', foreground: '6d7196', fontStyle: 'italic' },
      { token: 'function', foreground: '6fc8ff' },
      { token: 'type.identifier', foreground: 'ffd37a' },
      { token: 'identifier', foreground: 'e4e5f4' },
      { token: 'delimiter', foreground: 'a2a5c4' },
      { token: 'regexp', foreground: 'ff9ccb' },
      { token: 'string.key.json', foreground: '9cd6ff' },
      { token: 'string.value.json', foreground: '7fe0b4' },
    ],
  });
}

function javascript() {
  monaco.languages.register({ id: 'javascript', extensions: ['.js'], aliases: ['JavaScript'], mimetypes: ['text/javascript'] });
  monaco.languages.setLanguageConfiguration('javascript', conf);
  // Function names get their own colour, as they do in the app.
  const tokens = structuredClone(language.tokenizer) as Record<string, unknown[]>;
  tokens.common.unshift([/[a-zA-Z_$][\w$]*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@default': 'function' } }]);
  monaco.languages.setMonarchTokensProvider('javascript', { ...language, tokenizer: tokens } as monaco.languages.IMonarchLanguage);
  javascriptDefaults.setCompilerOptions({ allowJs: true, allowNonTsExtensions: true, target: ScriptTarget.ES2020, module: ModuleKind.ESNext, moduleResolution: ModuleResolutionKind.NodeJs, checkJs: false });
  javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
  javascriptDefaults.setEagerModelSync(true);
}

export function start() {
  const $ = (id: string) => document.getElementById(id)!;
  const log = $('log');
  const term = $('term-out');
  const tabs = $('tabs');
  const tree = $('tree');
  const live = $('live');

  theme();
  javascript();

  const models = Object.fromEntries(Object.entries(FILES).map(([name, code]) => [name, monaco.editor.createModel(code, undefined, monaco.Uri.parse(`file:///shop/${name}`))]));
  const saved: Record<string, string> = { ...FILES };
  const views: Record<string, monaco.editor.ICodeEditorViewState | null> = {};
  const open = ['cart.js', 'cart.test.js'];
  let current = 'cart.js';
  let worker: Worker | null = null;
  let chipFixed = false;
  let cheered = false;

  live.hidden = false;
  $('still').hidden = true;
  const editor = monaco.editor.create(live, {
    model: models[current],
    theme: 'kaivon-night',
    automaticLayout: true,
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
    fontSize: 13.5,
    lineHeight: 23,
    tabSize: 2,
    padding: { top: 12 },
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    overviewRulerLanes: 0,
    // Kaivon Code's defaults, so it feels the same.
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    cursorBlinking: 'smooth',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', bracketPairsHorizontal: false },
    fixedOverflowWidgets: true,
    stickyScroll: { enabled: false },
    // The page keeps scrolling when the wheel reaches the end of a short file.
    scrollbar: { alwaysConsumeMouseWheel: false },
    ariaLabel: 'Code editor. Press Control M to move out of it with Tab.',
  });

  const fixedLine = editor.createDecorationsCollection();

  function renderTabs() {
    tabs.replaceChildren(
      ...open.map((name) => {
        const tab = document.createElement('button');
        tab.className = `kc-tab${name === current ? ' on' : ''}${models[name].getValue() !== saved[name] ? ' dirty' : ''}`;
        tab.textContent = name;
        tab.onclick = () => show(name);
        return tab;
      }),
    );
    for (const item of tree.querySelectorAll<HTMLElement>('[data-file]')) item.classList.toggle('on', item.dataset.file === current);
    $('title').textContent = `${current} · shop`;
  }

  function show(name: string) {
    views[current] = editor.saveViewState();
    current = name;
    if (!open.includes(name)) open.push(name);
    editor.setModel(models[name]);
    if (views[name]) editor.restoreViewState(views[name]);
    editor.focus();
    renderTabs();
  }

  tree.replaceChildren(
    Object.assign(document.createElement('p'), { textContent: 'SHOP' }),
    ...Object.keys(FILES).map((name) => {
      const item = document.createElement('button');
      item.textContent = name;
      item.dataset.file = name;
      item.onclick = () => show(name);
      return item;
    }),
  );
  for (const model of Object.values(models)) model.onDidChangeContent(renderTabs);

  function say(className: string, html: string) {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function print(text: string, kind = '') {
    const span = document.createElement('span');
    if (kind) span.className = kind;
    span.textContent = `${text}\n`;
    term.append(span);
    term.scrollTop = term.scrollHeight;
  }

  /** Runs the tests for real; answers whether they passed. */
  function runTests(): Promise<boolean> {
    worker?.terminate();
    term.replaceChildren();
    print('$ npm test');
    return new Promise((resolve) => {
      const run = new Worker('/editor/runner.js', { type: 'module' });
      worker = run;
      // A loop that never ends stops here, not in the visitor's tab.
      const stop = setTimeout(() => {
        run.terminate();
        print('Stopped after 5 seconds: is there a loop that never ends?', 'fail');
        resolve(false);
      }, 5000);
      run.onmessage = (e: MessageEvent<{ type: string; text: string; kind: string; pass: number; fail: number }>) => {
        if (e.data.type === 'line') print(e.data.text, e.data.kind);
        else {
          clearTimeout(stop);
          run.terminate();
          resolve(e.data.fail === 0 && e.data.pass > 0);
        }
      };
      run.onerror = (e) => {
        clearTimeout(stop);
        print(e.message || 'The tests couldn’t start.', 'fail');
        resolve(false);
      };
      run.postMessage({ files: Object.entries(models).map(([name, model]) => ({ name, code: model.getValue() })) });
    });
  }

  async function runByHand() {
    // Back to the code, so the next key lands there.
    editor.focus();
    const passed = await runTests();
    if (passed && !chipFixed && !cheered) {
      cheered = true;
      say('say', 'You fixed it yourself. Nice. That’s the real editor you just used.');
    }
  }

  function intro() {
    log.replaceChildren();
    say('say', 'Hi, I’m Chip. One test in this project fails. Try fixing it yourself, or ask me.');
    const actions = say('kc-actions', '');
    const ask = document.createElement('button');
    ask.className = 'ask-btn';
    ask.textContent = 'Ask Chip to fix it';
    ask.onclick = () => {
      actions.remove();
      void fix();
    };
    actions.append(ask);
    say('fine', 'On this page I replay a real fix. In the app, I work on your own code.');
  }

  async function fix() {
    say('you', 'The test fails. The coupon should be a percentage. Fix it and run the tests.');
    await wait(700);
    say('did', 'Read cart.js');
    await wait(350);
    say('did', 'Read cart.test.js');
    await wait(600);
    const cart = models['cart.js'];
    const found = () => cart.findMatches(BUG, false, false, true, null, false)[0];
    if (!found()) {
      say('say', 'You’ve already changed that line. On this page I can only replay one fix, so choose <b>Start over</b> to see it. In the app, I’d read your change and work from there.');
      return;
    }
    say('say', 'The coupon is a percentage, but <code>cart.js:7</code> subtracts it as a flat amount.');
    await wait(500);
    const card = say(
      'ask',
      `<b>cart.js <span>+1 −1</span></b><pre><span class="del">-  ${BUG}</span>\n<span class="add">+  ${FIX}</span></pre><div class="btns"><button class="apply">Apply</button><button class="skip2">Skip</button></div>`,
    );
    const answer = await new Promise<boolean>((resolve) => {
      card.querySelector<HTMLElement>('.apply')!.onclick = () => resolve(true);
      card.querySelector<HTMLElement>('.skip2')!.onclick = () => resolve(false);
    });
    card.classList.add('done');
    card.querySelector('.btns')!.innerHTML = `<span class="skip2">${answer ? 'Approved' : 'Skipped'}</span>`;
    if (!answer) {
      say('say', 'Skipped. Nothing changed: every edit waits for you.');
      return;
    }
    const match = found();
    if (!match) {
      say('say', 'That line has changed since I read it, so I’ve left it alone.');
      return;
    }
    show('cart.js');
    // One undo step, like any edit: Cmd or Ctrl + Z takes it back.
    editor.pushUndoStop();
    editor.executeEdits('chip', [{ range: match.range, text: FIX }]);
    editor.pushUndoStop();
    fixedLine.set([{ range: new monaco.Range(match.range.startLineNumber, 1, match.range.startLineNumber, 1), options: { isWholeLine: true, className: 'chip-changed' } }]);
    editor.revealLineInCenterIfOutsideViewport(match.range.startLineNumber);
    chipFixed = true;
    await wait(600);
    say('did', 'npm test');
    const passed = await runTests();
    say('say', passed ? 'Fixed. <code>npm test</code> passes.' : 'I made the change, but the tests still fail: something else has changed. Have a look at the terminal.');
  }

  function startOver() {
    worker?.terminate();
    for (const [name, code] of Object.entries(FILES)) {
      models[name].setValue(code);
      saved[name] = code;
    }
    fixedLine.clear();
    chipFixed = false;
    cheered = false;
    show('cart.js');
    term.replaceChildren();
    print('Press Run tests, or ⌘ / Ctrl + Enter.');
    intro();
  }

  const save = () => {
    saved[current] = models[current].getValue();
    renderTabs();
  };
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runByHand());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

  $('run').onclick = () => void runByHand();
  $('over').onclick = startOver;
  for (const id of ['run', 'over', 'tips']) $(id).hidden = false;
  const figure = $('demo');
  figure.removeAttribute('role');
  figure.setAttribute('aria-label', 'Try Kaivon Code’s editor');
  term.replaceChildren();
  print('Press Run tests, or ⌘ / Ctrl + Enter.');
  intro();
  renderTabs();
  editor.setPosition({ lineNumber: 7, column: 28 });
  editor.focus();
}
