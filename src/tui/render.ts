// Pure renderers shared by the live panel, the end-of-run summary and the explorer.
import { rankCauses } from '../core/fix-prompt.js';
import type { FlowState, LogLine, StageState } from '../core/model.js';
import { style as makeStyle, truncate, wrapText, type Style } from './ansi.js';

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const STATUS_WORD: Record<StageState['status'], string> = {
  pending: 'waiting',
  active: 'in progress',
  confirmed: 'confirmed',
  failed: 'failed',
  unverified: 'unverified',
};

export function glyph(st: StageState, s: Style, frame = 0): string {
  switch (st.status) {
    case 'confirmed':
      return s.green('✓');
    case 'failed':
      return s.red('✗');
    case 'active':
      return s.cyan(SPINNER[frame % SPINNER.length]!);
    case 'unverified':
      return s.yellow('?');
    default:
      return s.dim('○');
  }
}

const OUTCOME: Record<FlowState['outcome'], string> = { running: 'Running', success: 'Deployed', failure: 'Failed', interrupted: 'Stopped' };

export function outcomeLabel(state: FlowState, s: Style): string {
  if (state.outcome === 'success' && state.stages.at(-1)?.status !== 'confirmed') return s.yellow('Exited 0, not confirmed');
  const word = OUTCOME[state.outcome];
  return state.outcome === 'success' ? s.green(word) : state.outcome === 'failure' ? s.red(word) : state.outcome === 'interrupted' ? s.yellow(word) : s.cyan(word);
}

export function elapsed(state: FlowState, now = Date.now()): string {
  const sec = Math.max(0, ((state.endedAt ?? now) - state.startedAt) / 1000);
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

/** The stage most worth showing right now. */
export function focusStage(state: FlowState): StageState {
  const st = state.stages;
  if (state.failedStage) return st.find((x) => x.id === state.failedStage)!;
  const active = [...st].reverse().find((x) => x.status === 'active');
  if (active) return active;
  if (state.outcome === 'success') return st.at(-1)!;
  const i = st.findIndex((x) => x.id === state.lastConfirmed);
  if (state.outcome === 'interrupted') return st[i + 1] ?? st[0]!;
  return st[i] ?? st[0]!;
}

/** `✓ Prepare ── ✓ Upload ── ⠙ Build ── ○ Preview`, with an optional selected stage. */
export function flowLine(state: FlowState, s: Style, opts: { frame?: number; selected?: string } = {}): string {
  return state.stages
    .map((st, i) => {
      const prev = state.stages[i - 1];
      const link = i === 0 ? '' : prev?.status === 'confirmed' ? s.green(' ── ') : s.dim(' ── ');
      const title = st.id === opts.selected ? s.inverse(` ${st.title} `) : st.status === 'pending' ? s.dim(st.title) : st.status === 'failed' ? s.red(s.bold(st.title)) : s.bold(st.title);
      return `${link}${glyph(st, s, opts.frame)} ${title}`;
    })
    .join('');
}

const stripStamp = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z {0,2}/, '');

/** End-of-run summary printed in the terminal. */
export function summary(state: FlowState, logs: LogLine[], opts: { cols?: number; s?: Style; webUrl?: string } = {}): string {
  const s = opts.s ?? makeStyle();
  const cols = Math.max(40, Math.min(opts.cols ?? 100, 110));
  const out: string[] = [];
  const line = (t = '') => out.push(truncate(t, cols));
  // Labelled text that must stay complete: wrapped under its label, never cut.
  const block = (label: string, text: string, suffix = '') => {
    const indent = 10;
    wrapText(text + suffix, Math.max(20, cols - indent)).forEach((l, i) => out.push((i === 0 ? `  ${label}` : '').padEnd(i === 0 ? 0 : indent) + (i === 0 ? ' '.repeat(Math.max(1, indent - 2 - label.replace(/\x1b\[[0-9;]*m/g, '').length)) : '') + l));
  };
  const titleW = Math.max(...state.stages.map((x) => x.title.length)) + 2;

  line(`${s.bold('unfold')} ${s.dim('·')} ${state.command.join(' ')} ${s.dim('·')} ${outcomeLabel(state, s)} ${s.dim(`in ${elapsed(state)}`)}`);
  line();
  for (const st of state.stages) {
    const note = st.note ?? st.summary;
    const indent = 4 + titleW;
    wrapText(note, Math.max(20, cols - indent)).forEach((l, i) => {
      const text = st.status === 'unverified' || st.status === 'pending' ? s.dim(l) : l;
      out.push(i === 0 ? `  ${glyph(st, s)} ${(st.status === 'failed' ? s.red : s.bold)(st.title.padEnd(titleW))}${text}` : ' '.repeat(indent) + text);
    });
  }

  if (state.outcome === 'failure') {
    const fatal = state.errors.find((e) => e.severity === 'fatal');
    const cause = rankCauses(state)[0];
    line();
    if (fatal) block(s.red('Error'), fatal.message, ` (line ${fatal.seq})`);
    if (cause) block(s.yellow('Cause'), cause.message, ` (line ${cause.seq})`);
    const ref = logs
      .map((l) => stripStamp(l.text))
      .find((t) => /^\.{0,2}\/?[\w@.-]+(\/[\w@.[\]-]+)*\.[A-Za-z]{1,5}:\d+/.test(t.trim()));
    if (ref) line(`  ${s.dim('File')}    ${ref.trim()}`);
  }
  if (state.outcome === 'interrupted') {
    line();
    line(
      `  ${s.yellow('Stopped')} ${state.facts.some((f) => f.key === 'inspectUrl') ? 'The deployment had already been created, so Vercel may still finish it.' : 'No deployment had been created yet.'}`,
    );
  }

  const url = state.facts.find((f) => f.key === 'alias') ?? state.facts.find((f) => f.key === 'deploymentUrl');
  const inspect = state.facts.find((f) => f.key === 'inspectUrl');
  if (url || inspect) line();
  if (url && state.outcome === 'success') line(`  ${s.dim('URL'.padEnd(8))}${s.cyan(url.value)}`);
  if (inspect) line(`  ${s.dim('Inspect'.padEnd(8))}${inspect.value}`);

  if (state.fix?.commands) {
    line();
    line(`  ${s.bold('Fix it with an agent')} ${s.dim('(prompt built from this run)')}`);
    // Printed in full so they can be copied as-is.
    out.push(`  ${s.dim('Claude'.padEnd(8))}${state.fix.commands.claude}`);
    out.push(`  ${s.dim('Codex'.padEnd(8))}${state.fix.commands.codex}`);
  }

  const unverified = state.stages.filter((x) => x.status === 'unverified').length;
  line();
  line(
    s.dim(
      `  ${unverified ? `? = the output never confirmed it. ` : ''}Explore: unfold show${opts.webUrl ? ` · Browser: ${opts.webUrl}` : ' · in a browser: unfold show --web'}`,
    ),
  );
  return out.join('\n') + '\n';
}
