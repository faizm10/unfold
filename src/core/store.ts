import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  }

  write(event: RunEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + '\n', { mode: 0o600 });
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
