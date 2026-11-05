import { spawn } from 'node:child_process';
import type { Agent } from '../core/fix-prompt.js';
import { which, type ExitInfo, type TerminalIO } from '../core/launch.js';
import type { RunMode } from '../core/model.js';
import { Redactor } from '../core/redact.js';
import { startServer, type UiServer } from '../core/server.js';
import { Session } from '../core/session.js';
import { RunRecorder, saveFixPrompt } from '../core/store.js';
import type { Provider } from '../providers/provider.js';
import { style } from '../tui/ansi.js';
import { LivePanel, panelSupported } from '../tui/panel.js';
import { summary } from '../tui/render.js';

export interface UiFlags {
  /** Also serve the flow view in a local browser page. Off by default. */
  web: boolean;
  /** Open the browser when `web` is on. */
  open: boolean;
  /** With `web`: exit when the run ends instead of keeping the page served. */
  once: boolean;
  port?: number;
  /** After a failed run, start this coding agent with the fix prompt. */
  fix?: Agent;
  /** Disable the live panel pinned to the bottom of the terminal. */
  panel: boolean;
}

export const DEFAULT_FLAGS: UiFlags = { web: false, open: true, once: false, panel: true };

export interface ObserveOptions {
  provider: Provider;
  command: string[];
  cwd: string;
  mode: RunMode;
  flags: UiFlags;
  save: boolean;
  /** Wait briefly for the browser so the flow is watched from the start (demos). */
  waitForBrowser?: boolean;
  run: (session: Session, term: TerminalIO) => Promise<ExitInfo>;
}

const err = style(!!process.stderr.isTTY && !process.env.NO_COLOR);
export const say = (msg: string) => process.stderr.write(`${err.dim('[unfold]')} ${msg}\n`);

export async function observe(opts: ObserveOptions): Promise<number> {
  const session = new Session({
    provider: opts.provider,
    command: opts.command,
    cwd: opts.cwd,
    mode: opts.mode,
    // Secret-looking env values are matched in memory only; the environment is never saved.
    redactor: new Redactor({ env: opts.mode === 'live' ? process.env : {} }),
    saveFixPrompt,
  });

  let recorder: RunRecorder | undefined;
  if (opts.save) {
    recorder = new RunRecorder(session.runId);
    session.subscribe((event) => recorder!.write(event));
  }
  session.start();
  if (recorder) session.state.savedTo = recorder.path;

  let server: UiServer | undefined;
  if (opts.flags.web) {
    server = await startServer(session, opts.flags.port);
    say(`Flow view in your browser: ${server.url}`);
    if (opts.flags.open) openBrowser(server.url);
    if (opts.waitForBrowser && opts.flags.open) await server.waitForClient(6000);
  }

  // The live flow panel, pinned below the command's own output.
  const rowsListeners = new Set<(rows: number) => void>();
  const panel =
    opts.flags.panel && panelSupported()
      ? new LivePanel({ title: [opts.command[0]!.split('/').pop(), ...opts.command.slice(1)].join(' '), onRowsChange: (r) => rowsListeners.forEach((fn) => fn(r)) })
      : undefined;
  if (panel) {
    panel.update(session.state);
    session.subscribe((_e, state) => panel.update(state));
    panel.start();
  }
  const term: TerminalIO = {
    write(chunk) {
      process.stdout.write(chunk);
      panel?.afterChildOutput(chunk);
    },
    rows: () => panel?.childRows ?? (process.stdout.rows || 30),
    onRowsChange: (fn) => rowsListeners.add(fn),
  };

  let exit: ExitInfo;
  try {
    exit = await opts.run(session, term);
  } finally {
    panel?.stop();
  }
  session.end(exit.exitCode, exit.signal, exit.interrupted);
  process.stderr.write(summary(session.state, session.logs, { cols: process.stderr.columns, s: err, webUrl: server?.url }));

  if (session.state.fix && opts.flags.fix) await startAgent(opts.flags.fix, session.state.fix.prompt, opts);

  if (server) {
    if (opts.flags.once) {
      await new Promise((r) => setTimeout(r, 300));
    } else {
      say(err.dim('Still serving the browser view. Press Ctrl+C to exit.'));
      await new Promise<void>((resolve) => {
        process.stdin.pause();
        process.once('SIGINT', () => resolve());
        process.once('SIGTERM', () => resolve());
      });
    }
    await server.close();
  }
  return exit.exitCode ?? (session.state.outcome === 'interrupted' ? 130 : 1);
}

/** Hands the terminal to a coding agent, started with the fix prompt, in the project folder. */
async function startAgent(agent: Agent, prompt: string, opts: ObserveOptions): Promise<void> {
  if (opts.mode === 'demo') {
    say(`--fix is ignored for demos: the demo project isn't on your machine. Use the command above in a real project.`);
    return;
  }
  const bin = which(agent);
  if (!bin) {
    say(`Could not find "${agent}" on your PATH, so it wasn't started. The prompt is saved above.`);
    return;
  }
  say(`Starting ${agent === 'claude' ? 'Claude Code' : 'Codex'} with the fix prompt in ${opts.cwd}…\n`);
  await new Promise<void>((resolve) => {
    const child = spawn(bin, [prompt], { cwd: opts.cwd, stdio: 'inherit' });
    // Ctrl+C belongs to the agent while it runs.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    child.on('error', (e) => say(`Could not start ${agent}: ${e.message}`));
    child.on('close', () => {
      process.off('SIGINT', ignore);
      resolve();
    });
  });
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => say(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    say(`Open ${url} in your browser.`);
  }
}
