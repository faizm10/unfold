import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDemo } from '../src/commands/demo.js';
import { Redactor } from '../src/core/redact.js';
import { Session } from '../src/core/session.js';
import { pruneRuns } from '../src/core/store.js';
import { vercel } from '../src/providers/vercel/index.js';
import { stripAnsi, style, truncate, width, wrapText } from '../src/tui/ansi.js';
import { screen, type ExplorerModel } from '../src/tui/explore.js';
import { LivePanel } from '../src/tui/panel.js';
import { summary } from '../src/tui/render.js';

const plain = style(false);

function run(name: string) {
  const t = loadDemo(name);
  const s = new Session({ provider: vercel, command: t.command, cwd: '/w', mode: 'demo', redactor: new Redactor(), saveFixPrompt: (id) => `/home/me/.unfold/runs/${id}.fix-prompt.md` });
  s.start();
  t.chunks.forEach((c) => s.write(c.d));
  s.end(t.exitCode, t.signal, t.interrupted);
  return s;
}

describe('ansi helpers', () => {
  it('measures and truncates styled text by visible width', () => {
    const s = style(true);
    expect(width(s.red('hello'))).toBe(5);
    expect(width('📝 ok')).toBe(5);
    expect(stripAnsi(truncate(s.bold('abcdefghij'), 6))).toBe('abcde…');
  });

  it('wraps on word boundaries', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });
});

describe('end-of-run summary', () => {
  it('shows each stage, the cause and complete fix commands on failure', () => {
    const s = run('build-failure');
    const out = summary(s.state, s.logs, { cols: 80, s: plain });
    expect(out).toContain('Failed in');
    expect(out).toMatch(/✗ Build\s+Command "npm run build" exited with 1/);
    expect(out).toMatch(/Cause\s+Type error: Property 'totalCents'/);
    expect(out).toContain('File    ./app/checkout/page.tsx:42:21');
    // Commands are never truncated, even when wider than the terminal.
    expect(out).toContain(`claude "$(cat '/home/me/.unfold/runs/${s.runId}.fix-prompt.md')"`);
    expect(out).not.toContain('\x1b[');
  });

  it('shows the URL on success and no fix section', () => {
    const s = run('success');
    const out = summary(s.state, s.logs, { cols: 100, s: plain });
    expect(out).toContain('URL     https://acme-web-7k2m9xq4p-acme.vercel.app');
    expect(out).not.toContain('Fix it with an agent');
  });

  it('says so when none of the output was recognized', () => {
    const s = new Session({ provider: vercel, command: ['vercel'], cwd: '/w', mode: 'live' });
    s.start();
    s.write('something\r\nentirely\r\ndifferent\r\nfrom a future CLI\r\n');
    s.end(0, null, false);
    expect(summary(s.state, s.logs, { s: plain })).toContain("Unfold didn't recognize any of this output");
  });
});

describe('live panel', () => {
  it('keeps the status and timer visible when the title is long', () => {
    const p = new LivePanel({ title: 'vercel deploy --logs --yes --scope some-very-long-team-name-here' });
    p.update(run('success').state);
    const [rule, flow] = p.lines(60).map(stripAnsi);
    expect(width(rule!)).toBeLessThanOrEqual(59);
    expect(rule).toMatch(/Deployed \d/);
    expect(flow).toBe(' ✓ Prepare ── ✓ Upload ── ✓ Build ── ✓ Preview');
  });
});

describe('explorer', () => {
  const s = run('build-failure');
  const model = (over: Partial<ExplorerModel> = {}): ExplorerModel => ({ state: s.state, logs: s.logs, stage: 2, view: 'stage', scroll: 0, ...over });

  it('fills exactly the screen with observed and general sections', () => {
    const lines = screen(model(), 120, 30, plain);
    expect(lines).toHaveLength(30);
    const text = lines.join('\n');
    expect(text).toContain('OBSERVED IN THIS RUN');
    expect(text).toContain('HOW THIS STAGE WORKS · general, not from this run');
    expect(text).toMatch(/Error\s+Command "npm run build" exited with 1 \(line 40\)/);
  });

  it('stacks sections on narrow terminals', () => {
    const text = screen(model(), 80, 200, plain).join('\n');
    expect(text.indexOf('OBSERVED IN THIS RUN')).toBeLessThan(text.indexOf('HOW THIS STAGE WORKS'));
  });

  it('shows logs and the fix prompt', () => {
    expect(screen(model({ view: 'logs', scroll: 1e9 }), 100, 20, plain).join('\n')).toContain('Error: Command "npm run build" exited with 1');
    expect(screen(model({ view: 'prompt' }), 100, 20, plain).join('\n')).toContain('# Fix a failed vercel preview deploy');
  });
});

describe('run retention', () => {
  const prev = process.env.UNFOLD_HOME;
  afterEach(() => {
    process.env.UNFOLD_HOME = prev;
  });

  it('keeps only the newest runs and removes their fix prompts too', () => {
    const home = mkdtempSync(join(tmpdir(), 'unfold-'));
    process.env.UNFOLD_HOME = home;
    const dir = join(home, 'runs');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `r${i}.jsonl`), '{}', { flag: 'w' });
      writeFileSync(join(dir, `r${i}.fix-prompt.md`), 'x');
      utimesSync(join(dir, `r${i}.jsonl`), 1000 + i, 1000 + i);
    }
    pruneRuns(2);
    expect(readdirSync(dir).sort()).toEqual(['r3.fix-prompt.md', 'r3.jsonl', 'r4.fix-prompt.md', 'r4.jsonl']);
  });
});
