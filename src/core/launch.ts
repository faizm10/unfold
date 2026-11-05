import { spawn } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { onRestore } from '../tui/restore.js';

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

/** `UNFOLD_TERMINAL=script|pipe` forces a fallback (for troubleshooting and tests). */
const forced = () => process.env.UNFOLD_TERMINAL as 'pty' | 'script' | 'pipe' | undefined;

function loadPty(): PtyModule | undefined {
  if (forced() === 'script' || forced() === 'pipe') return undefined;
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
  if (pty) return launchPty(pty, opts);
  if (terminalMode() === 'script') return launchScript(opts);
  return launchPiped(opts);
}

/**
 * How the wrapped command will be attached to the terminal:
 * - `pty`: node-pty, full control (live panel supported)
 * - `script`: the system `script` command gives the child a real TTY; used when node-pty
 *   isn't installed (e.g. Linux without build tools). The panel is off because the child
 *   sizes itself to the whole terminal.
 * - `pipe`: no TTY for the child; prompts and spinners may behave differently.
 */
export function terminalMode(): 'pty' | 'script' | 'pipe' {
  if (loadPty()) return 'pty';
  if (forced() !== 'pipe' && process.platform !== 'win32' && process.stdin.isTTY && which('script')) return 'script';
  return 'pipe';
}

const shQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function launchScript({ bin, args, cwd, term: io, onOutput }: LaunchOptions): Promise<ExitInfo> {
  // BSD/macOS: script -q file cmd args…   util-linux: script -qefc "cmd args…" file
  const scriptArgs =
    process.platform === 'darwin' || process.platform.endsWith('bsd')
      ? ['-q', '/dev/null', bin, ...args]
      : ['-qefc', [bin, ...args].map(shQuote).join(' '), '/dev/null'];
  const child = spawn('script', scriptArgs, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'inherit'] });
  let interrupted = false;
  const onSignal = (sig: NodeJS.Signals) => {
    interrupted = true;
    child.kill(sig);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  // `script` puts the terminal in raw mode itself; make sure it's undone if we die first.
  const release = onRestore(() => process.stdin.isTTY && process.stdin.setRawMode(false));
  child.stdout.on('data', (d: Buffer) => {
    const text = d.toString('utf8');
    io.write(text);
    onOutput(text);
  });
  return new Promise((resolve) => {
    child.on('error', (err) => onOutput(`Error: ${err.message}\n`));
    child.on('close', (code, signal) => {
      release();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      // Ctrl+C reaches the child through the TTY, so infer it from the exit status.
      resolve({ exitCode: code, signal, interrupted: interrupted || code === 130 || signal === 'SIGINT' });
    });
  });
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
  const release = onRestore(() => stdin.isTTY && stdin.setRawMode(false));
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
      release();
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
  process.stderr.write('[unfold] No pseudo-terminal available (node-pty is not installed); prompts and spinners may look different.\n');
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
