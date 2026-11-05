// node-pty 1.1.0 prebuilds can ship spawn-helper without its execute bit.
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

try {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('node-pty/package.json'));
  const helper = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
} catch {
  // node-pty missing: Unfold falls back to pipes.
}
