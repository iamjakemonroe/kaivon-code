import { build } from 'esbuild';

await Promise.all([
  build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: 'dist/extension.js', minify: true, logLevel: 'info' }),
  // The big readers load when they're first needed, so they're built on their own.
  build({ entryPoints: ['src/readers/sheet.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: 'dist/reader-sheet.js', minify: true, logLevel: 'info' }),
  build({ entryPoints: ['src/readers/pdf.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: 'dist/reader-pdf.mjs', minify: true, logLevel: 'info', banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" } }),
  build({ entryPoints: ['webview/main.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outfile: 'dist/webview.js', minify: true, logLevel: 'info' }),
]);
