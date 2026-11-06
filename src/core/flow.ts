import type { ErrorInfo, FlowState, LogLine, ProviderNotes, RunEvent, StageState } from './model.js';

const MAX_EVIDENCE = 40;
const DEFAULT_NOTES: Required<Pick<ProviderNotes, 'interrupted' | 'unverified'>> & ProviderNotes = {
  interrupted: 'You pressed Ctrl+C while this stage was in progress, so its outcome was never reported.',
  unverified: "This run's output never confirmed this stage.",
};

/**
 * Pure reducer from RunEvents to FlowState plus the log. Rules:
 * - Stages only move forward on explicit signals from the provider parser; a later
 *   stage starting never implies an earlier one finished.
 * - When the run ends, anything not confirmed becomes `unverified` (or `failed` for
 *   the stage the failure is attributed to).
 */
export class FlowReducer {
  state: FlowState | undefined;
  readonly logs = new Map<number, LogLine>();
  private notes = DEFAULT_NOTES;

  apply(event: RunEvent): void {
    if (event.type === 'run.started') {
      this.notes = { ...DEFAULT_NOTES, ...event.notes };
      this.logs.clear();
      this.state = {
        runId: event.runId,
        provider: event.provider,
        title: event.title,
        command: event.command,
        cwd: event.cwd,
        mode: event.mode,
        startedAt: event.at,
        outcome: 'running',
        exitCode: null,
        exitSignal: null,
        stages: event.stages.map((d) => ({ ...d, status: 'pending', evidence: [] })),
        notes: event.notes,
        facts: [],
        errors: [],
        lineCount: 0,
      };
      return;
    }
    const s = this.state;
    if (!s) return;

    switch (event.type) {
      case 'log':
        this.logs.set(event.line.seq, event.line);
        s.lineCount = this.logs.size;
        return;
      case 'signal':
        this.signal(s, event);
        return;
      case 'run.ended':
        this.end(s, event);
        return;
      case 'fix.ready':
        s.fix = event.fix;
        return;
    }
  }

  private stage(s: FlowState, id: string | undefined): StageState | undefined {
    return id ? s.stages.find((st) => st.id === id) : undefined;
  }

  private addEvidence(st: StageState, seq: number, at: number, note: string): void {
    const text = this.logs.get(seq)?.text ?? '';
    const existing = st.evidence.find((e) => e.seq === seq);
    if (existing) {
      // Same line redrawn (e.g. a progress bar): keep the latest version.
      existing.text = text;
      existing.note = note;
      existing.at = at;
      return;
    }
    st.evidence.push({ seq, at, text, note });
    if (st.evidence.length > MAX_EVIDENCE) st.evidence.splice(1, 1); // keep the first line
  }

