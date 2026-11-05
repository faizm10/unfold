// Shared, provider-agnostic event model. Providers (vercel today, gcloud later)
// only produce `Signal`s from log lines; everything else lives here.

export type StageStatus = 'pending' | 'active' | 'confirmed' | 'failed' | 'unverified';
export type Outcome = 'running' | 'success' | 'failure' | 'interrupted';
export type RunMode = 'live' | 'demo' | 'replay';

/** General, run-independent description of a stage. Never evidence. */
export interface StageDefinition {
  id: string;
  title: string;
  /** One plain-language sentence. */
  summary: string;
  /** A few short paragraphs explaining what usually happens. */
  explanation: string[];
  /** What output from a run would confirm this stage. */
  confirmedBy: string;
  docsUrl?: string;
}

/** One line of captured terminal output, ANSI-stripped and redacted. */
export interface LogLine {
  seq: number;
  /** Epoch ms when the line was (last) written. */
  at: number;
  text: string;
}

/** What a provider parser can claim about a single log line. */
export type Signal =
  | { kind: 'stage'; stage: string; status: 'active' | 'confirmed' | 'failed'; note: string }
  | { kind: 'evidence'; stage: string; note: string }
  | { kind: 'fact'; key: string; label: string; value: string; stage?: string; href?: string }
  /**
   * `fatal` errors are definitive (the CLI said it failed) and mark the stage failed.
   * `cause` errors are suspicious lines kept as candidates; they only surface if the run fails.
   */
  | { kind: 'error'; severity: 'fatal' | 'cause'; stage?: string; message: string; priority?: number };

export type RunEvent =
  | {
      type: 'run.started';
      at: number;
      runId: string;
      provider: string;
      title: string;
      command: string[];
      cwd: string;
      mode: RunMode;
      stages: StageDefinition[];
      notes?: ProviderNotes;
    }
  | { type: 'log'; line: LogLine }
  | { type: 'signal'; at: number; seq: number; signal: Signal }
  | { type: 'run.ended'; at: number; exitCode: number | null; signal: string | null; interrupted: boolean }
  /** Emitted after a failed run: a ready-to-use prompt for a coding agent. */
  | { type: 'fix.ready'; at: number; fix: FixPrompt };

export interface FixPrompt {
  prompt: string;
  /** Where the prompt was saved locally, if it was. */
  path?: string;
  /** Shell one-liners that start an agent with the saved prompt. */
  commands?: Record<'claude' | 'codex', string>;
}

export interface ProviderNotes {
  /** Shown on the stage that was in progress when the user pressed Ctrl+C. */
  interrupted?: string;
  /** Shown on stages the output never confirmed. */
  unverified?: string;
}

export interface Evidence {
  seq: number;
  at: number;
  text: string;
  note: string;
}

export interface StageState extends StageDefinition {
  status: StageStatus;
  /** Latest observed status note (from the run), or a reason it is unverified. */
  note?: string;
  startedAt?: number;
  endedAt?: number;
  evidence: Evidence[];
}

export interface Fact {
  key: string;
  label: string;
  value: string;
  stage?: string;
  href?: string;
  seq: number;
}

export interface ErrorInfo {
  severity: 'fatal' | 'cause';
  /** Higher = more specific explanation of the failure (causes only). */
  priority?: number;
  stage?: string;
  message: string;
  seq: number;
  at: number;
}

export interface FlowState {
  runId: string;
  provider: string;
  title: string;
  command: string[];
  cwd: string;
  mode: RunMode;
  startedAt: number;
  endedAt?: number;
  outcome: Outcome;
  exitCode: number | null;
  exitSignal: string | null;
  stages: StageState[];
  facts: Fact[];
  errors: ErrorInfo[];
  /** Highest-index stage confirmed by output. */
  lastConfirmed?: string;
  failedStage?: string;
  lineCount: number;
  savedTo?: string;
  fix?: FixPrompt;
}
