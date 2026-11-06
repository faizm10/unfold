import { UsageError } from '../../core/errors.js';
import type { LogLine, Signal } from '../../core/model.js';
import type { Provider, ProviderParser } from '../provider.js';
import { agentFixHints, AGENT_NOTES, agentStages, CheckTracker, classifyCommand, oneLine, relPath, unwrapShell } from './shared.js';

// Event format from Codex CLI 0.165 `codex exec --json`: thread.started, turn.started,
// item.started / item.completed (command_execution, file_change, agent_message, …),
// then turn.completed, or turn.failed / error.

interface Item {
  id?: string;
  type?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: { path: string; kind: string }[];
  text?: string;
  server?: string;
  tool?: string;
  query?: string;
  message?: string;
}

interface Event {
  type: string;
  thread_id?: string;
  item?: Item;
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

const parse = (text: string): Event | undefined => {
  if (!text.startsWith('{')) return undefined;
  try {
    return JSON.parse(text) as Event;
  } catch {
    return undefined;
  }
};

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function describeChanges(changes: { path: string; kind: string }[], cwd?: string): string {
  return changes.map((c) => `${c.kind === 'add' ? 'add' : c.kind === 'delete' ? 'delete' : 'edit'} ${relPath(c.path, cwd)}`).join(', ');
}

export class CodexParser implements ProviderParser {
  private readonly checks = new CheckTracker();

  constructor(private readonly cwd = process.cwd()) {}

  feed(line: LogLine): Signal[] {
    const e = parse(line.text.trim());
    if (!e) {
      const t = line.text.trim();
      // Codex prints its own warnings and errors as plain text; MCP transport noise is not a task error.
      return /^(error|fatal)\b|not logged in|unauthorized/i.test(t) && !/rmcp::|mcp/i.test(t) ? [{ kind: 'error', severity: 'cause', stage: 'start', message: t }] : [];
    }
    const it = e.item ?? {};
    switch (e.type) {
      case 'thread.started':
        return [{ kind: 'stage', stage: 'start', status: 'confirmed', note: 'Session started.' }];
      case 'item.started':
        if (it.type === 'command_execution' && it.command) {
          const cmd = unwrapShell(it.command);
          return [{ kind: 'stage', stage: classifyCommand(cmd), status: 'active', note: `$ ${oneLine(cmd, 140)}` }];
        }
        if (it.type === 'file_change') return [{ kind: 'stage', stage: 'change', status: 'active', note: `Editing ${describeChanges(it.changes ?? [], this.cwd)}` }];
        return [];
      case 'item.completed':
        return this.completed(it);
      case 'turn.completed': {
        const u = e.usage ?? {};
        const out: Signal[] = [];
        if (u.input_tokens !== undefined) out.push({ kind: 'fact', key: 'tokens', label: 'Tokens', value: `${k(u.input_tokens)} in (${k(u.cached_input_tokens ?? 0)} cached), ${k(u.output_tokens ?? 0)} out`, stage: 'done' });
        out.push({ kind: 'stage', stage: 'done', status: 'confirmed', note: 'Finished the turn.' });
        return out;
      }
      case 'turn.failed':
        return [{ kind: 'error', severity: 'fatal', stage: 'done', message: e.error?.message ?? 'The turn failed.' }];
      case 'error':
        return [{ kind: 'error', severity: 'fatal', stage: 'done', message: e.message ?? e.error?.message ?? 'Codex reported an error.' }];
      default:
        return [];
    }
  }

