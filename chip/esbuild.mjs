import { build } from 'esbuild';

await Promise.all([
  build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: 'dist/extension.js', minify: true, logLevel: 'info' }),
  build({ entryPoints: ['webview/main.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', outfile: 'dist/webview.js', minify: true, logLevel: 'info' }),
]);
