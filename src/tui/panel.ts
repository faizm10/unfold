// A small flow panel pinned to the bottom of the terminal while a command runs.
//
// The wrapped CLI keeps the rest of the screen: we restrict scrolling to the rows
// above the panel (DECSTBM) and tell the PTY it has that many rows, so its own
// output, spinners and prompts behave normally and never overwrite the panel.
import type { FlowState } from '../core/model.js';
import { style, truncate, width, type Style } from './ansi.js';
import { elapsed, flowLine, focusStage, outcomeLabel } from './render.js';
import { onRestore } from './restore.js';

const HEIGHT = 3;
const ESC = '\x1b';

export interface PanelOptions {
  out?: NodeJS.WriteStream;
  title: string;
  /** Called when the space available to the wrapped command changes. */
  onRowsChange?: (rows: number) => void;
}

/** Whether the terminal can host the panel. */
export function panelSupported(out: NodeJS.WriteStream = process.stdout): boolean {
  return !!out.isTTY && process.env.TERM !== 'dumb' && (out.rows ?? 0) >= 12 && (out.columns ?? 0) >= 50 && !process.env.UNFOLD_NO_PANEL;
}

export class LivePanel {
  private readonly out: NodeJS.WriteStream;
  private readonly s: Style;
  private state: FlowState | undefined;
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private active = false;
  /** True while the last child chunk ended inside an escape sequence. */
  private midEscape = false;
  private dirty = false;
  private releaseRestore: (() => void) | undefined;

  constructor(private readonly opts: PanelOptions) {
    this.out = opts.out ?? process.stdout;
    this.s = style(true);
  }

  /** Rows the wrapped command may use. */
  get childRows(): number {
    return Math.max(1, (this.out.rows || 24) - (this.active ? HEIGHT : 0));
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.releaseRestore = onRestore(() => this.out.write(`${ESC}[r${ESC}[0m\r\n`));
    // Make room: scroll existing content up so the panel doesn't cover it.
    this.out.write('\n'.repeat(HEIGHT) + `${ESC}[${HEIGHT}A`);
    this.setRegion();
    this.draw();
    this.timer = setInterval(() => {
      this.frame++;
      this.draw();
    }, 120);
    this.out.on('resize', this.onResize);
    this.opts.onRowsChange?.(this.childRows);
  }

  update(state: FlowState): void {
    this.state = state;
    this.dirty = true;
  }

  /** Call after forwarding child output so we never draw in the middle of an escape sequence. */
  afterChildOutput(chunk: string): void {
    const lastEsc = chunk.lastIndexOf(ESC);
    if (lastEsc === -1) {
      if (this.midEscape) this.midEscape = !/[@-~]/.test(chunk);
    } else {
      const tail = chunk.slice(lastEsc);
      this.midEscape = !/^\x1b(\[[0-9;?]*[@-~]|\][^\x07]*(\x07|\x1b\\)|[^[\]])/.test(tail);
    }
    if (this.dirty) this.draw();
  }

  /** Removes the panel and gives the whole screen back, leaving the cursor below the output. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.out.off('resize', this.onResize);
    const rows = this.out.rows || 24;
    let seq = `${ESC}7`;
    for (let r = rows - HEIGHT + 1; r <= rows; r++) seq += `${ESC}[${r};1H${ESC}[2K`;
    seq += `${ESC}[r${ESC}8\r\n`;
    this.out.write(seq);
    this.releaseRestore?.();
    this.opts.onRowsChange?.(this.childRows);
  }

  private readonly onResize = () => {
    this.setRegion();
    this.draw();
    this.opts.onRowsChange?.(this.childRows);
  };

  private setRegion(): void {
    // DECSTBM homes the cursor, so save and restore around it.
    this.out.write(`${ESC}7${ESC}[1;${this.childRows}r${ESC}8`);
  }

  private draw(): void {
    if (!this.active || this.midEscape) return;
    this.dirty = false;
    const rows = this.out.rows || 24;
    const cols = this.out.columns || 80;
    const lines = this.lines(cols);
    let seq = `${ESC}7${ESC}[0m`;
    lines.forEach((l, i) => (seq += `${ESC}[${rows - HEIGHT + 1 + i};1H${ESC}[2K${truncate(l, cols - 1)}`));
    this.out.write(seq + `${ESC}8`);
  }

  lines(cols: number): string[] {
    const s = this.s;
    const st = this.state;
    // The status and timer always fit; the command title gives way.
    const right = st ? ` ${outcomeLabel(st, s)} ${s.dim(elapsed(st))} ` : '';
    const room = cols - 1 - 2 - width(right) - 2;
    const label = truncate(` unfold · ${this.opts.title} `, Math.max(10, room));
    const fill = Math.max(2, cols - 1 - 2 - width(label) - width(right));
    const rule = s.dim('──') + s.bold(label) + s.dim('─'.repeat(fill)) + right;
    if (!st) return [rule, '', ''];
    const focus = focusStage(st);
    const last = focus.evidence.at(-1);
    const detail = `${s.bold(focus.title)}${s.dim(':')} ${focus.note ?? focus.summary}${last && last.note !== focus.note ? s.dim(`  ·  ${last.note}`) : ''}`;
    return [rule, ` ${flowLine(st, s, { frame: this.frame })}`, ` ${detail}`];
  }
}
