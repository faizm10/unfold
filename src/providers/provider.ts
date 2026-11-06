import type { FlowState, LogLine, ProviderNotes, Signal, StageDefinition } from '../core/model.js';

export interface ProviderParser {
  /** Called once per captured line (and again if a redrawn line changes). */
  feed(line: LogLine): Signal[];
  /** Called once when the command exits, before the outcome is decided. */
  finish?(): Signal[];
}

/** What a provider knows about the run it is parsing. */
export interface RunContext {
  /** Folder the command runs in. */
  cwd: string;
}

export interface LaunchSpec {
  /** Executable name or path, resolved on PATH. */
  bin: string;
  args: string[];
}

/** Everything Unfold needs to know about one CLI workflow. */
export interface Provider {
  id: string;
  title: string;
  stages: StageDefinition[];
  notes?: ProviderNotes;
  /** How to install the wrapped CLI, shown when it isn't on PATH. */
  install?: string;
  /** Turn `unfold <id> [...userArgs]` into the real command line. */
  launch(userArgs: string[]): LaunchSpec;
  /** Optional preflight messages printed before launch (never blocking). */
  preflight?(cwd: string): string[];
  createParser(ctx: RunContext): ProviderParser;
  /**
   * For CLIs that print machine-readable output (e.g. JSON events): turns each raw line
   * into the text shown in the terminal and logs, or null to hide it. The parser still
   * receives the raw line. When set, the raw output itself is not echoed.
   */
  createPresenter?(ctx: RunContext): (line: string) => string | null;
  /** Longest line to keep; JSON event streams can carry large payloads on one line. */
  maxLineLength?: number;
  /** Provider knowledge to include in the fix prompt for a failed run. */
  fixHints?(state: FlowState): string[];
}
