// Turns raw PTY output (ANSI colors, OSC hyperlinks, spinner redraws, CRLF)
// into plain text lines. Lines that are overwritten in place (spinners,
// progress bars) are reported as `transient` so the caller can collapse them.

export interface DecodedLine {
  text: string;
  transient: boolean;
}

const MAX_LINE = 4000;
// Braille / circle spinner frames at the start of a line.
const SPINNER_PREFIX = /^\s{0,3}(?:[⠀-⣿◐◓◑◒]\s*)+/u;

export function stripSpinner(text: string): string {
  return text.replace(SPINNER_PREFIX, '');
}

type EscState = 'none' | 'esc' | 'csi' | 'osc' | 'osc-esc';

export class TerminalDecoder {
  private buf = '';
  private esc: EscState = 'none';
  private csiParams = '';
  private pendingCR = false;

  constructor(private readonly emit: (line: DecodedLine) => void) {}

  write(chunk: string): void {
    for (const ch of chunk) this.char(ch);
  }

  end(): void {
    this.pendingCR = false;
    this.flush(false);
  }

  private char(ch: string): void {
    if (this.pendingCR) {
      this.pendingCR = false;
      if (ch === '\n') {
        this.flush(false);
        return;
      }
      // Bare carriage return: the line is about to be redrawn.
      this.flush(true);
    }

    switch (this.esc) {
      case 'esc':
        if (ch === '[') {
          this.esc = 'csi';
          this.csiParams = '';
        } else if (ch === ']') {
          this.esc = 'osc';
        } else {
          this.esc = 'none';
        }
        return;
      case 'csi':
        if (ch >= '@' && ch <= '~') {
          this.esc = 'none';
          this.csi(ch, this.csiParams);
        } else {
          this.csiParams += ch;
        }
        return;
      case 'osc':
        if (ch === '\x07') this.esc = 'none';
        else if (ch === '\x1b') this.esc = 'osc-esc';
        return;
      case 'osc-esc':
        this.esc = ch === '\\' ? 'none' : 'osc';
        return;
    }

    if (ch === '\x1b') {
      this.esc = 'esc';
    } else if (ch === '\r') {
      this.pendingCR = true;
    } else if (ch === '\n') {
      this.flush(false);
    } else if (ch === '\b') {
      this.buf = this.buf.slice(0, -1);
    } else if (ch === '\t') {
      this.buf += '  ';
    } else if (ch >= ' ' || ch > '\x7f') {
      if (this.buf.length < MAX_LINE) this.buf += ch;
    }
  }

  private csi(final: string, params: string): void {
    // Erase-whole-line, cursor-to-column, cursor-up and clear-screen all mean the
    // current text is being replaced rather than continued.
    if ((final === 'K' && (params === '2' || params === '1')) || final === 'G' || final === 'A' || final === 'J' || final === 'H') {
      this.flush(true);
    }
  }

  private flush(transient: boolean): void {
    const text = stripSpinner(this.buf.replace(/\s+$/, ''));
    this.buf = '';
    if (text.trim() === '') return;
    this.emit({ text, transient });
  }
}

/** Key used to decide whether a redrawn line replaces the previous one. */
export function redrawKey(text: string): string {
  return text.replace(/[\d.,=\-#>\s[\]()/KMGTB%]+/g, '').slice(0, 24);
}
