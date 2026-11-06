import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExitInfo, TerminalIO } from '../core/launch.js';
import type { Session } from '../core/session.js';
import { providers } from '../providers/index.js';
import { observe, say, type UiFlags } from './observe.js';

/** A recorded terminal transcript: raw output chunks with timing. */
export interface Transcript {
  provider: string;
  description: string;
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  interrupted: boolean;
  chunks: { t: number; d: string }[];
}

export const DEMOS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'demos');
export const DEMO_NAMES = ['success', 'build-failure', 'interrupted'] as const;

export function loadDemo(name: string): Transcript {
  return JSON.parse(readFileSync(join(DEMOS_DIR, `vercel-${name}.json`), 'utf8')) as Transcript;
}

export async function runDemo(name: string, flags: UiFlags, speed: number): Promise<number> {
  if (!(DEMO_NAMES as readonly string[]).includes(name)) {
    say(`Unknown demo "${name}". Try: ${DEMO_NAMES.join(', ')}`);
    return 2;
  }
  const t = loadDemo(name);
  const provider = providers[t.provider]!;
  say(`Demo: ${t.description} Recorded output, no Vercel account or network needed.`);
  return observe({
    provider,
    command: t.command,
    cwd: t.cwd,
    mode: 'demo',
    flags,
    save: true,
    waitForBrowser: true,
    run: (session, term) => play(t, session, speed, term),
  });
}

/** Plays a transcript to the terminal and the session. Ctrl+C stops playback. */
export function play(t: Transcript, session: Session, speed: number, term?: TerminalIO): Promise<ExitInfo> {
  const write = (d: string) => (term ? term.write(d) : process.stdout.write(d));
  return new Promise((resolve) => {
    let i = 0;
    let timer: NodeJS.Timeout | undefined;
    const start = Date.now();
    const onSigint = () => {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onSigint);
      write('^C\r\n');
      session.write('^C\r\n');
      resolve({ exitCode: 130, signal: null, interrupted: true });
    };
    process.on('SIGINT', onSigint);
    const step = () => {
      while (i < t.chunks.length && t.chunks[i]!.t / speed <= Date.now() - start) {
        const { d } = t.chunks[i++]!;
        write(d);
        session.write(d);
      }
      if (i >= t.chunks.length) {
        process.off('SIGINT', onSigint);
        resolve({ exitCode: t.exitCode, signal: t.signal, interrupted: t.interrupted });
        return;
      }
      timer = setTimeout(step, Math.max(0, t.chunks[i]!.t / speed - (Date.now() - start)));
    };
    step();
  });
}
