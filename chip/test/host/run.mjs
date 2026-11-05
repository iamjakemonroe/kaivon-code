import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';

// Run from VS Code's own terminal, this is set, and the test copy would start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const chip = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Beside the readers, which load from the bundle's own folder. Never shipped: it's removed below.
const suite = join(chip, 'dist/test-suite.cjs');
await build({ entryPoints: [join(chip, 'test/host/suite.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: suite, logLevel: 'warning' });
try {
  await runTests({
    extensionDevelopmentPath: chip,
    extensionTestsPath: suite,
    launchArgs: [mkdtempSync(join(tmpdir(), 'chip-host-')), '--disable-extensions', '--disable-workspace-trust'],
  });
} finally {
  rmSync(suite, { force: true });
}
