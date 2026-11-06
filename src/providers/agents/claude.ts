import { UsageError } from '../../core/errors.js';
import type { LogLine, Signal } from '../../core/model.js';
import type { Provider, ProviderParser } from '../provider.js';
import { agentFixHints, AGENT_NOTES, agentStages, CheckTracker, classifyCommand, oneLine, relPath, type Activity } from './shared.js';

// Event format from Claude Code 2.1 `claude -p --output-format stream-json --verbose`:
// system/init, assistant messages with tool_use blocks, user messages with tool_result
// blocks, and a final result event.

interface Block {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
}

interface Event {
  type: string;
  subtype?: string;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  claude_code_version?: string;
  message?: { content?: Block[] };
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  api_error_status?: unknown;
  permission_denials?: { tool_name?: string }[];
}

const parse = (text: string): Event | undefined => {
  if (!text.startsWith('{')) return undefined;
  try {
    return JSON.parse(text) as Event;
  } catch {
    return undefined;
  }
};

const EXPLORE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead', 'Task', 'Agent', 'ToolSearch']);
const CHANGE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

function activity(name: string, input: Record<string, unknown>): Activity | undefined {
  if (name === 'Bash') return classifyCommand(String(input.command ?? ''));
  if (CHANGE_TOOLS.has(name)) return 'change';
  if (EXPLORE_TOOLS.has(name) || name.startsWith('mcp__')) return 'explore';
  return undefined; // TodoWrite and other bookkeeping
}

