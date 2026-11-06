import { homedir } from 'node:os';
import type { ErrorInfo, FlowState, LogLine } from './model.js';

export type Agent = 'claude' | 'codex';
export const AGENTS: Agent[] = ['claude', 'codex'];

const MAX_EXCERPT = 40;
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z {0,2}/;
// path/to/file.ext:line[:col], as printed by compilers, bundlers and linters
const FILE_REF = /(?:^|[\s(])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.[\]-]+)*\.[A-Za-z]{1,5}):(\d+)(?::(\d+))?/g;

/** Most specific cause first, then by position in the output. */
export function rankCauses(state: FlowState): ErrorInfo[] {
  const fatal = state.errors.find((e) => e.severity === 'fatal');
  return state.errors
    .filter((e) => e.severity === 'cause' && e.message !== fatal?.message)
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || a.seq - b.seq);
}

function fileRefs(lines: string[]): string[] {
  const refs = new Set<string>();
  for (const line of lines) {
    for (const m of line.replace(STAMP, '').matchAll(FILE_REF)) {
      if (/^https?:/.test(m[1]!) || m[1]!.includes('node_modules')) continue;
      refs.add(`${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ''}`);
    }
  }
  return [...refs].slice(0, 8);
}

function excerpt(state: FlowState, logs: LogLine[], anchor: ErrorInfo | undefined): { from: number; to: number; lines: LogLine[] } {
  const sorted = [...logs].sort((a, b) => a.seq - b.seq);
  if (!sorted.length) return { from: 0, to: 0, lines: [] };
  const fatal = state.errors.find((e) => e.severity === 'fatal');
  const end = fatal?.seq ?? sorted.at(-1)!.seq;
  const start = anchor ? Math.max(anchor.seq - 12, end - MAX_EXCERPT + 1) : end - 30;
  const lines = sorted.filter((l) => l.seq >= start && l.seq <= end).slice(-MAX_EXCERPT);
  while (lines.length && lines[0]!.text.replace(STAMP, '').trim() === '') lines.shift();
  return { from: lines[0]?.seq ?? 0, to: lines.at(-1)?.seq ?? 0, lines };
}

const fence = (body: string) => '```\n' + body.replace(/```/g, '`​``') + '\n```';

/**
 * Builds a prompt for a coding agent from a failed run. Uses only the already
 * redacted log lines and parsed facts, so it contains nothing that isn't on the page.
 */
export function buildFixPrompt(state: FlowState, logs: LogLine[], hints: string[] = []): string | undefined {
  if (state.outcome !== 'failure') return undefined;
  const stage = (id?: string) => state.stages.find((s) => s.id === id)?.title;
  const fatal = state.errors.find((e) => e.severity === 'fatal');
  const causes = rankCauses(state);
  const top = causes[0];
  const ex = excerpt(state, logs, top);
  const refs = fileRefs([...causes.map((c) => c.message), ...ex.lines.map((l) => l.text)]);
  const facts = state.facts.filter((f) => !['inspectUrl', 'deploymentUrl', 'cliVersion', 'duration', 'region', 'machine'].includes(f.key));
  const failedStage = stage(state.failedStage) ?? 'an unknown stage';

  const out: string[] = [];
  out.push(`# Fix a failed ${state.title.toLowerCase()}`, '');
  out.push(
    `I ran \`${state.command.join(' ')}\` in \`${state.cwd}\` and it failed during the **${failedStage}** stage` +
      (state.lastConfirmed ? `. The last stage that completed was **${stage(state.lastConfirmed)}**.` : ', before any stage completed.') +
      ` It exited with ${state.exitCode !== null ? `code ${state.exitCode}` : (state.exitSignal ?? 'an unknown status')}.`,
  );
  out.push('', '## Error', fence(fatal?.message ?? 'The command failed without printing a recognizable error. See the log excerpt.'));
  if (causes.length) {
    out.push('', '## Most relevant output', fence(causes.slice(0, 4).map((c) => c.message).join('\n')));
  }
  if (ex.lines.length) {
    out.push('', `## Log excerpt (lines ${ex.from}–${ex.to})`, fence(ex.lines.map((l) => l.text.replace(STAMP, '')).join('\n')));
  }
  const context = [
    ...facts.map((f) => `- ${f.label}: ${f.value}`),
    ...(refs.length ? [`- Files mentioned in the output: ${refs.map((r) => `\`${r}\``).join(', ')}`] : []),
  ];
  if (context.length) out.push('', '## Context', ...context);
  if (hints.length) out.push('', '## Things to know about this failure', ...hints.map((h) => `- ${h}`));
  out.push(
    '',
    '## What I want',
    `1. Find the root cause in this repository${refs.length ? ', starting with the files mentioned above' : ''}.`,
    '2. Make the smallest change that fixes it, then reproduce the failing step locally to confirm the fix.',
    "3. Don't deploy, and don't change hosting settings or environment variables. If the fix needs that, tell me exactly what to change instead.",
    '4. Summarize what was wrong and what you changed.',
    '',
    'Values shown as [REDACTED] were removed on purpose; don\'t try to recover them.',
  );
  return out.join('\n') + '\n';
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** One-line shell commands that start each agent with the saved prompt. */
export function agentCommands(promptPath: string, home = homedir()): Record<Agent, string> {
  // `~/…` is shorter to read and copy; only used when no quoting is needed.
  const safe = /^[\w./-]+$/;
  const rest = promptPath.startsWith(home + '/') ? promptPath.slice(home.length) : undefined;
  const ref = rest && safe.test(home) && safe.test(rest) ? `~${rest}` : shQuote(promptPath);
  const arg = `"$(cat ${ref})"`;
  return { claude: `claude ${arg}`, codex: `codex ${arg}` };
}
