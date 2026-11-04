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

// The release says what's really there: a system that hasn't been built isn't offered.
fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  .then((r) => (r.ok ? r.json() : null))
  .then((release) => {
    if (!release) return;
    document.getElementById('version').textContent = `Free, for Mac, Windows and Linux. Latest: ${release.tag_name}.`;
    const files = new Set(release.assets.map((a) => a.name));
    for (const a of links) {
      if (files.has(a.dataset.file)) continue;
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

// ── The demo: the fix Chip really made in testing ──────────────────────

const log = document.getElementById('log');
const line = document.getElementById('line4');
const term = document.getElementById('term-out');
const OLD = '  <span class="k">return</span> subtotal - coupon;';
const NEW = '  <span class="k">return</span> subtotal - (subtotal * coupon) / <span class="n">100</span>;';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;

function add(className, html) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  log.append(el);
  while (log.children.length > 7) log.firstChild.remove();
  return el;
}

const ASK = `<b>cart.js <span>+1 −1</span></b><pre><span class="del">-  return subtotal - coupon;</span>
<span class="add">+  return subtotal - (subtotal * coupon) / 100;</span></pre><div class="btns"><span class="apply">Apply</span><span class="skip2">Skip</span><span class="skip2">View diff</span></div>`;

function finished() {
  log.replaceChildren();
  add('you', 'The test fails. The coupon should be a percentage. Fix it and run the tests.');
  add('did', 'Read cart.js and cart.test.js');
  add('say', 'The coupon is passed as a percentage, but <code>cart.js:4</code> subtracts it as a flat amount.');
  add('did', 'Edited cart.js +1 −1');
  add('did', 'npm test');
  add('say', 'Fixed. <code>npm test</code> passes.');
  line.innerHTML = NEW;
  line.classList.add('new');
  term.innerHTML = '$ npm test\n<span class="pass">✔ a 10% coupon on 200 leaves 180</span>\ntests 1 · pass 1 · fail 0';
}

async function play() {
  for (;;) {
    log.replaceChildren();
    line.innerHTML = OLD;
    line.classList.remove('new');
    term.innerHTML = '$ npm test\n<span class="fail">✖ a 10% coupon on 200 leaves 180</span>\n  190 !== 180';
    await wait(900);
    add('you', 'The test fails. The coupon should be a percentage. Fix it and run the tests.');
    await wait(1100);
    add('did', 'Read cart.js');
    await wait(450);
    add('did', 'Read cart.test.js');
    await wait(800);
    add('say', 'The coupon is passed as a percentage, but <code>cart.js:4</code> subtracts it as a flat amount.');
    await wait(1100);
    const card = add('ask', ASK);
    await wait(1700);
    card.querySelector('.apply').classList.add('press');
    await wait(260);
    card.classList.add('done');
    card.querySelector('.btns').innerHTML = '<span class="skip2">Approved</span>';
    line.innerHTML = NEW;
    line.classList.add('new');
    await wait(900);
    term.textContent = '$ npm test';
    add('did', 'npm test');
    await wait(1000);
    term.innerHTML = '$ npm test\n<span class="pass">✔ a 10% coupon on 200 leaves 180</span>\ntests 1 · pass 1 · fail 0';
    await wait(500);
    add('say', 'Fixed. <code>npm test</code> passes.');
    await wait(5200);
  }
}

if (quiet) finished();
else play();
