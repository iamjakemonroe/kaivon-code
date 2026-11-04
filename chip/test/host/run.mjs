import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';

// Run from VS Code's own terminal, this is set, and the test copy would start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const chip = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await build({ entryPoints: [join(chip, 'test/host/suite.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: join(chip, 'dist-test/suite.cjs'), logLevel: 'warning' });
await runTests({
  extensionDevelopmentPath: chip,
  extensionTestsPath: join(chip, 'dist-test/suite.cjs'),
  launchArgs: [mkdtempSync(join(tmpdir(), 'chip-host-')), '--disable-extensions', '--disable-workspace-trust'],
});
