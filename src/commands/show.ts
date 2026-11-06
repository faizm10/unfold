import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FlowReducer } from '../core/flow.js';
import { readRun, runsDir } from '../core/store.js';
import { explore } from '../tui/explore.js';
import { style } from '../tui/ansi.js';
import { summary } from '../tui/render.js';
import type { UiFlags } from './observe.js';
import { say } from './observe.js';
import { listRuns, runReplay } from './replay.js';

/** Resolves a run file from a path, a run id (or its prefix), or the latest run. */
export function resolveRun(ref?: string): string | undefined {
  if (!ref) return listRuns()[0];
  if (existsSync(ref)) return ref;
  const byId = join(runsDir(), ref.endsWith('.jsonl') ? ref : `${ref}.jsonl`);
  if (existsSync(byId)) return byId;
  return listRuns().find((p) => p.split('/').pop()!.startsWith(ref));
}

/** `unfold show`: explore a finished run in the terminal (or the browser with --web). */
export async function runShow(ref: string | undefined, flags: UiFlags): Promise<number> {
  const path = resolveRun(ref);
  if (!path) {
    say(ref ? `No run matching "${ref}" in ${runsDir()}.` : `No saved runs yet in ${runsDir()}. Run \`unfold vercel\` or \`unfold demo\` first.`);
    return 1;
  }
  if (flags.web) return runReplay(path, { ...flags, panel: false }, 1e9);

  const reducer = new FlowReducer();
  for (const e of readRun(path)) reducer.apply(e);
  const state = reducer.state;
  if (!state) {
    say(`${path} is not an Unfold run file.`);
    return 1;
  }
  const logs = [...reducer.logs.values()];
  if (process.stdout.isTTY && process.stdin.isTTY) await explore(state, logs);
  else process.stdout.write(summary(state, logs, { s: style(false) }));
  return 0;
}
