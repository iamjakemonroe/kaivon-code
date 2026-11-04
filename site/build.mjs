// Builds the playground into public/editor: Monaco (the editor inside VS Code and Kaivon Code), its
// background workers, and the test runner. The page itself needs no build.
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

const monaco = (path) => `node_modules/monaco-editor/esm/vs/${path}`;

rmSync('public/editor', { recursive: true, force: true });
await build({
  entryPoints: {
    playground: 'src/playground.ts',
    runner: 'src/runner.ts',
    'editor.worker': monaco('editor/editor.worker.js'),
    'ts.worker': monaco('languages/features/typescript/ts.worker.js'),
    'json.worker': monaco('languages/features/json/json.worker.js'),
  },
  outdir: 'public/editor',
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  entryNames: '[name]',
  chunkNames: 'c-[hash]',
  assetNames: '[name]',
  loader: { '.ttf': 'file' },
  logLevel: 'info',
});
