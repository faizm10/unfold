// Full-screen terminal explorer for a finished run (`unfold show`).
import { spawn } from 'node:child_process';
import { rankCauses } from '../core/fix-prompt.js';
import type { FlowState, LogLine, StageState } from '../core/model.js';
import { padEnd, style, truncate, wrapText, type Style } from './ansi.js';
import { elapsed, flowLine, focusStage, glyph, outcomeLabel, STATUS_WORD } from './render.js';
import { onRestore } from './restore.js';

export type View = 'stage' | 'logs' | 'prompt';

export interface ExplorerModel {
  state: FlowState;
  logs: LogLine[];
  stage: number;
  view: View;
  scroll: number;
  /** Log line to highlight in the logs view. */
  mark?: number;
  message?: string;
}

const stripStamp = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z {0,2}/, '');

function rel(state: FlowState, at: number): string {
  const sec = Math.max(0, (at - state.startedAt) / 1000);
  return sec < 60 ? `+${sec.toFixed(1)}s` : `+${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

function observed(m: ExplorerModel, st: StageState, w: number, s: Style): string[] {
  const out: string[] = [s.bold('OBSERVED IN THIS RUN'), ''];
  out.push(`${glyph(st, s)} ${s.bold(st.title)} ${s.dim('·')} ${STATUS_WORD[st.status]}`);
  const note = st.status === 'pending' ? 'Nothing about this stage has appeared in the output yet.' : (st.note ?? '');
  for (const l of wrapText(note, w)) out.push(st.status === 'failed' ? s.red(l) : st.status === 'unverified' ? s.yellow(l) : l);

  if (st.status === 'failed') {
    const fatal = m.state.errors.find((e) => e.severity === 'fatal' && e.stage === st.id);
    const causes = rankCauses(m.state).filter((c) => c.stage === st.id).slice(0, 4);
    out.push('');
    const labelled = (label: string, text: string) => wrapText(text, w - 7).map((l, i) => (i ? '       ' : label.padEnd(7)) + l);
    if (fatal) out.push(...labelled('Error', `${fatal.message} (line ${fatal.seq})`).map((l, i) => (i ? l : s.red(l))));
    for (const c of causes) out.push(...labelled('Cause', `${c.message} (line ${c.seq})`).map((l, i) => (i ? l : s.yellow(l))));
  }

  const facts = m.state.facts.filter((f) => f.stage === st.id);
  if (facts.length) {
    out.push('');
    const kw = Math.max(...facts.map((f) => f.label.length)) + 2;
    for (const f of facts) out.push(truncate(`${s.dim(f.label.padEnd(kw))}${f.href ? s.cyan(f.value) : f.value}`, w));
  }

  out.push('', s.dim('Evidence from the output'));
  if (!st.evidence.length) out.push(s.dim('No output from this run relates to this stage.'));
  for (const e of st.evidence) {
    const text = stripStamp(m.logs.find((l) => l.seq === e.seq)?.text ?? e.text);
    out.push(`${s.dim(rel(m.state, e.at).padEnd(7))}${truncate(e.note, w - 7)}`);
    out.push(`       ${truncate(s.dim(`${text}`), w - 16)} ${s.dim(`line ${e.seq}`)}`);
  }
  return out;
}

function explanation(st: StageState, w: number, s: Style): string[] {
  const out = [s.dim(s.bold('HOW THIS STAGE WORKS')) + s.dim(' · general, not from this run'), ''];
  out.push(...wrapText(st.summary, w).map(s.bold), '');
  for (const p of st.explanation) out.push(...wrapText(p, w).map(s.dim), '');
  out.push(...wrapText(`What would confirm it: ${st.confirmedBy}`, w));
  if (st.docsUrl) out.push('', s.cyan(truncate(st.docsUrl, w)));
  return out;
}

function stageBody(m: ExplorerModel, cols: number, s: Style): string[] {
  const st = m.state.stages[m.stage]!;
  if (cols >= 120) {
    const lw = Math.floor((cols - 5) * 0.58);
    const rw = cols - 5 - lw;
    const left = observed(m, st, lw, s);
    const right = explanation(st, rw, s);
    return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => `  ${padEnd(truncate(left[i] ?? '', lw), lw)}   ${truncate(right[i] ?? '', rw)}`);
  }
  const w = cols - 4;
  return [...observed(m, st, w, s), '', ...explanation(st, w, s)].map((l) => `  ${truncate(l, w)}`);
}

function logsBody(m: ExplorerModel, cols: number, s: Style): string[] {
  const errs = new Set(m.state.errors.map((e) => e.seq));
  const ev = new Set(m.state.stages.flatMap((st) => st.evidence.map((e) => e.seq)));
  const nw = String(m.logs.at(-1)?.seq ?? 0).length;
  return m.logs.map((l) => {
    const marker = errs.has(l.seq) ? s.red('▌') : ev.has(l.seq) ? s.green('▌') : ' ';
    const body = truncate(l.text, cols - nw - 5);
    const stamp = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(body)?.[0] ?? '';
    const rest = body.slice(stamp.length);
    const text = s.dim(stamp) + (errs.has(l.seq) ? s.red(rest) : rest);
    const row = `${marker} ${s.dim(String(l.seq).padStart(nw))}  ${text}`;
    return l.seq === m.mark ? s.inverse(padEnd(row, cols - 1)) : row;
  });
}

function promptBody(m: ExplorerModel, cols: number): string[] {
  if (!m.state.fix) return ['  No fix prompt: fix prompts are created when a run fails.'];
  return m.state.fix.prompt.split('\n').flatMap((l) => (l ? wrapText(l, cols - 4) : [''])).map((l) => `  ${l}`);
}

export function body(m: ExplorerModel, cols: number, s: Style): string[] {
  return m.view === 'logs' ? logsBody(m, cols, s) : m.view === 'prompt' ? promptBody(m, cols) : stageBody(m, cols, s);
}

/** Renders one full screen as exactly `rows` lines. */
export function screen(m: ExplorerModel, cols: number, rows: number, s: Style = style(true)): string[] {
  const st = m.state;
  const head = [
    truncate(` ${s.bold('unfold')} ${s.dim('·')} ${st.command.join(' ')} ${s.dim('·')} ${outcomeLabel(st, s)} ${s.dim(`in ${elapsed(st)}`)}${st.mode !== 'live' ? s.dim(` · ${st.mode}`) : ''}`, cols - 1),
    truncate(` ${flowLine(st, s, { selected: m.view === 'stage' ? st.stages[m.stage]!.id : undefined })}`, cols - 1),
    s.dim('─'.repeat(cols - 1)),
  ];
  const keys =
    m.view === 'stage'
      ? '←/→ stage  ↑/↓ scroll  l logs  e error  f fix prompt  c/x copy claude/codex command  q quit'
      : m.view === 'logs'
        ? '↑/↓ PgUp/PgDn scroll  e error  l back  q quit'
        : '↑/↓ scroll  c/x copy claude/codex command  f back  q quit';
  const foot = [s.dim('─'.repeat(cols - 1)), truncate(m.message ? ` ${s.green(m.message)}` : s.dim(` ${keys}`), cols - 1)];
  const avail = Math.max(1, rows - head.length - foot.length);
  const lines = body(m, cols, s);
  const maxScroll = Math.max(0, lines.length - avail);
  m.scroll = Math.min(Math.max(0, m.scroll), maxScroll);
  const visible = lines.slice(m.scroll, m.scroll + avail);
  while (visible.length < avail) visible.push('');
  return [...head, ...visible, ...foot];
}

function copy(text: string): boolean {
  const [cmd, args] = process.platform === 'darwin' ? ['pbcopy', []] : process.platform === 'win32' ? ['clip', []] : ['xclip', ['-selection', 'clipboard']];
  try {
    const p = spawn(cmd, args as string[], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('error', () => {});
    p.stdin.end(text);
    return true;
  } catch {
    return false;
  }
}

/** Interactive loop. Resolves when the user quits. */
export function explore(state: FlowState, logs: LogLine[]): Promise<void> {
  const out = process.stdout;
  const stdin = process.stdin;
  const s = style(true);
  const m: ExplorerModel = { state, logs: [...logs].sort((a, b) => a.seq - b.seq), stage: state.stages.indexOf(focusStage(state)), view: 'stage', scroll: 0 };
  let msgTimer: NodeJS.Timeout | undefined;

  const draw = () => {
    const rows = out.rows || 24;
    const cols = out.columns || 80;
    out.write('\x1b[H' + screen(m, cols, rows, s).map((l) => l + '\x1b[K').join('\r\n') + '\x1b[J');
  };
  const flash = (msg: string) => {
    m.message = msg;
    draw();
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => ((m.message = undefined), draw()), 1800);
  };
  const jumpToError = () => {
    const target = rankCauses(state)[0] ?? state.errors.find((e) => e.severity === 'fatal');
    if (!target) return flash('No errors in this run.');
    m.view = 'logs';
    m.mark = target.seq;
    const page = Math.max(1, (out.rows || 24) - 5);
    m.scroll = Math.max(0, m.logs.findIndex((l) => l.seq === target.seq) - Math.floor(page / 3));
    draw();
  };
  const copyCmd = (agent: 'claude' | 'codex') => {
    const cmd = state.fix?.commands?.[agent];
    if (!cmd) return flash(state.fix ? 'The prompt was not saved, so there is no command to copy.' : 'Nothing to fix: fix prompts are created when a run fails.');
    flash(copy(cmd) ? `Copied the ${agent === 'claude' ? 'Claude Code' : 'Codex'} command. Paste it in your project folder.` : cmd);
  };

  return new Promise((resolve) => {
    const page = () => Math.max(1, (out.rows || 24) - 6);
    const onKey = (buf: Buffer) => {
      const k = buf.toString();
      if (k === 'q' || k === '\x1b' || k === '\x03') return finish();
      if (k === '\x1b[C' || k === '\t' || k === 'L') ((m.stage = (m.stage + 1) % state.stages.length), (m.view = 'stage'), (m.scroll = 0));
      else if (k === '\x1b[D' || k === '\x1b[Z' || k === 'H') ((m.stage = (m.stage - 1 + state.stages.length) % state.stages.length), (m.view = 'stage'), (m.scroll = 0));
      else if (k === '\x1b[B' || k === 'j') m.scroll++;
      else if (k === '\x1b[A' || k === 'k') m.scroll--;
      else if (k === '\x1b[6~' || k === ' ') m.scroll += page();
      else if (k === '\x1b[5~' || k === 'b') m.scroll -= page();
      else if (k === 'g') m.scroll = 0;
      else if (k === 'G') m.scroll = 1e9;
      else if (k === 'l') ((m.view = m.view === 'logs' ? 'stage' : 'logs'), (m.scroll = m.view === 'logs' ? 1e9 : 0));
      else if (k === 'f') ((m.view = m.view === 'prompt' ? 'stage' : 'prompt'), (m.scroll = 0));
      else if (k === 'e') return jumpToError();
      else if (k === 'c') return copyCmd('claude');
      else if (k === 'x') return copyCmd('codex');
      else if (/^[1-9]$/.test(k) && Number(k) <= state.stages.length) ((m.stage = Number(k) - 1), (m.view = 'stage'), (m.scroll = 0));
      draw();
    };
    const release = onRestore(() => {
      if (stdin.isTTY) stdin.setRawMode(false);
      out.write('\x1b[?25h\x1b[?1049l');
    });
    const finish = () => {
      release();
      stdin.off('data', onKey);
      out.off('resize', draw);
      if (msgTimer) clearTimeout(msgTimer);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      out.write('\x1b[?25h\x1b[?1049l');
      resolve();
    };
    out.write('\x1b[?1049h\x1b[?25l');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    out.on('resize', draw);
    draw();
  });
}
