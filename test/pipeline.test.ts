import { describe, expect, it } from 'vitest';
import { loadDemo, type Transcript } from '../src/commands/demo.js';
import { Redactor } from '../src/core/redact.js';
import { Session } from '../src/core/session.js';
import { vercel } from '../src/providers/vercel/index.js';

/** Feeds a transcript through the real decoder → redactor → parser → reducer. */
function run(t: Pick<Transcript, 'chunks' | 'exitCode' | 'signal' | 'interrupted'>, env: Record<string, string> = {}) {
  let clock = 1_000_000;
  const session = new Session({ provider: vercel, command: ['vercel', 'deploy'], cwd: '/x', mode: 'demo', redactor: new Redactor({ env }), now: () => clock });
  session.start();
  for (const c of t.chunks) {
    clock = 1_000_000 + c.t;
    session.write(c.d);
  }
  session.end(t.exitCode, t.signal, t.interrupted);
  return session;
}

const status = (s: Session) => Object.fromEntries(s.state.stages.map((st) => [st.id, st.status]));
const fact = (s: Session, key: string) => s.state.facts.find((f) => f.key === key)?.value;

describe('success demo', () => {
  const s = run(loadDemo('success'));

  it('confirms every stage from the output', () => {
    expect(s.state.outcome).toBe('success');
    expect(status(s)).toEqual({ prepare: 'confirmed', upload: 'confirmed', build: 'confirmed', preview: 'confirmed' });
    expect(s.state.lastConfirmed).toBe('preview');
  });

  it('extracts the key facts', () => {
    expect(fact(s, 'project')).toBe('acme/acme-web');
    expect(fact(s, 'deploymentUrl')).toBe('https://acme-web-7k2m9xq4p-acme.vercel.app');
    expect(fact(s, 'inspectUrl')).toMatch(/^https:\/\/vercel.com\/acme\/acme-web\//);
    expect(fact(s, 'region')).toContain('iad1');
    expect(fact(s, 'protection')).toBe('On');
  });

  it('collapses spinner and progress redraws into single log lines', () => {
    const texts = s.logs.map((l) => l.text);
    expect(texts.filter((t) => t.startsWith('Uploading [')).length).toBe(1);
    expect(texts.find((t) => t.startsWith('Uploading ['))).toContain('(184.6KB/184.6KB)');
    expect(texts.filter((t) => t.startsWith('Queued')).length).toBe(1);
    expect(texts.every((t) => !t.includes('\x1b'))).toBe(true);
  });

  it('attaches evidence lines to each stage', () => {
    for (const st of s.state.stages) expect(st.evidence.length).toBeGreaterThan(0);
  });
});

describe('build-failure demo', () => {
  const s = run(loadDemo('build-failure'));

  it('fails in Build with Upload as the last confirmed stage', () => {
    expect(s.state.outcome).toBe('failure');
    expect(s.state.failedStage).toBe('build');
    expect(s.state.lastConfirmed).toBe('upload');
    expect(status(s)).toEqual({ prepare: 'confirmed', upload: 'confirmed', build: 'failed', preview: 'unverified' });
    expect(s.state.stages.find((st) => st.id === 'preview')!.note).toMatch(/Not reached/);
  });

  it('surfaces the fatal error and the likely cause, with line numbers', () => {
    const fatal = s.state.errors.find((e) => e.severity === 'fatal')!;
    expect(fatal.message).toBe('Command "npm run build" exited with 1');
    const cause = s.state.errors.find((e) => e.severity === 'cause' && e.message.startsWith('Type error'))!;
    expect(cause).toBeDefined();
    expect(s.logs.find((l) => l.seq === cause.seq)!.text).toContain("Property 'totalCents'");
    expect(fact(s, 'failedCommand')).toBe('npm run build (exit 1)');
  });

  it('ranks the specific type error above generic failure summaries', () => {
    const causes = s.state.errors.filter((e) => e.severity === 'cause').sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || a.seq - b.seq);
    expect(causes[0]!.message).toMatch(/^Type error: Property 'totalCents'/);
  });

  it('keeps evidence focused instead of citing every build line', () => {
    const build = s.state.stages.find((st) => st.id === 'build')!;
    expect(build.evidence.length).toBeLessThan(15);
  });

  it('redacts the credential echoed by the build', () => {
    const all = s.logs.map((l) => l.text).join('\n');
    expect(all).not.toContain('Demo-Pa55-not-real');
    expect(all).toContain('DATABASE_URL=[REDACTED]');
  });
});

describe('interrupted demo', () => {
  const s = run(loadDemo('interrupted'));

  it('reports Ctrl+C, keeps confirmed stages, and leaves the rest unverified', () => {
    expect(s.state.outcome).toBe('interrupted');
    expect(status(s)).toEqual({ prepare: 'confirmed', upload: 'confirmed', build: 'unverified', preview: 'unverified' });
    expect(s.state.stages.find((st) => st.id === 'build')!.note).toMatch(/Ctrl\+C/);
    expect(s.state.failedStage).toBeUndefined();
  });
});

describe('edge cases', () => {
  const chunk = (lines: string[]) => lines.map((d, i) => ({ t: i * 10, d: d + '\r\n' }));

  it('leaves Upload unverified when no upload was printed', () => {
    const s = run({
      chunks: chunk(['Vercel CLI 65.2.0', 'Deploying acme/web', '  Inspect         https://vercel.com/a/b/c', '  Preview         https://b.vercel.app', '2026-11-05T18:00:00.000Z  Build Completed in /vercel/output [9s]', '✓ Ready in 12s']),
      exitCode: 0,
      signal: null,
      interrupted: false,
    });
    expect(s.state.outcome).toBe('success');
    expect(status(s)).toEqual({ prepare: 'confirmed', upload: 'unverified', build: 'confirmed', preview: 'confirmed' });
    expect(s.state.stages.find((st) => st.id === 'upload')!.note).toMatch(/no upload appeared in the output/);
  });

  it('marks a non-zero exit with no recognizable error as a failure in the current stage', () => {
    const s = run({ chunks: chunk(['Vercel CLI 65.2.0', 'Deploying acme/web', 'Uploading [==--] (1KB/9KB)']), exitCode: 1, signal: null, interrupted: false });
    expect(s.state.outcome).toBe('failure');
    expect(s.state.failedStage).toBe('upload');
    expect(s.state.lastConfirmed).toBe('prepare');
  });

  it('does not report an interruption when Ctrl+C lands after the deploy finished', () => {
    const s = run({
      chunks: chunk(['Deploying a/b', 'Uploading [==] (1KB/1KB)', '  Inspect         https://vercel.com/a/b/c', '2026-11-05T18:00:00.000Z  Build Completed in /vercel/output [9s]', '✓ Ready in 12s']),
      exitCode: 0,
      signal: null,
      interrupted: true,
    });
    expect(s.state.outcome).toBe('success');
  });

  it('redacts secret env values that show up in output', () => {
    const s = run({ chunks: chunk(['Vercel CLI 65.2.0', 'echo sk9Xf3kLq0pZvB7w is my key']), exitCode: 0, signal: null, interrupted: false }, { STRIPE_SECRET: 'sk9Xf3kLq0pZvB7w' });
    expect(s.logs[1]!.text).toBe('echo [REDACTED:STRIPE_SECRET] is my key');
  });
});
