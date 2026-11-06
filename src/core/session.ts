import { randomBytes } from 'node:crypto';
import type { Provider, ProviderParser } from '../providers/provider.js';
import { FlowReducer } from './flow.js';
import { agentCommands, buildFixPrompt } from './fix-prompt.js';
import type { FlowState, LogLine, RunEvent, RunMode } from './model.js';
import { Redactor } from './redact.js';
import { redrawKey, TerminalDecoder, type DecodedLine } from './terminal.js';

export type Listener = (event: RunEvent, state: FlowState) => void;

export interface SessionOptions {
  provider: Provider;
  command: string[];
  cwd: string;
  mode: RunMode;
  redactor?: Redactor;
  now?: () => number;
  /** Persists the fix prompt for a failed run; returns the saved path. */
  saveFixPrompt?: (runId: string, prompt: string) => string | undefined;
}

/**
 * One observed run: raw terminal output in, redacted lines + provider signals +
 * flow state out. Everything emitted from here is already redacted.
 */
export class Session {
  readonly reducer = new FlowReducer();
  readonly runId: string;
  private readonly parser: ProviderParser;
  private readonly decoder: TerminalDecoder;
  private readonly redactor: Redactor;
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private seq = 0;
  private last: { line: LogLine; transient: boolean; key: string } | undefined;
  private ended = false;

  constructor(private readonly opts: SessionOptions) {
    this.now = opts.now ?? Date.now;
    this.runId = new Date(this.now()).toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
    this.parser = opts.provider.createParser();
    this.redactor = opts.redactor ?? new Redactor();
    this.decoder = new TerminalDecoder((l) => this.onLine(l));
  }

  get state(): FlowState {
    return this.reducer.state!;
  }

  get logs(): LogLine[] {
    return [...this.reducer.logs.values()];
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    const p = this.opts.provider;
    this.emit({
      type: 'run.started',
      at: this.now(),
      runId: this.runId,
      provider: p.id,
      title: p.title,
      command: this.opts.command,
      cwd: this.opts.cwd,
      mode: this.opts.mode,
      stages: p.stages,
      notes: p.notes,
    });
  }

  /** Feed raw terminal output (may contain partial lines and escape codes). */
  write(chunk: string): void {
    if (!this.ended) this.decoder.write(chunk);
  }

  end(exitCode: number | null, signal: string | null, interrupted: boolean): void {
    if (this.ended) return;
    this.decoder.end();
    this.ended = true;
    this.emit({ type: 'run.ended', at: this.now(), exitCode, signal, interrupted });

    const prompt = buildFixPrompt(this.state, this.logs, this.opts.provider.fixHints?.(this.state) ?? []);
    if (prompt) {
      let path: string | undefined;
      try {
        path = this.opts.saveFixPrompt?.(this.runId, prompt);
      } catch {
        // The prompt is still shown in the UI.
      }
      this.emit({ type: 'fix.ready', at: this.now(), fix: { prompt, path, commands: path ? agentCommands(path) : undefined } });
    }
  }

  private onLine({ text: rawText, transient }: DecodedLine): void {
    const text = this.redactor.line(rawText);
    const key = redrawKey(text);
    const at = this.now();
    let line: LogLine;
    // A redrawn spinner/progress line replaces the previous one instead of piling up.
    if (this.last?.transient && this.last.key === key) {
      if (this.last.line.text === text) {
        this.last.transient = transient;
        return;
      }
      line = { seq: this.last.line.seq, at, text };
    } else {
      line = { seq: ++this.seq, at, text };
    }
    this.last = { line, transient, key };
    this.emit({ type: 'log', line });
    for (const signal of this.parser.feed(line)) this.emit({ type: 'signal', at, seq: line.seq, signal });
  }

  private emit(event: RunEvent): void {
    this.reducer.apply(event);
    const state = this.reducer.state!;
    for (const fn of this.listeners) fn(event, state);
  }
}
