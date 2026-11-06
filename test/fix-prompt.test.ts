import { describe, expect, it } from 'vitest';
import { loadDemo } from '../src/commands/demo.js';
import { parseArgs } from '../src/cli.js';
import { agentCommands } from '../src/core/fix-prompt.js';
import { Redactor } from '../src/core/redact.js';
import { Session } from '../src/core/session.js';
import { vercel } from '../src/providers/vercel/index.js';

function run(name: string, save?: (id: string, p: string) => string) {
  const t = loadDemo(name);
  const s = new Session({ provider: vercel, command: t.command, cwd: '/work/acme-web', mode: 'demo', redactor: new Redactor(), saveFixPrompt: save });
  s.start();
  t.chunks.forEach((c) => s.write(c.d));
  s.end(t.exitCode, t.signal, t.interrupted);
  return s;
}

describe('fix prompt', () => {
  const saved: Record<string, string> = {};
  const s = run('build-failure', (id, p) => ((saved[id] = p), `/home/me/.unfold/runs/${id}.fix-prompt.md`));
  const prompt = s.state.fix!.prompt;

  it('is created automatically when a run fails, and saved', () => {
    expect(prompt).toBeDefined();
    expect(saved[s.runId]).toBe(prompt);
    expect(s.state.fix!.commands!.claude).toBe(`claude "$(cat '/home/me/.unfold/runs/${s.runId}.fix-prompt.md')"`);
    expect(s.state.fix!.commands!.codex).toMatch(/^codex "\$\(cat '/);
  });

  it('describes what failed, where, and how it was run', () => {
    expect(prompt).toContain('# Fix a failed vercel preview deploy');
    expect(prompt).toContain('`vercel deploy --logs` in `/work/acme-web`');
    expect(prompt).toContain('failed during the **Build** stage. The last stage that completed was **Upload**');
    expect(prompt).toContain('Command "npm run build" exited with 1');
  });

  it('leads with the most specific cause and points at the file', () => {
    const relevant = prompt.split('## Most relevant output')[1]!;
    expect(relevant.trimStart().split('\n')[1]).toMatch(/^Type error: Property 'totalCents'/);
    expect(prompt).toContain('`./app/checkout/page.tsx:42:21`');
    // Code frames keep their indentation so the caret still points at the column.
    expect(prompt).toContain('> 42 |       total={cart.totalCents}\n     |                   ^');
  });

  it('includes Vercel build hints and guardrails for the agent', () => {
    expect(prompt).toContain('Reproduce it with `npm run build`');
    expect(prompt).toContain('not local `.env` files');
    expect(prompt).toContain("Don't deploy");
  });

  it('contains no secrets and no raw timestamps', () => {
    expect(prompt).not.toContain('Demo-Pa55-not-real');
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('is not created for successful or interrupted runs', () => {
    expect(run('success').state.fix).toBeUndefined();
    expect(run('interrupted').state.fix).toBeUndefined();
  });

  it('is still shown when saving fails', () => {
    const s2 = run('build-failure', () => {
      throw new Error('disk full');
    });
    expect(s2.state.fix!.prompt).toContain('## Error');
    expect(s2.state.fix!.commands).toBeUndefined();
  });

  it('uses ~ for paths in the home folder when no quoting is needed', () => {
    expect(agentCommands('/Users/me/.unfold/runs/r1.fix-prompt.md', '/Users/me').claude).toBe('claude "$(cat ~/.unfold/runs/r1.fix-prompt.md)"');
    expect(agentCommands('/Users/me/my runs/r1.md', '/Users/me').codex).toBe(`codex "$(cat '/Users/me/my runs/r1.md')"`);
  });

  it('quotes paths safely for the shell', () => {
    expect(agentCommands("/Users/o'neil/x.md").claude).toBe(`claude "$(cat '/Users/o'\\''neil/x.md')"`);
  });
});

describe('--fix flag', () => {
  it('accepts claude or codex and stays out of the vercel args', () => {
    expect(parseArgs(['--fix', 'codex', '--yes'])).toMatchObject({ rest: ['--yes'], flags: { fix: 'codex' } });
    expect(parseArgs(['--fix=claude']).flags.fix).toBe('claude');
    expect(() => parseArgs(['--fix', 'gpt'])).toThrow(/claude.*codex/);
  });
});
