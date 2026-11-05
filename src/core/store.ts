import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent } from './model.js';

/** Runs are saved outside the project so they are never committed by accident. */
export function runsDir(): string {
  return process.env.UNFOLD_HOME ? join(process.env.UNFOLD_HOME, 'runs') : join(homedir(), '.unfold', 'runs');
}

/** Appends already-redacted events as JSON lines, readable only by the current user. */
export class RunRecorder {
  readonly path: string;

  constructor(runId: string) {
    const dir = runsDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.path = join(dir, `${runId}.jsonl`);
    pruneRuns();
  }

  write(event: RunEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + '\n', { mode: 0o600 });
  }
}

/** How many runs to keep; older ones (and their fix prompts) are deleted. `UNFOLD_KEEP_RUNS` overrides. */
export const KEEP_RUNS = 100;

export function pruneRuns(keep = Number(process.env.UNFOLD_KEEP_RUNS) || KEEP_RUNS): void {
  try {
    const dir = runsDir();
    const runs = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of runs.slice(keep)) {
      rmSync(join(dir, f), { force: true });
      rmSync(join(dir, f.replace(/\.jsonl$/, '.fix-prompt.md')), { force: true });
    }
  } catch {
    // Pruning is best effort.
  }
}

/** Saves a fix prompt next to the run, readable only by the current user. */
export function saveFixPrompt(runId: string, prompt: string): string {
  const dir = runsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${runId}.fix-prompt.md`);
  writeFileSync(path, prompt, { mode: 0o600 });
  return path;
}

export function readRun(path: string): RunEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunEvent);
}
