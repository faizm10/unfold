// Minimal ANSI styling and text layout for the terminal views.

const useColor = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR === '1' || !!process.stdout.isTTY);

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  inverse(s: string): string;
}

const wrap = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
const plain = (s: string) => s;

export function style(color = useColor()): Style {
  return color
    ? { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39), inverse: wrap(7, 27) }
    : { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain, inverse: plain };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export const stripAnsi = (s: string) => s.replace(ANSI, '');

/** Visible width in terminal columns (good enough for the text Unfold prints). */
export function width(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200b) continue;
    // Emoji and CJK take two columns.
    w += cp >= 0x1f300 || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60) ? 2 : 1;
  }
  return w;
}

/** Cuts a (possibly styled) string to `max` visible columns, adding an ellipsis. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (width(s) <= max) return s;
  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length) {
    ANSI.lastIndex = i;
    const m = s.startsWith('\x1b', i) ? ANSI.exec(s) : null;
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    const cw = width(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out + '…' + (/\x1b\[/.test(out) ? '\x1b[0m' : '');
}

export const padEnd = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));

/** Word-wraps plain text to `max` columns. */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && width(line) + 1 + width(word) > max) {
        lines.push(line);
        line = '';
      }
      line = line ? `${line} ${word}` : word;
      while (width(line) > max) {
        lines.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    lines.push(line);
  }
  return lines;
}
