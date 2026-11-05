// Kaivon Code's site: the download buttons, the reveal on scroll, and the demo.
const REPO = 'iamjakemonroe/kaivon-code';
const latest = (file) => `https://github.com/${REPO}/releases/latest/download/${file}`;

document.documentElement.classList.add('js');
document.getElementById('year').textContent = new Date().getFullYear();

// ── Downloads ──────────────────────────────────────────────────────────

const ua = navigator.userAgent;
const system = /Windows/.test(ua) ? 'windows' : /Macintosh/.test(ua) && !/Mobile/.test(ua) ? 'mac' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : null;
const names = { mac: 'Mac', windows: 'Windows', linux: 'Linux' };
const links = [...document.querySelectorAll('.system')];
for (const a of links) a.href = latest(a.dataset.file);

const primary = document.getElementById('primary');
const mine = links.find((a) => a.dataset.os === system);
if (mine) {
  mine.classList.add('you-are-here');
  primary.textContent = `Download for ${names[system]}`;
  primary.href = mine.href;
  document.getElementById('primary-note').innerHTML = system === 'mac' ? 'For Apple Silicon. <a href="#download">Intel and other systems</a>' : '<a href="#download">Other systems</a>';
} else {
  document.getElementById('primary-note').textContent = 'For Mac, Windows and Linux. Open this page on your computer to download.';
}

// Each system links to the newest release that really has its file: a new release fills up one
// system at a time, and a system that's never been built isn't offered.
fetch(`https://api.github.com/repos/${REPO}/releases?per_page=8`)
  .then((r) => (r.ok ? r.json() : null))
  .then((releases) => {
    const ready = (releases ?? []).filter((r) => !r.prerelease && !r.draft);
    if (!ready.length) return;
    document.getElementById('version').textContent = `Free, for Mac, Windows and Linux. Latest: ${ready[0].tag_name}.`;
    for (const a of links) {
      const asset = ready.flatMap((r) => r.assets).find((f) => f.name === a.dataset.file);
      if (asset) {
        a.href = asset.browser_download_url;
        if (a === mine) primary.href = a.href;
        continue;
      }
      a.setAttribute('aria-disabled', 'true');
      a.removeAttribute('href');
      a.querySelector('span').textContent += ' · coming soon';
    }
  })
  .catch(() => {});

// ── Reveal on scroll ───────────────────────────────────────────────────

const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        seen.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
);
for (const el of document.querySelectorAll('.reveal')) seen.observe(el);

// ── The demo ───────────────────────────────────────────────────────────
// Everyone first sees Chip replay a real fix. On a computer, one click turns the same window into
// the real editor (src/playground.ts), which loads quietly in the background unless the connection
// is slow. Monaco is built for a keyboard, so phones and tablets keep the replay.

const log = document.getElementById('log');
const line = document.getElementById('line7');
const term = document.getElementById('term-out');
const OLD = '  <span class="k">return</span> subtotal - coupon;';
const NEW = '  <span class="k">return</span> subtotal - (subtotal * coupon) / <span class="n">100</span>;';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;
let replaying = true;

function add(className, html) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  log.append(el);
  while (log.children.length > 7) log.firstChild.remove();
  return el;
}

const ASK = `<b>cart.js <span>+1 −1</span></b><pre><span class="del">-  return subtotal - coupon;</span>
<span class="add">+  return subtotal - (subtotal * coupon) / 100;</span></pre><div class="btns"><span class="apply">Apply</span><span class="skip2">Skip</span></div>`;

const PASSED = '$ npm test\n<span class="pass">✔ a 10% coupon on 200 leaves 180</span>\ntests 1 · pass 1 · fail 0';

function finished() {
  log.replaceChildren();
  add('you', 'The test fails. The coupon should be a percentage. Fix it and run the tests.');
  add('did', 'Read cart.js and cart.test.js');
  add('say', 'The coupon is a percentage, but <code>cart.js:7</code> subtracts it as a flat amount.');
  add('did', 'Edited cart.js +1 −1');
  add('did', 'npm test');
  add('say', 'Fixed. <code>npm test</code> passes.');
  line.innerHTML = NEW;
  line.classList.add('new');
  term.innerHTML = PASSED;
}

async function play() {
  const steps = [
    [900, () => add('you', 'The test fails. The coupon should be a percentage. Fix it and run the tests.')],
    [1100, () => add('did', 'Read cart.js')],
    [450, () => add('did', 'Read cart.test.js')],
    [800, () => add('say', 'The coupon is a percentage, but <code>cart.js:7</code> subtracts it as a flat amount.')],
    [1100, () => (card = add('ask', ASK))],
    [1700, () => card.querySelector('.apply').classList.add('press')],
    [260, () => {
      card.classList.add('done');
      card.querySelector('.btns').innerHTML = '<span class="skip2">Approved</span>';
      line.innerHTML = NEW;
      line.classList.add('new');
    }],
    [900, () => {
      term.textContent = '$ npm test';
      add('did', 'npm test');
    }],
    [1000, () => (term.innerHTML = PASSED)],
    [500, () => add('say', 'Fixed. <code>npm test</code> passes.')],
    [5200, () => {}],
  ];
  let card;
  while (replaying) {
    log.replaceChildren();
    line.innerHTML = OLD;
    line.classList.remove('new');
    term.innerHTML = '$ npm test\n<span class="fail">✖ a 10% coupon on 200 leaves 180</span>\n  190 !== 180';
    for (const [ms, step] of steps) {
      await wait(ms);
      if (!replaying) return;
      step();
    }
  }
}

if (quiet) finished();
else play();

// The real editor.
const offer = document.getElementById('try-it');
const connection = navigator.connection;
const slow = !!connection && (connection.saveData || /(^|-)[23]g$/.test(connection.effectiveType ?? ''));
const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches && innerWidth >= 960;
let loading = null;

function load() {
  if (!loading) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/editor/playground.css';
    document.head.append(css);
    loading = import('/editor/playground.js');
  }
  return loading;
}

if (desktop) {
  offer.hidden = false;
  const go = async () => {
    offer.textContent = 'Getting the editor ready…';
    offer.disabled = true;
    try {
      const { start } = await load();
      replaying = false;
      offer.remove();
      document.getElementById('window').classList.add('real');
      start();
    } catch {
      offer.textContent = 'Couldn’t load the editor. Try again';
      offer.disabled = false;
      loading = null;
    }
  };
  offer.addEventListener('click', go);
  if (!slow) addEventListener('load', () => (window.requestIdleCallback ?? setTimeout)(() => load().catch(() => (loading = null))));
} else {
  document.getElementById('touch-note').hidden = false;
}