  private completed(it: Item): Signal[] {
    switch (it.type) {
      case 'command_execution': {
        const cmd = unwrapShell(it.command ?? '');
        const kind = classifyCommand(cmd);
        const ok = it.exit_code === 0 && it.status !== 'failed';
        if (kind === 'verify') this.checks.record(cmd, ok);
        if (ok) return [{ kind: 'stage', stage: kind, status: 'confirmed', note: kind === 'verify' ? `Check passed: ${oneLine(cmd, 100)}` : `$ ${oneLine(cmd, 140)}` }];
        const out: Signal[] = [{ kind: 'evidence', stage: kind, note: `Failed (exit ${it.exit_code ?? '?'}): $ ${oneLine(cmd, 120)}` }];
        if (kind === 'verify') {
          const tail = oneLine((it.aggregated_output ?? '').trim().split('\n').slice(-3).join(' '), 160);
          out.push({ kind: 'error', severity: 'cause', stage: 'verify', message: `${oneLine(cmd, 80)} exited with ${it.exit_code ?? '?'}${tail ? `: ${tail}` : ''}`, priority: 2 });
        }
        return out;
      }
      case 'file_change': {
        const changes = it.changes ?? [];
        if (it.status === 'failed') return [{ kind: 'evidence', stage: 'change', note: `Failed to change ${describeChanges(changes, this.cwd)}` }];
        for (const c of changes) this.checks.changed.add(relPath(c.path, this.cwd));
        return [{ kind: 'stage', stage: 'change', status: 'confirmed', note: `Changed: ${describeChanges(changes, this.cwd)}` }];
      }
      case 'mcp_tool_call':
        return [{ kind: 'stage', stage: 'explore', status: it.status === 'failed' ? 'active' : 'confirmed', note: `Tool ${it.server ?? ''}.${it.tool ?? ''}` }];
      case 'web_search':
        return [{ kind: 'stage', stage: 'explore', status: 'confirmed', note: `Web search: ${oneLine(it.query ?? '', 60)}` }];
      case 'agent_message':
        return it.text ? [{ kind: 'fact', key: 'answer', label: 'Answer', value: oneLine(it.text, 300), stage: 'done' }] : [];
      case 'error':
        return [{ kind: 'error', severity: 'cause', stage: 'done', message: it.message ?? 'Codex reported an error.' }];
      default:
        return [];
    }
  }

  finish(): Signal[] {
    return this.checks.finish();
  }
}

export function codexPresenter(cwd = process.cwd()): (line: string) => string | null {
  return (raw) => {
    const e = parse(raw.trim());
    if (!e) return raw.trim() && !/rmcp::/.test(raw) ? raw : null;
    const it = e.item ?? {};
    if (e.type === 'thread.started') return '● Codex session started';
    if (e.type === 'item.started' && it.type === 'command_execution') return `  $ ${oneLine(unwrapShell(it.command ?? ''), 140)}`;
    if (e.type === 'item.completed') {
      if (it.type === 'command_execution') return it.exit_code === 0 ? null : `    ✗ exit ${it.exit_code ?? '?'}${it.aggregated_output?.trim() ? `: ${oneLine(it.aggregated_output.trim().split('\n').at(-1)!, 120)}` : ''}`;
      if (it.type === 'file_change') return `  ✎ ${describeChanges(it.changes ?? [], cwd)}${it.status === 'failed' ? ' (failed)' : ''}`;
      if (it.type === 'agent_message' && it.text) return `› ${oneLine(it.text, 300)}`;
      if (it.type === 'mcp_tool_call') return `  → Tool ${it.server ?? ''}.${it.tool ?? ''}`;
      if (it.type === 'web_search') return `  → Web search: ${oneLine(it.query ?? '', 60)}`;
      if (it.type === 'error') return `  ✗ ${it.message ?? 'error'}`;
      return null;
    }
    if (e.type === 'turn.completed') {
      const u = e.usage ?? {};
      return `■ Done${u.input_tokens !== undefined ? ` · ${k(u.input_tokens)} tokens in, ${k(u.output_tokens ?? 0)} out` : ''}`;
    }
    if (e.type === 'turn.failed' || e.type === 'error') return `■ Failed: ${e.error?.message ?? e.message ?? ''}`;
    return null;
  };
}

export const codex: Provider = {
  id: 'codex',
  title: 'Codex task',
  stages: agentStages('Codex', 'https://developers.openai.com/codex/cli', 'Codex runs in a sandbox; use `--sandbox workspace-write` to let it edit files.'),
  notes: { ...AGENT_NOTES, docsLabel: 'Codex docs' },
  install: 'Install the Codex CLI (`npm i -g @openai/codex`), then run `codex login`.',
  maxLineLength: 2_000_000,

  launch(userArgs) {
    const args = userArgs[0] === 'exec' ? userArgs.slice(1) : [...userArgs];
    if (!args.some((a) => !a.startsWith('-'))) {
      throw new UsageError('give Codex a task, for example: unfold codex "fix the failing test" --sandbox workspace-write');
    }
    return { bin: process.env.UNFOLD_CODEX_BIN || 'codex', args: ['exec', ...(args.includes('--json') ? [] : ['--json']), ...args] };
  },

  createParser: (ctx) => new CodexParser(ctx.cwd),
  createPresenter: (ctx) => codexPresenter(ctx.cwd),
  fixHints: (state) => agentFixHints(state, 'Give it more room with `--sandbox workspace-write`.'),
};
