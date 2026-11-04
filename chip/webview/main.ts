import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';
import type { Approval, FromPanel, PanelState, ToolStatus, ToPanel } from '../src/protocol';
import './style.css';

/** Chip's chat panel: plain DOM, since it's small and has to open fast. */

declare function acquireVsCodeApi(): { postMessage(m: FromPanel): void };
const vscode = acquireVsCodeApi();
const send = (m: FromPanel) => vscode.postMessage(m);

const marked = new Marked({ gfm: true, breaks: false });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const app = document.getElementById('app')!;
app.innerHTML = '';
const head = el('header', 'head');
const log = el('main', 'log');
const foot = el('footer', 'foot');
app.append(head, log, foot);

let state: PanelState = { signedIn: false, email: null, model: 'best', tier: null, left: null };
let busy = false;
let turn: HTMLElement | null = null;
let textBlock: { node: HTMLElement; text: string } | null = null;
let thinkBlock: { node: HTMLDetailsElement; body: HTMLElement; text: string } | null = null;
let signinStep: { step: 'email' | 'code'; email: string; error?: string; busy?: boolean } | null = null;
const tools = new Map<string, HTMLElement>();
const approvals = new Map<string, HTMLElement>();

function orb(size = 22) {
  const o = el('span', 'orb');
  o.style.setProperty('--orb', `${size}px`);
  o.append(el('i'), el('i'));
  return o;
}

// ── Header and composer ────────────────────────────────────────────────

function renderHead() {
  head.replaceChildren();
  const who = el('div', 'who');
  who.append(orb(), el('strong', '', 'Chip'));
  head.append(who);
  if (!state.signedIn) return;
  const models = el('div', 'models');
  models.setAttribute('role', 'radiogroup');
  models.setAttribute('aria-label', 'Chip’s model');
  for (const [id, label] of [['best', 'Best'], ['fast', 'Fast']] as const) {
    const b = el('button', state.model === id ? 'on' : '', label);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.model === id));
    b.title = id === 'best' ? 'Chip’s best model, for hard problems' : 'Quick and light, for everyday work';
    b.onclick = () => send({ type: 'model', model: id });
    models.append(b);
  }
  head.append(models);
}

const composer = el('form', 'composer');
const context = el('div', 'context');
const box = el('textarea');
box.rows = 1;
box.placeholder = 'Ask Chip to change something…';
box.setAttribute('aria-label', 'Message to Chip');
const row = el('div', 'row');
const left = el('span', 'left');
const go = el('button', 'go');
go.type = 'submit';
row.append(left, go);
composer.append(context, box, row);

function renderGo() {
  go.textContent = busy ? 'Stop' : 'Send';
  go.classList.toggle('stop', busy);
  go.disabled = !busy && !box.value.trim();
}

function fit() {
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  renderGo();
}
box.oninput = fit;
box.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
};
composer.onsubmit = (e) => {
  e.preventDefault();
  if (busy) return send({ type: 'stop' });
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  fit();
  send({ type: 'send', text });
};

function renderFoot() {
  foot.replaceChildren();
  if (state.signedIn) foot.append(composer);
  left.textContent = state.left ?? '';
  renderGo();
}

// ── Signing in, and an empty chat ──────────────────────────────────────

function renderSignin() {
  log.replaceChildren();
  const s = signinStep ?? { step: 'email' as const, email: '' };
  const card = el('form', 'signin');
  card.append(orb(56), el('h1', '', 'Hi, I’m Chip.'), el('p', '', s.step === 'email' ? 'Sign in with your Kaivon account and I’ll work on your code with you.' : `I’ve emailed a code to ${s.email}.`));
  const input = el('input');
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (s.step === 'email') {
    input.type = 'email';
    input.placeholder = 'you@example.com';
    input.value = s.email;
    input.setAttribute('aria-label', 'Email');
  } else {
    input.inputMode = 'numeric';
    input.placeholder = 'Code from your email';
    input.setAttribute('aria-label', 'Code');
  }
  const button = el('button', 'primary', s.busy ? '…' : s.step === 'email' ? 'Email me a code' : 'Sign in');
  button.disabled = !!s.busy;
  card.append(input, button);
  if (s.error) card.append(el('p', 'error', s.error));
  if (s.step === 'code') {
    const back = el('button', 'quiet', 'Use a different email');
    back.type = 'button';
    back.onclick = () => send({ type: 'restart-signin' });
    card.append(back);
  }
  card.onsubmit = (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (s.step === 'email') send({ type: 'otp', email: value });
    else send({ type: 'verify', email: s.email, code: value });
  };
  log.append(card);
  setTimeout(() => input.focus(), 0);
}

