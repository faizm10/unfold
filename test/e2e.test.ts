// Runs the built `unfold` binary in a real pseudo-terminal against a fake Vercel CLI
// and checks what a terminal would actually display. Requires `npm run build` and node-pty.
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const bin = join(root, 'bin', 'unfold.js');

let pty: typeof import('node-pty') | undefined;
try {
  pty = require('node-pty');
} catch {
  pty = undefined;
}
const canRun = !!pty && existsSync(join(root, 'dist', 'cli.js')) && process.platform !== 'win32';

interface Result {
  exitCode: number;
  screen: string[];
  all: string;
}

async function runInTerminal(args: string[], env: Record<string, string>, keys: [number, string][] = [], cols = 100, rows = 30): Promise<Result> {
  const { Terminal } = await import('@xterm/headless');
  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 5000 });
  const home = mkdtempSync(join(tmpdir(), 'unfold-e2e-'));
  const p = pty!.spawn(process.execPath, [bin, ...args], {
    cols,
    rows,
    cwd: home,
    env: { ...process.env, UNFOLD_HOME: home, UNFOLD_VERCEL_BIN: join(root, 'test', 'fixtures', 'fake-vercel.mjs'), ...env } as Record<string, string>,
  });
  p.onData((d) => term.write(d));
  for (const [ms, k] of keys) setTimeout(() => p.write(k), ms);
  const exitCode = await new Promise<number>((r) => p.onExit((e) => r(e.exitCode)));
  await new Promise<void>((r) => term.write('', r));
  const b = term.buffer.active;
  const line = (i: number) => (b.getLine(i)?.translateToString(true) ?? '').trimEnd();
  const screen = Array.from({ length: rows }, (_, i) => line(b.viewportY + i));
  // Rejoin rows the terminal soft-wrapped, as copying from a terminal would.
  let all = '';
  for (let i = 0; i < b.length; i++) all += (i && !b.getLine(i)?.isWrapped ? '\n' : '') + (b.getLine(i)?.translateToString(!b.getLine(i + 1)?.isWrapped) ?? '');
  return { exitCode, screen, all };
}

describe.runIf(canRun)('unfold vercel in a real terminal', () => {
  it('answers a CLI prompt, shows the live flow, and prints a success summary', async () => {
    const r = await runInTerminal(['vercel'], { FAKE_VERCEL_PROMPT: '1' }, [[1500, 'y']]);
    expect(r.exitCode).toBe(0);
    expect(r.all).toContain('? Set up and deploy “~/acme-web”? (y/N) y');
    expect(r.all).toContain('stdinTTY=true stdoutTTY=true');
    expect(r.all).toMatch(/Deployed in [\d.]+s/);
    expect(r.all).toMatch(/✓ Preview\s+Vercel reports the deployment is Ready\./);
    // The panel is gone at the end: nothing of it is left on screen.
    expect(r.screen.join('\n')).not.toMatch(/── unfold · .* Running/);
  }, 30_000);

  it('reports a build failure with the cause and a fix command', async () => {
    const r = await runInTerminal(['vercel'], { FAKE_VERCEL_DEMO: 'build-failure' });
    expect(r.exitCode).toBe(1);
    expect(r.all).toMatch(/✗ Build\s+Command "npm run build" exited with 1/);
    expect(r.all).toMatch(/Cause\s+Type error: Property 'totalCents'/);
    expect(r.all).toMatch(/Claude\s+claude "\$\(cat .*\.fix-prompt\.md'?\)"/);
  }, 30_000);

  it('handles Ctrl+C and gives the terminal back', async () => {
    const r = await runInTerminal(['vercel'], {}, [[2000, '\x03']]);
    expect(r.exitCode).toBe(130);
    expect(r.all).toMatch(/Stopped in [\d.]+s/);
    expect(r.all).toContain('Vercel may still finish it');
  }, 30_000);

  it('works without node-pty through the `script` fallback', async () => {
    const r = await runInTerminal(['vercel'], { UNFOLD_TERMINAL: 'script', FAKE_VERCEL_PROMPT: '1' }, [[1500, 'y']]);
    expect(r.exitCode).toBe(0);
    expect(r.all).toContain('stdinTTY=true stdoutTTY=true');
    expect(r.all).toMatch(/Deployed in [\d.]+s/);
  }, 30_000);

  it('prints clean usage errors', async () => {
    const r = await runInTerminal(['vercel', '--fix', 'gpt'], {});
    expect(r.exitCode).toBe(2);
    expect(r.all).toContain('unfold: --fix expects "claude" or "codex", got "gpt"');
    expect(r.all).not.toContain('    at ');
  }, 30_000);
});