function describe(name: string, input: Record<string, unknown>, cwd?: string): string {
  const path = typeof input.file_path === 'string' ? relPath(input.file_path, cwd) : typeof input.notebook_path === 'string' ? relPath(input.notebook_path, cwd) : '';
  switch (name) {
    case 'Bash':
      return `$ ${oneLine(String(input.command ?? ''), 140)}`;
    case 'Read':
      return `Read ${path}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${path}`;
    case 'Write':
      return `Write ${path}`;
    case 'NotebookEdit':
      return `Edit ${path}`;
    case 'Glob':
      return `Find files ${String(input.pattern ?? '')}`;
    case 'Grep':
      return `Search for ${oneLine(String(input.pattern ?? ''), 60)}`;
    case 'WebFetch':
      return `Fetch ${String(input.url ?? '')}`;
    case 'WebSearch':
      return `Web search: ${oneLine(String(input.query ?? ''), 60)}`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${oneLine(String(input.description ?? input.prompt ?? ''), 60)}`;
    default:
      return name.startsWith('mcp__') ? `Tool ${name.slice(5).replace('__', '.')}` : name;
  }
}

const resultText = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : '')).join(' ') : '';

export class ClaudeParser implements ProviderParser {
  private cwd: string | undefined;
  private readonly pending = new Map<string, { name: string; input: Record<string, unknown>; kind?: Activity }>();
  private readonly checks = new CheckTracker();

  feed(line: LogLine): Signal[] {
    const e = parse(line.text.trim());
    if (!e) {
      // Plain text: Claude Code's own errors (bad flags, not logged in) land here.
      const t = line.text.trim();
      return /error|invalid|not logged in|unauthorized/i.test(t) ? [{ kind: 'error', severity: 'cause', stage: 'start', message: t }] : [];
    }
    const out: Signal[] = [];

    if (e.type === 'system' && e.subtype === 'init') {
      this.cwd = e.cwd;
      if (e.claude_code_version) out.push({ kind: 'fact', key: 'cliVersion', label: 'Claude Code', value: e.claude_code_version, stage: 'start' });
      if (e.model) out.push({ kind: 'fact', key: 'model', label: 'Model', value: e.model, stage: 'start' });
      if (e.permissionMode) out.push({ kind: 'fact', key: 'permissionMode', label: 'Permission mode', value: e.permissionMode, stage: 'start' });
      out.push({ kind: 'stage', stage: 'start', status: 'confirmed', note: `Session started${e.model ? ` with ${e.model}` : ''}.` });
      return out;
    }

    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type !== 'tool_use' || !b.id || !b.name) continue;
        const input = b.input ?? {};
        const kind = activity(b.name, input);
        this.pending.set(b.id, { name: b.name, input, kind });
        if (kind) out.push({ kind: 'stage', stage: kind, status: 'active', note: describe(b.name, input, this.cwd) });
      }
      return out;
    }

    if (e.type === 'user') {
      for (const b of e.message?.content ?? []) {
        if (b.type !== 'tool_result' || !b.tool_use_id) continue;
        const call = this.pending.get(b.tool_use_id);
        if (!call?.kind) continue;
        this.pending.delete(b.tool_use_id);
        const what = describe(call.name, call.input, this.cwd);
        if (call.kind === 'verify') this.checks.record(String(call.input.command ?? call.name), !b.is_error);
        if (b.is_error) {
          const why = oneLine(resultText(b.content), 120);
          out.push({ kind: 'evidence', stage: call.kind, note: `Failed: ${what}${why ? ` (${why})` : ''}` });
          if (call.kind === 'verify') out.push({ kind: 'error', severity: 'cause', stage: 'verify', message: `${what}: ${why}`, priority: 1 });
        } else {
          if (call.kind === 'change' && typeof call.input.file_path === 'string') this.checks.changed.add(relPath(call.input.file_path, this.cwd));
          out.push({ kind: 'stage', stage: call.kind, status: 'confirmed', note: call.kind === 'verify' ? `Check passed: ${what.replace(/^\$ /, '')}` : what });
        }
      }
      return out;
    }

    if (e.type === 'result') {
      const secs = e.duration_ms !== undefined ? `${(e.duration_ms / 1000).toFixed(1)}s` : undefined;
      if (e.total_cost_usd !== undefined) out.push({ kind: 'fact', key: 'cost', label: 'Cost', value: `$${e.total_cost_usd.toFixed(2)}`, stage: 'done' });
      if (e.num_turns !== undefined) out.push({ kind: 'fact', key: 'turns', label: 'Turns', value: String(e.num_turns), stage: 'done' });
      if (secs) out.push({ kind: 'fact', key: 'duration', label: 'Duration', value: secs, stage: 'done' });
      const denied = [...new Set((e.permission_denials ?? []).map((d) => d.tool_name).filter(Boolean))];
      if (denied.length) out.push({ kind: 'fact', key: 'denied', label: 'Permission denied', value: denied.join(', '), stage: 'done' });
      if (e.subtype === 'success' && !e.is_error) {
        if (e.result) out.push({ kind: 'fact', key: 'answer', label: 'Answer', value: oneLine(e.result, 300), stage: 'done' });
        out.push({ kind: 'stage', stage: 'done', status: 'confirmed', note: `Finished${secs ? ` in ${secs}` : ''}${e.num_turns ? ` after ${e.num_turns} turns` : ''}.` });
      } else {
        const reason =
          e.subtype === 'error_max_turns' ? 'It hit the maximum number of turns.' : oneLine(e.result || String(e.api_error_status ?? '') || e.subtype || 'The session ended with an error.', 200);
        out.push({ kind: 'error', severity: 'fatal', stage: 'done', message: reason });
      }
      if (denied.length) out.push({ kind: 'error', severity: 'cause', stage: 'done', message: `Permission denied for: ${denied.join(', ')}`, priority: 2 });
    }
    return out;
  }

  finish(): Signal[] {
    return this.checks.finish();
  }
}

/** Turns stream-json events into readable terminal lines. */
export function claudePresenter(): (line: string) => string | null {
  let cwd: string | undefined;
  const calls = new Map<string, string>();
  return (raw) => {
    const e = parse(raw.trim());
    if (!e) return raw.trim() ? raw : null;
    if (e.type === 'system' && e.subtype === 'init') {
      cwd = e.cwd;
      return `● Claude Code ${e.claude_code_version ?? ''} · ${e.model ?? 'model'} · permission mode: ${e.permissionMode ?? 'default'}`;
    }
    if (e.type === 'assistant') {
      const lines: string[] = [];
      for (const b of e.message?.content ?? []) {
        if (b.type === 'tool_use' && b.name) {
          const d = describe(b.name, b.input ?? {}, cwd);
          if (b.id) calls.set(b.id, d);
          if (b.name !== 'TodoWrite') lines.push(`  ${d.startsWith('$') ? d : `→ ${d}`}`);
        } else if (b.type === 'text' && b.text?.trim()) {
          lines.push(`› ${oneLine(b.text, 300)}`);
        }
      }
      return lines.length ? lines.join('\n') : null;
    }
    if (e.type === 'user') {
      const failed = (e.message?.content ?? []).filter((b) => b.type === 'tool_result' && b.is_error);
      return failed.length ? failed.map((b) => `    ✗ ${oneLine(resultText(b.content), 140)}`).join('\n') : null;
    }
    if (e.type === 'result') {
      const ok = e.subtype === 'success' && !e.is_error;
      const bits = [e.duration_ms !== undefined ? `${(e.duration_ms / 1000).toFixed(1)}s` : '', e.num_turns ? `${e.num_turns} turns` : '', e.total_cost_usd !== undefined ? `$${e.total_cost_usd.toFixed(2)}` : ''].filter(Boolean);
      return `■ ${ok ? 'Done' : `Failed (${e.subtype})`}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
    }
    return null; // hooks, rate limits, partial messages
  };
}

export const claude: Provider = {
  id: 'claude',
  title: 'Claude Code task',
  stages: agentStages('Claude Code', 'https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless', 'Allow tools with `--allowedTools` (for example `--allowedTools Read Edit Bash`) or `--permission-mode acceptEdits`.'),
  notes: { ...AGENT_NOTES, docsLabel: 'Claude Code docs' },
  install: 'Install Claude Code (https://docs.claude.com/en/docs/claude-code), then run `claude` once to log in.',
  maxLineLength: 2_000_000,

  launch(userArgs) {
    const args = userArgs.filter((a) => a !== '-p' && a !== '--print');
    if (!args.some((a) => !a.startsWith('-'))) {
      throw new UsageError('give Claude Code a task, for example: unfold claude "fix the failing test" --allowedTools Read Edit Bash');
    }
    const out = ['-p', ...args];
    if (!args.some((a) => a.startsWith('--output-format'))) out.push('--output-format', 'stream-json');
    if (!args.includes('--verbose')) out.push('--verbose');
    return { bin: process.env.UNFOLD_CLAUDE_BIN || 'claude', args: out };
  },

  createParser: () => new ClaudeParser(),
  createPresenter: claudePresenter,
  fixHints: (state) => agentFixHints(state, 'Allow it with `--allowedTools <tool>` or `--permission-mode acceptEdits`, or run the task interactively.'),
};
