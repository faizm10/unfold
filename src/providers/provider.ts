import type { FlowState, LogLine, ProviderNotes, Signal, StageDefinition } from '../core/model.js';

export interface ProviderParser {
  /** Called once per captured line (and again if a redrawn line changes). */
  feed(line: LogLine): Signal[];
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
  /** Turn `unfold <id> [...userArgs]` into the real command line. */
  launch(userArgs: string[]): LaunchSpec;
  /** Optional preflight messages printed before launch (never blocking). */
  preflight?(cwd: string): string[];
  createParser(): ProviderParser;
  /** Provider knowledge to include in the fix prompt for a failed run. */
  fixHints?(state: FlowState): string[];
}