  private signal(s: FlowState, e: Extract<RunEvent, { type: 'signal' }>): void {
    const sig = e.signal;
    switch (sig.kind) {
      case 'stage': {
        const st = this.stage(s, sig.stage);
        if (!st) return;
        if (sig.status === 'active') {
          if (st.status === 'pending' || st.status === 'active') {
            st.status = 'active';
            st.startedAt ??= e.at;
            st.note = sig.note;
          }
        } else if (sig.status === 'confirmed') {
          if (st.status !== 'failed') {
            st.status = 'confirmed';
            st.startedAt ??= e.at;
            st.endedAt = e.at;
            st.note = sig.note;
          }
        } else if (sig.status === 'unverified') {
          // A parser saying "this happened but didn't succeed" (e.g. checks ran and failed).
          if (st.status === 'pending' || st.status === 'active') {
            st.status = 'unverified';
            st.note = sig.note;
          }
        } else if (st.status !== 'confirmed') {
          st.status = 'failed';
          st.endedAt = e.at;
          st.note = sig.note;
          s.failedStage = st.id;
        }
        this.addEvidence(st, e.seq, e.at, sig.note);
        this.updateLastConfirmed(s);
        return;
      }
      case 'evidence': {
        const st = this.stage(s, sig.stage);
        if (st) this.addEvidence(st, e.seq, e.at, sig.note);
        return;
      }
      case 'fact': {
        const existing = s.facts.find((f) => f.key === sig.key);
        const fact = { key: sig.key, label: sig.label, value: sig.value, stage: sig.stage, href: sig.href, seq: e.seq };
        if (existing) Object.assign(existing, fact);
        else s.facts.push(fact);
        return;
      }
      case 'error': {
        const info: ErrorInfo = { severity: sig.severity, priority: sig.priority, stage: sig.stage, message: sig.message, seq: e.seq, at: e.at };
        if (!s.errors.some((x) => x.seq === e.seq && x.message === sig.message)) s.errors.push(info);
        if (sig.severity === 'fatal') {
          const st = this.stage(s, sig.stage) ?? this.currentStage(s);
          if (st && st.status !== 'confirmed') {
            // Keep a note the parser already gave the failure (e.g. "Creating Revision failed.");
            // the full message is shown as the error.
            if (st.status !== 'failed' || !st.note) st.note = sig.message;
            st.status = 'failed';
            st.endedAt = e.at;
            s.failedStage = st.id;
            info.stage = st.id;
            this.addEvidence(st, e.seq, e.at, 'Error reported here');
          }
        }
        return;
      }
    }
  }

  /** The stage work is most plausibly happening in right now. */
  private currentStage(s: FlowState): StageState | undefined {
    const active = [...s.stages].reverse().find((st) => st.status === 'active');
    if (active) return active;
    const lastIdx = s.stages.findLastIndex((st) => st.status === 'confirmed');
    return s.stages[lastIdx + 1] ?? s.stages[lastIdx];
  }

  private updateLastConfirmed(s: FlowState): void {
    const idx = s.stages.findLastIndex((st) => st.status === 'confirmed');
    s.lastConfirmed = idx >= 0 ? s.stages[idx]!.id : undefined;
  }

  private end(s: FlowState, e: Extract<RunEvent, { type: 'run.ended' }>): void {
    s.endedAt = e.at;
    s.exitCode = e.exitCode;
    s.exitSignal = e.signal;
    const failed = e.exitCode !== 0 || e.signal !== null;
    const finished = s.stages.at(-1)?.status === 'confirmed';

    // Ctrl+C after the workflow already finished successfully does not change the outcome.
    if (e.interrupted && (failed || !finished)) {
      s.outcome = 'interrupted';
    } else if (failed) {
      s.outcome = 'failure';
      if (!s.failedStage) {
        const st = this.stage(s, s.errors.find((x) => x.severity === 'fatal')?.stage) ?? this.currentStage(s);
        if (st && st.status !== 'confirmed') {
          st.status = 'failed';
          st.endedAt = e.at;
          st.note ??= `The command exited with code ${e.exitCode ?? e.signal} during this stage.`;
          s.failedStage = st.id;
        }
      }
    } else {
      s.outcome = 'success';
    }

    // Index of the furthest stage the run is known to have reached.
    const reached = s.stages.findLastIndex((st) => st.status !== 'pending');
    s.stages.forEach((st, i) => {
      if (st.status === 'active') {
        st.status = 'unverified';
        st.note = s.outcome === 'interrupted' ? this.notes.interrupted : this.notes.unverified;
      } else if (st.status === 'pending') {
        st.status = 'unverified';
        // A stage skipped over by later ones: prefer the parser's own explanation, if it gave one.
        if (i < reached) st.note = st.evidence.at(-1)?.note ?? this.notes.unverified;
        else if (s.outcome === 'interrupted') st.note = 'The run stopped before this stage was observed.';
        else if (s.outcome === 'failure') st.note = 'Not reached: the run failed before this stage.';
        else st.note = this.notes.unverified;
      }
    });
    this.updateLastConfirmed(s);
  }
}
