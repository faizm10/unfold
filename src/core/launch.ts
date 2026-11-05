import { spawn } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export interface ExitInfo {
  exitCode: number | null;
  signal: string | null;
  /** The user pressed Ctrl+C (or Unfold received SIGINT/SIGTERM) during the run. */
  interrupted: boolean;
}

/** The user's terminal, as seen by the wrapped command (some rows may hold Unfold's panel). */
export interface TerminalIO {
  write(chunk: string): void;
  rows(): number;
  onRowsChange(fn: (rows: number) => void): void;
}

export interface LaunchOptions {
  bin: string;
  args: string[];
  cwd: string;
  term: TerminalIO;
  onOutput: (chunk: string) => void;
}

const require = createRequire(import.meta.url);

/** Finds an executable on PATH without running a shell. */
export function which(bin: string): string | undefined {
  if (isAbsolute(bin) || bin.includes('/')) return existsSync(bin) ? bin : undefined;
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

type PtyModule = typeof import('node-pty');

function loadPty(): PtyModule | undefined {
  try {
    const pty = require('node-pty') as PtyModule;
    // node-pty 1.1.0 prebuilds can ship spawn-helper without its execute bit.
    const root = dirname(require.resolve('node-pty/package.json'));
    const helper = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
    return pty;
  } catch {
    return undefined;
  }
}

/**
 * Runs the command attached to the user's terminal. With node-pty the child sees a
 * real TTY, so prompts, colors and spinners behave exactly as they would without
 * Unfold; all keystrokes (including Ctrl+C) are forwarded to it.
 *
 * The child inherits the environment so it can use the existing login and project
 * config. Unfold never records the environment.
 */
export function launch(opts: LaunchOptions): Promise<ExitInfo> {
  const pty = loadPty();
  return pty ? launchPty(pty, opts) : launchPiped(opts);
}

function launchPty(pty: PtyModule, { bin, args, cwd, term: io, onOutput }: LaunchOptions): Promise<ExitInfo> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const term = pty.spawn(bin, args, {
    name: process.env.TERM || 'xterm-256color',
    cols: stdout.columns || 100,
    rows: io.rows(),
    cwd,
    env: process.env as Record<string, string>,
  });

  let interrupted = false;
  const onInput = (data: Buffer) => {
    if (data.includes(0x03)) interrupted = true;
    term.write(data.toString('utf8'));
  };
  let alive = true;
  const onResize = () => alive && term.resize(stdout.columns || 100, io.rows());
  io.onRowsChange(onResize);
  // Signals that reach Unfold directly (not via the TTY) are passed on.
  const onSignal = (sig: NodeJS.Signals) => {
    interrupted = true;
    try {
      term.kill(sig);
    } catch {
      // already gone
    }
  };

  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onInput);
  stdout.on('resize', onResize);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  term.onData((d) => {
    io.write(d);
    onOutput(d);
  });

  return new Promise((resolve) => {
    term.onExit(({ exitCode, signal }) => {
      alive = false;
      stdin.off('data', onInput);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdout.off('resize', onResize);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      const sig = signal ? signalName(signal) : null;
      resolve({ exitCode: sig ? null : exitCode, signal: sig, interrupted });
    });
  });
}

function launchPiped({ bin, args, cwd, term: io, onOutput }: LaunchOptions): Promise<ExitInfo> {
  process.stderr.write('[unfold] node-pty unavailable; running without a pseudo-terminal (spinners and prompts may look different).\n');
  const child = spawn(bin, args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
  let interrupted = false;
  const onSignal = (sig: NodeJS.Signals) => {
    interrupted = true;
    child.kill(sig);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  child.stdout.on('data', (d: Buffer) => {
    io.write(d.toString('utf8'));
    onOutput(d.toString('utf8'));
  });
  child.stderr.on('data', (d: Buffer) => {
    process.stderr.write(d);
    onOutput(d.toString('utf8'));
  });
  return new Promise((resolve) => {
    child.on('error', (err) => {
      onOutput(`Error: ${err.message}\n`);
    });
    child.on('close', (code, signal) => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve({ exitCode: code, signal, interrupted });
    });
  });
}

function signalName(n: number): string {
  const names: Record<number, string> = { 1: 'SIGHUP', 2: 'SIGINT', 9: 'SIGKILL', 15: 'SIGTERM' };
  return names[n] ?? `signal ${n}`;
}
