import type { FlowState, ProviderNotes, Signal, StageDefinition } from '../../core/model.js';

// Shared by the coding-agent providers (Claude Code, Codex). Both are run in their
// non-interactive mode, which reports every step as a JSON event.

export type Activity = 'explore' | 'change' | 'verify';

export function agentStages(agent: string, docsUrl: string, permissions: string): StageDefinition[] {
  return [
    {
      id: 'start',
      title: 'Start',
      summary: `${agent} starts a session with its model, settings and the tools it may use.`,
      explanation: [
        `Unfold runs ${agent} in its non-interactive mode, which reports every step as a structured event instead of drawing a full-screen interface.`,
        `In this mode ${agent} cannot stop to ask you for permission, so it can only do what your settings and flags allow. ${permissions}`,
      ],
      confirmedBy: 'The session start event.',
      docsUrl,
    },
    {
      id: 'explore',
      title: 'Explore',
      summary: 'It reads files and searches the code to understand the task.',
      explanation: [
        'Agents usually start by looking around: listing folders, reading files, searching for symbols and running read-only commands such as `git status`.',
      ],
      confirmedBy: 'A successful read, search or read-only command.',
      docsUrl,
    },
    {
      id: 'change',
      title: 'Change',
      summary: 'It edits or creates files to carry out the task.',
      explanation: [
        'Edits are written straight to your working tree. Review them with `git diff` before committing.',
        'If it is not allowed to edit, its attempts are denied and the task cannot be completed.',
      ],
      confirmedBy: 'A successful file edit or write.',
      docsUrl,
    },
    {
      id: 'verify',
      title: 'Verify',
      summary: 'It runs checks such as tests, a type check, a linter or a build.',
      explanation: [
        'Unfold counts a command as a check when it looks like one, for example `npm test`, `pytest`, `tsc`, `eslint`, `cargo build` or `make`.',
        'If the agent never runs a check, this stays unverified: the change may still be right, but nothing in the run showed it working.',
      ],
      confirmedBy: 'A check command that exits successfully.',
      docsUrl,
    },
    {
      id: 'done',
      title: 'Done',
      summary: 'It reports its final answer and the session ends.',
      explanation: ['The final event says whether the session succeeded and, depending on the agent, how long it took, how many turns it used and what it cost.'],
      confirmedBy: 'The final result event, with no error.',
      docsUrl,
    },
  ];
}

export const AGENT_NOTES: ProviderNotes = {
  success: 'Done',
  successHeadline: 'The agent finished',
  docsLabel: 'Docs',
  highlights: ['answer', 'filesChanged', 'denied', 'cost', 'tokens'],
  interrupted: 'You pressed Ctrl+C while this was in progress. Changes the agent already wrote stay on disk; review them with `git diff`.',
  unverified: "This run's output never showed this step.",
};

const VERIFY =
  /(^|[\s;&|(])((npm|pnpm|yarn|bun)( run)? (test|build|lint|typecheck|check)\b|npx (tsc|vitest|jest|eslint|playwright)|\b(tsc|vitest|jest|mocha|pytest|tox|ruff|mypy|eslint|phpunit|rspec|playwright)\b|go (test|build|vet)|cargo (test|build|check|clippy)|\bmake\b|gradle|mvn|dotnet (test|build)|swift (test|build))/;
const CHANGE =
  /(^|[\s;&|(])(sed -i|perl -pi|tee |mv |rm |cp |mkdir |touch |chmod |apply_patch|git (commit|apply|checkout|restore|reset|stash|add)|(npm|pnpm|yarn|bun) (i|install|add|remove|uninstall)\b|pip install)|[^2&]>{1,2}\s*(?!\/dev\/null)[\w./]/;

/** Rough classification of a shell command by what it does. */
export function classifyCommand(cmd: string): Activity {
  if (VERIFY.test(cmd)) return 'verify';
  if (CHANGE.test(cmd)) return 'change';
  return 'explore';
}

/** `/bin/zsh -lc "npm test"` → `npm test` (Codex wraps commands in a login shell). */
export function unwrapShell(cmd: string): string {
  const m = /^\S*\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(cmd.trim()) ?? /^\S*\/(?:ba|z)?sh -l?c (\S+)$/.exec(cmd.trim());
  if (!m) return cmd;
  const inner = m.length === 3 ? m[2]! : m[1]!;
  return m[1] === "'" ? inner.replace(/'\\''/g, "'").replace(/'"'"'/g, "'") : inner.replace(/\\"/g, '"');
}

/** Shows paths relative to the session's folder when possible. */
export function relPath(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(cwd.replace(/\/$/, '') + '/')) return path.slice(cwd.replace(/\/$/, '').length + 1);
  return path;
}

export const oneLine = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

/** Tracks checks across a run so the end of the run can say how they went. */
export class CheckTracker {
  private last: { cmd: string; ok: boolean } | undefined;
  readonly changed = new Set<string>();

  record(cmd: string, ok: boolean): void {
    this.last = { cmd, ok };
  }

  finish(): Signal[] {
    const out: Signal[] = [];
    if (this.changed.size) {
      const files = [...this.changed];
      out.push({ kind: 'fact', key: 'filesChanged', label: 'Files changed', value: `${files.slice(0, 8).join(', ')}${files.length > 8 ? ` and ${files.length - 8} more` : ''}`, stage: 'change' });
    }
    if (this.last && !this.last.ok) {
      out.push({ kind: 'stage', stage: 'verify', status: 'unverified', note: `Checks ran, but the last one failed: ${oneLine(this.last.cmd, 80)}` });
    }
    return out;
  }
}

/** Hints for the fix prompt when an agent run fails. */
export function agentFixHints(state: FlowState, allowHint: string): string[] {
  const hints: string[] = [];
  const denied = state.facts.find((f) => f.key === 'denied');
  if (denied) hints.push(`The agent was denied permission for: ${denied.value}. ${allowHint}`);
  hints.push('Review what the agent already changed with `git diff` before running it again.');
  return hints;
}
