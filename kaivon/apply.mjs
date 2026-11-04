// What makes VS Code's source Kaivon Code, after VSCodium's patches. Run from vscode/. Edits by
// meaning rather than by diff, so a new VS Code version only fails here when something really moved
// (each edit throws if its target is gone).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function edit(path, change) {
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`kaivon/apply.mjs: nothing changed in ${path}`);
  writeFileSync(path, after);
}

// Kaivon Night and Day, as built-in themes and the defaults.
const pkgPath = 'extensions/theme-defaults/package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes.themes.unshift(
  { id: 'Kaivon Night', label: 'Kaivon Night', uiTheme: 'vs-dark', path: './themes/kaivon-night.json' },
  { id: 'Kaivon Day', label: 'Kaivon Day', uiTheme: 'vs', path: './themes/kaivon-day.json' },
);
// Everything moves smoothly out of the box.
pkg.contributes.configurationDefaults = {
  'editor.smoothScrolling': true,
  'editor.cursorSmoothCaretAnimation': 'on',
  'editor.cursorBlinking': 'smooth',
  'editor.guides.bracketPairs': 'active',
  'workbench.list.smoothScrolling': true,
  'terminal.integrated.smoothScrolling': true,
};
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);

edit('src/vs/workbench/services/themes/common/workbenchThemeService.ts', (s) => {
  let out = s.replace("COLOR_THEME_DARK = 'Dark 2026'", "COLOR_THEME_DARK = 'Kaivon Night'").replace("COLOR_THEME_LIGHT = 'Light 2026'", "COLOR_THEME_LIGHT = 'Kaivon Day'");
  // The first frame, before the theme has loaded, is already Kaivon Night.
  const start = out.indexOf('export const COLOR_THEME_DARK_INITIAL_COLORS');
  const end = out.indexOf('export const COLOR_THEME_LIGHT_INITIAL_COLORS');
  if (start < 0 || end < 0) throw new Error('kaivon/apply.mjs: initial colours not found');
  let table = out.slice(start, end);
  for (const [key, value] of Object.entries(JSON.parse(readFileSync(join(here, 'first-paint.json'), 'utf8')))) {
    table = table.replace(new RegExp(`('${key.replace('.', '\\.')}': )'#[0-9A-Fa-f]+'`), `$1'${value}'`);
  }
  return out.slice(0, start) + table + out.slice(end);
});

// The glow (src/stable/.../kaivon.css).
edit('src/vs/workbench/browser/style.ts', (s) => s.replace("import './media/style.css';", "import './media/style.css';\nimport './media/kaivon.css';"));

// Chip, built in (built from ../chip first).
mkdirSync('extensions/chip', { recursive: true });
for (const item of ['README.md', 'dist', 'media']) cpSync(join(here, '..', 'chip', item), join('extensions/chip', item), { recursive: true });
const { scripts: _scripts, devDependencies: _dev, ...chip } = JSON.parse(readFileSync(join(here, '..', 'chip/package.json'), 'utf8'));
writeFileSync('extensions/chip/package.json', `${JSON.stringify(chip, null, 2)}\n`);
cpSync(join(here, '..', 'LICENSE'), 'extensions/chip/LICENSE');