const IDEAS = ['Explain how this project is put together', 'Find and fix the bug in this file', 'Write tests for what I have open'];

function renderEmpty() {
  log.replaceChildren();
  const card = el('div', 'empty');
  card.append(orb(56), el('h1', '', 'What are we building?'), el('p', '', 'I read your project, make changes you approve, and run your tests.'));
  const ideas = el('div', 'ideas');
  for (const idea of IDEAS) {
    const b = el('button', '', idea);
    b.onclick = () => {
      box.value = idea;
      fit();
      box.focus();
    };
    ideas.append(b);
  }
  card.append(ideas);
  log.append(card);
}

// ── The conversation ───────────────────────────────────────────────────

const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
function follow(was: boolean) {
  if (was) log.scrollTop = log.scrollHeight;
}

function clearEmpty() {
  log.querySelector('.empty')?.remove();
  log.querySelector('.signin')?.remove();
}

/** Markdown, safe, with colours in code and links on file paths. */
function render(node: HTMLElement, text: string) {
  node.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  for (const pre of node.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const lang = /language-(\S+)/.exec(code.className)?.[1];
    if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent ?? '', { language: lang }).value;
    const bar = el('div', 'codebar');
    const copy = el('button', '', 'Copy');
    copy.onclick = async () => {
      await navigator.clipboard.writeText(code.textContent ?? '');
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    };
    const insert = el('button', '', 'Insert');
    insert.onclick = () => send({ type: 'insert', code: code.textContent ?? '' });
    bar.append(el('span', '', lang ?? ''), copy, insert);
    pre.prepend(bar);
  }
  for (const code of node.querySelectorAll<HTMLElement>(':not(pre) > code')) {
    const m = /^([\w@./-]+\.[\w]+)(?::(\d+))?$/.exec(code.textContent ?? '');
    if (!m) continue;
    code.classList.add('path');
    code.tabIndex = 0;
    code.onclick = () => send({ type: 'open', path: m[1], line: m[2] ? Number(m[2]) : undefined });
  }
}

let pending = false;
function paintSoon() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (!textBlock) return;
    const was = atEnd();
    render(textBlock.node, textBlock.text);
    follow(was);
  });
}

function ensureTurn() {
  if (turn) return turn;
  clearEmpty();
  turn = el('section', 'turn');
  log.append(turn);
  return turn;
}

const STATUS_MARK: Record<ToolStatus, string> = { running: '', done: '✓', failed: '!', skipped: '–' };

function showTool(id: string, label: string, status: ToolStatus, detail?: string) {
  const was = atEnd();
  let node = tools.get(id);
  if (!node) {
    node = el('details', 'tool');
    node.append(el('summary'));
    ensureTurn().append(node);
    tools.set(id, node);
    textBlock = null;
    thinkBlock = null;
  }
  node.dataset.status = status;
  const summary = node.querySelector('summary')!;
  summary.replaceChildren(el('span', 'mark', STATUS_MARK[status]), el('span', 'label', label));
  const multi = !!detail && detail.includes('\n');
  if (detail && !multi) summary.append(el('span', 'detail', detail));
  node.querySelector('pre')?.remove();
  if (multi) node.append(el('pre', 'output', detail));
  node.classList.toggle('plain', !multi);
  follow(was);
}

