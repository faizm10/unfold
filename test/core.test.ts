import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.js';
import { Redactor, redactArgs } from '../src/core/redact.js';
import { TerminalDecoder, type DecodedLine } from '../src/core/terminal.js';
import { vercel } from '../src/providers/vercel/index.js';

function decode(...chunks: string[]): DecodedLine[] {
  const out: DecodedLine[] = [];
  const d = new TerminalDecoder((l) => out.push(l));
  chunks.forEach((c) => d.write(c));
  d.end();
  return out;
}

describe('TerminalDecoder', () => {
  it('handles CRLF split across chunks', () => {
    expect(decode('hello\r', '\nworld\r\n')).toEqual([
      { text: 'hello', transient: false },
      { text: 'world', transient: false },
    ]);
  });

  it('strips colors and OSC 8 hyperlinks but keeps the visible text', () => {
    const link = '\x1b]8;;https://vercel.com\x07vercel.com\x1b]8;;\x07';
    expect(decode(`\x1b[1m\x1b[36mInspect\x1b[39m\x1b[22m ${link}\r\n`)).toEqual([{ text: 'Inspect vercel.com', transient: false }]);
  });

  it('reports spinner redraws as transient lines without the spinner glyph', () => {
    const out = decode('\x1b[2K\x1b[1G⠋ Queued…', '\x1b[2K\x1b[1G⠙ Queued…', '\x1b[2K\x1b[1G');
    expect(out).toEqual([
      { text: 'Queued…', transient: true },
      { text: 'Queued…', transient: true },
    ]);
  });
});

describe('Redactor', () => {
  const r = new Redactor();
  it.each([
    ['Authorization: Bearer abcdefghijklmnop1234', 'Authorization: Bearer [REDACTED]'],
    ['VERCEL_TOKEN=Zx9vQ2mK8pL3nR5tY7wB1cD4', 'VERCEL_TOKEN=[REDACTED]'],
    ['api_key: "abc123def456"', 'api_key: "[REDACTED]"'],
    ['push https://bot:ghp_aaaaaaaaaaaaaaaaaaaaaaaa@github.com/x', 'push https://bot:[REDACTED]@github.com/x'],
    ['key AKIAIOSFODNN7EXAMPLE used', 'key [REDACTED] used'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'jwt [REDACTED]'],
    ['vercel deploy --token abcdef0123456789', 'vercel deploy --token [REDACTED]'],
  ])('%s', (input, expected) => {
    expect(r.line(input)).toBe(expected);
  });

  it('leaves ordinary output alone', () => {
    for (const line of ['Build Completed in /vercel/output [24s]', 'Error: Command "npm run build" exited with 1', '  Preview         https://acme-web-7k2m9xq4p-acme.vercel.app']) {
      expect(r.line(line)).toBe(line);
    }
  });

  it('redacts private key blocks', () => {
    const k = new Redactor();
    expect(['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA', '-----END RSA PRIVATE KEY-----', 'after'].map((l) => k.line(l))).toEqual([
      '-----BEGIN PRIVATE KEY----- [REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      'after',
    ]);
  });

  it('redacts token and env flag values in commands', () => {
    expect(redactArgs(['deploy', '--token', 'abc', '--env', 'API_KEY=secret', '--build-env=X=1', '--prod'])).toEqual(['deploy', '--token', '[REDACTED]', '--env', 'API_KEY=[REDACTED]', '--build-env=X=[REDACTED]', '--prod']);
  });
});

describe('vercel provider launch', () => {
  it('runs `vercel deploy --logs` by default and passes user flags through', () => {
    expect(vercel.launch([]).args).toEqual(['deploy', '--logs']);
    expect(vercel.launch(['--prod', '--yes']).args).toEqual(['deploy', '--prod', '--yes', '--logs']);
    expect(vercel.launch(['deploy', '--logs']).args).toEqual(['deploy', '--logs']);
  });

  it('keeps Unfold flags out of the wrapped command', () => {
    expect(parseArgs(['--prod', '--web', '--no-open', '--port', '5000', '--once', '--no-panel'])).toEqual({
      rest: ['--prod'],
      flags: { web: true, open: false, once: true, port: 5000, panel: false },
      speed: 1,
    });
  });

  it('uses the terminal by default and only serves a page with --web', () => {
    expect(parseArgs([]).flags).toEqual({ web: false, open: true, once: false, panel: true });
  });
});
