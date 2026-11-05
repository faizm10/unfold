import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent } from '../core/model.js';
import { readRun, runsDir } from '../core/store.js';
import { providers } from '../providers/index.js';
import { observe, say, type UiFlags } from './observe.js';

/** Replays a run saved by `unfold vercel` (already-redacted events). */
export async function runReplay(file: string | undefined, flags: UiFlags, speed: number): Promise<number> {
  const path = file ? ((await import('./show.js')).resolveRun(file) ?? file) : latestRun();
  if (!path) {
    say(`No saved runs in ${runsDir()}.`);
    return 1;
  }
  const events = readRun(path);
  const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
  const ended = events.find((e): e is Extract<RunEvent, { type: 'run.ended' }> => e.type === 'run.ended');
  const provider = started && providers[started.provider];
  if (!started || !provider) {
    say(`${path} is not an Unfold run file.`);
    return 1;
  }
  say(`Replaying ${path}`);
  return observe({
    provider,
    command: started.command,
    cwd: started.cwd,
    mode: 'replay',
    flags,
    save: false,
    waitForBrowser: true,
    run: async (session, term) => {
      // Re-run the original lines through today's parser so parser fixes apply to old runs.
      const t0 = started.at;
      const start = Date.now();
      for (const e of events) {
        if (e.type !== 'log') continue;
        const wait = (e.line.at - t0) / speed - (Date.now() - start);
        if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 2000)));
        term.write(e.line.text + '\r\n');
        session.write(e.line.text + '\n');
      }
      return { exitCode: ended?.exitCode ?? null, signal: ended?.signal ?? null, interrupted: ended?.interrupted ?? false };
    },
  });
}

export function listRuns(): string[] {
  try {
    const dir = runsDir();
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

function latestRun(): string | undefined {
  return listRuns()[0];
}