function showApproval(a: Approval) {
  const was = atEnd();
  const card = el('div', `approval ${a.kind}`);
  const top = el('div', 'atop');
  top.append(el('strong', '', a.title));
  if (a.added !== undefined) {
    top.append(el('span', 'plus', `+${a.added}`), el('span', 'minus', `−${a.removed ?? 0}`));
  }
  card.append(top);
  if (a.kind === 'edit') {
    const diff = el('pre', 'diff');
    for (const line of a.body.split('\n')) diff.append(el('span', line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '', `${line}\n`));
    card.append(diff);
  } else if (a.kind === 'command') {
    card.append(el('pre', 'command', a.body));
  } else {
    card.append(el('p', '', a.body));
  }
  const buttons = el('div', 'abuttons');
  const yes = el('button', 'primary', a.kind === 'edit' ? 'Apply' : a.kind === 'command' ? 'Run' : 'Allow');
  yes.onclick = () => send({ type: 'answer', id: a.id, ok: true });
  const no = el('button', 'quiet', 'Skip');
  no.onclick = () => send({ type: 'answer', id: a.id, ok: false });
  buttons.append(yes, no);
  if (a.kind === 'edit') {
    const view = el('button', 'quiet', 'View diff');
    view.onclick = () => send({ type: 'diff', id: a.id });
    const always = el('button', 'quiet', 'Apply all in this chat');
    always.onclick = () => send({ type: 'answer', id: a.id, ok: true, always: true });
    buttons.append(view, always);
  }
  card.append(buttons);
  ensureTurn().append(card);
  approvals.set(a.id, card);
  textBlock = null;
  follow(was);
  yes.focus();
}

function on(m: ToPanel) {
  const was = atEnd();
  switch (m.type) {
    case 'state': {
      const signedInNow = m.state.signedIn && !state.signedIn;
      state = m.state;
      renderHead();
      renderFoot();
      if (signedInNow) {
        signinStep = null;
        renderEmpty();
      }
      break;
    }
    case 'signin':
      signinStep = { step: m.step, email: m.email ?? signinStep?.email ?? '', error: m.error, busy: m.busy };
      renderSignin();
      break;
    case 'reset':
      turn = null;
      textBlock = null;
      thinkBlock = null;
      tools.clear();
      approvals.clear();
      if (state.signedIn) renderEmpty();
      break;
    case 'user': {
      clearEmpty();
      turn = null;
      textBlock = null;
      thinkBlock = null;
      const you = el('section', 'you');
      you.append(el('div', 'bubble', m.text));
      if (m.files.length) you.append(el('div', 'files', m.files.join(', ')));
      log.append(you);
      log.scrollTop = log.scrollHeight;
      break;
    }
    case 'turn':
      textBlock = null;
      thinkBlock = null;
      ensureTurn();
      break;
    case 'think': {
      if (!thinkBlock) {
        const node = el('details', 'think');
        const summary = el('summary', '', 'Thinking');
        const body = el('div', 'tbody');
        node.append(summary, body);
        ensureTurn().append(node);
        thinkBlock = { node, body, text: '' };
      }
      thinkBlock.text += m.text;
      thinkBlock.body.textContent = thinkBlock.text;
      break;
    }
    case 'text':
      if (!textBlock) {
        const node = el('div', 'md');
        ensureTurn().append(node);
        textBlock = { node, text: '' };
        thinkBlock = null;
      }
      textBlock.text += m.text;
      paintSoon();
      break;
    case 'tool':
      showTool(m.id, m.label, m.status, m.detail);
      break;
    case 'approve':
      showApproval(m.approval);
      break;
    case 'approved': {
      const card = approvals.get(m.id);
      card?.classList.add('answered');
      card?.querySelector('.abuttons')?.replaceChildren(el('span', 'answer', m.ok ? 'Approved' : 'Skipped'));
      approvals.delete(m.id);
      break;
    }
    case 'busy':
      busy = m.busy;
      document.body.classList.toggle('busy', busy);
      if (!busy) {
        turn = null;
        textBlock = null;
        thinkBlock = null;
      }
      renderGo();
      break;
    case 'note':
      ensureTurn().append(el('p', `note ${m.tone ?? ''}`, m.text));
      textBlock = null;
      break;
    case 'context':
      context.replaceChildren();
      if (m.file) context.append(el('span', 'chipfile', m.lines ? `${m.file} · lines ${m.lines}` : m.file));
      break;
    case 'prefill':
      box.value = m.text;
      fit();
      box.focus();
      break;
  }
  follow(was);
}

window.addEventListener('message', (e: MessageEvent<ToPanel>) => on(e.data));
renderHead();
renderFoot();
send({ type: 'ready' });
