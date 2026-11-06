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
  private readonly present: ((line: string) => string | null) | undefined;
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
    this.parser = opts.provider.createParser({ cwd: opts.cwd });
    this.redactor = opts.redactor ?? new Redactor();
    this.present = opts.provider.createPresenter?.({ cwd: opts.cwd });
    this.decoder = new TerminalDecoder((l) => this.onLine(l), opts.provider.maxLineLength);
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

  /**
   * Replays an already-processed event (log, signal, fix) from a saved run. Used for
   * providers whose raw output isn't saved, such as JSON event streams.
   */
  inject(event: RunEvent): void {
    if (event.type === 'log' || event.type === 'signal' || event.type === 'fix.ready') this.emit(event);
  }

  /** Ends a replayed run without re-running the parser. */
  endReplay(exitCode: number | null, signal: string | null, interrupted: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.emit({ type: 'run.ended', at: this.now(), exitCode, signal, interrupted });
  }

  /** Feed raw terminal output (may contain partial lines and escape codes). */
  write(chunk: string): void {
    if (!this.ended) this.decoder.write(chunk);
  }

  end(exitCode: number | null, signal: string | null, interrupted: boolean): void {
    if (this.ended) return;
    this.decoder.end();
    this.ended = true;
    const at = this.now();
    const seq = this.last?.line.seq ?? 0;
    for (const signal of this.parser.finish?.() ?? []) this.emit({ type: 'signal', at, seq, signal });
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
    const raw = this.redactor.line(rawText);
    const at = this.now();
    const shown = this.present ? this.present(raw) : raw;
    if (shown === null) {
      // Hidden line (e.g. a structured event with nothing to show): its signals attach
      // to the last visible line.
      const seq = this.last?.line.seq ?? 0;
      for (const signal of this.parser.feed({ seq, at, text: raw })) this.emit({ type: 'signal', at, seq, signal });
      return;
    }
    const text = shown;
    const key = redrawKey(text);
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
    for (const signal of this.parser.feed({ ...line, text: raw })) this.emit({ type: 'signal', at, seq: line.seq, signal });
  }

  private emit(event: RunEvent): void {
    this.reducer.apply(event);
    const state = this.reducer.state!;
    for (const fn of this.listeners) fn(event, state);
  }
}
