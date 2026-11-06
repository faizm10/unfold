import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDemo } from '../src/commands/demo.js';
import { UsageError } from '../src/core/errors.js';
import { Redactor } from '../src/core/redact.js';
import { Session } from '../src/core/session.js';
import { claude, claudePresenter } from '../src/providers/agents/claude.js';
import { codex } from '../src/providers/agents/codex.js';
import { classifyCommand, unwrapShell } from '../src/providers/agents/shared.js';
import { gcloud } from '../src/providers/gcloud/index.js';
import { GcloudParser } from '../src/providers/gcloud/parser.js';
import type { Provider } from '../src/providers/provider.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'real', name), 'utf8');

/** Runs raw output through the real pipeline: decoder → redactor → presenter/parser → reducer. */
function run(provider: Provider, output: string, exitCode = 0, cwd = '/work/agent') {
  const s = new Session({ provider, command: [provider.id], cwd, mode: 'replay', redactor: new Redactor() });
  s.start();
  s.write(output.split('\n').join('\r\n'));
  s.end(exitCode, null, false);
  return s;
}
const status = (s: Session) => Object.fromEntries(s.state.stages.map((st) => [st.id, st.status]));
const fact = (s: Session, key: string) => s.state.facts.find((f) => f.key === key)?.value;
const note = (s: Session, id: string) => s.state.stages.find((st) => st.id === id)?.note;

function playDemo(provider: string, name: string) {
  const t = loadDemo(provider, name);
  return run({ claude, codex, gcloud }[provider as 'claude' | 'codex' | 'gcloud'], t.chunks.map((c) => c.d).join('').replace(/\r\n/g, '\n'), t.exitCode ?? 1, t.cwd);
}

describe('shared agent helpers', () => {
  it.each([
    ['npm test', 'verify'],
    ['pnpm run build', 'verify'],
    ['npx tsc --noEmit', 'verify'],
    ['pytest -q tests/', 'verify'],
    ['cargo clippy', 'verify'],
    ['cat src/a.ts && ls', 'explore'],
    ['rg TODO src', 'explore'],
    ['git status 2>/dev/null', 'explore'],
    ['grep -q x f > /dev/null', 'explore'],
    ["sed -i 's/a/b/' f.js", 'change'],
    ['echo hi > notes.txt', 'change'],
    ['npm install zod', 'change'],
  ])('classifies %s as %s', (cmd, kind) => {
    expect(classifyCommand(cmd)).toBe(kind);
  });

  it('unwraps the login shell Codex runs commands in', () => {
    expect(unwrapShell(`/bin/zsh -lc 'cat hello.txt'`)).toBe('cat hello.txt');
    expect(unwrapShell('/bin/zsh -lc false')).toBe('false');
    expect(unwrapShell('/bin/bash -lc "npm test -- --watch=false"')).toBe('npm test -- --watch=false');
  });
});

describe('claude (real stream-json from Claude Code 2.1)', () => {
  const s = run(claude, fixture('claude-edit.jsonl'));

  it('follows the real session through each stage', () => {
    expect(status(s)).toEqual({ start: 'confirmed', explore: 'confirmed', change: 'confirmed', verify: 'unverified', done: 'confirmed' });
    expect(fact(s, 'model')).toBe('claude-opus-5-5');
    expect(fact(s, 'cliVersion')).toBe('2.1.292');
    expect(fact(s, 'filesChanged')).toBe('hello.txt');
    expect(fact(s, 'cost')).toMatch(/^\$\d+\.\d\d$/);
  });

  it('shows readable lines instead of JSON, with paths relative to the session folder', () => {
    const lines = s.logs.map((l) => l.text);
    expect(lines[0]).toBe('● Claude Code 2.1.292 · claude-opus-5-5 · permission mode: default');
    expect(lines).toContain('  → Read hello.txt');
    expect(lines).toContain('  → Edit hello.txt');
    expect(lines).toContain('  $ false');
    expect(lines).toContain('    ✗ Exit code 1');
    expect(lines.every((l) => !l.startsWith('{'))).toBe(true);
  });

  it('does not count `false` as a check, so Verify is honestly unverified', () => {
    expect(note(s, 'verify')).toBe("This run's output never showed this step.");
  });

  it('reports a failed session and permission denials', () => {
    const failed = run(
      claude,
      [
        JSON.stringify({ type: 'system', subtype: 'init', cwd: '/w', model: 'm' }),
        JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 10, permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'Bash' }] }),
      ].join('\n'),
      1,
    );
    expect(failed.state.outcome).toBe('failure');
    expect(failed.state.failedStage).toBe('done');
    expect(failed.state.errors.find((e) => e.severity === 'fatal')?.message).toBe('It hit the maximum number of turns.');
    expect(fact(failed, 'denied')).toBe('Bash');
    expect(failed.state.fix?.prompt).toContain('The agent was denied permission for: Bash');
  });

  it('requires a task', () => {
    expect(() => claude.launch(['--allowedTools'])).toThrow(UsageError);
    expect(claude.launch(['fix it', '--permission-mode', 'acceptEdits']).args).toEqual(['-p', 'fix it', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose']);
  });

  it('hides hook and rate-limit events', () => {
    const present = claudePresenter();
    expect(present('{"type":"system","subtype":"hook_started","hook_name":"x"}')).toBeNull();
    expect(present('{"type":"rate_limit_event"}')).toBeNull();
  });
});

describe('codex (real exec --json from Codex CLI 0.165)', () => {
  const s = run(codex, fixture('codex-edit.jsonl'));

  it('follows the real session through each stage', () => {
    expect(status(s)).toEqual({ start: 'confirmed', explore: 'confirmed', change: 'confirmed', verify: 'unverified', done: 'confirmed' });
    expect(fact(s, 'filesChanged')).toBe('hello.txt');
    expect(fact(s, 'tokens')).toMatch(/k in \(.*cached\), \d+ out$/);
  });

  it('shows commands, edits and failures as readable lines', () => {
    const lines = s.logs.map((l) => l.text);
    expect(lines).toContain('● Codex session started');
    expect(lines).toContain('  $ cat hello.txt');
    expect(lines).toContain('  ✎ edit hello.txt');
    expect(lines).toContain('    ✗ exit 1');
  });

  it('builds the exec command', () => {
    expect(codex.launch(['fix it', '--sandbox', 'workspace-write']).args).toEqual(['exec', '--json', 'fix it', '--sandbox', 'workspace-write']);
    expect(codex.launch(['exec', 'fix it']).args).toEqual(['exec', '--json', 'fix it']);
    expect(() => codex.launch([])).toThrow(UsageError);
  });

  it('marks a failed turn as a failure in Done', () => {
    const failed = run(codex, ['{"type":"thread.started","thread_id":"t"}', '{"type":"turn.failed","error":{"message":"stream disconnected"}}'].join('\n'), 1);
    expect(failed.state.failedStage).toBe('done');
    expect(failed.state.errors[0]?.message).toBe('stream disconnected');
  });
});

describe('gcloud run deploy', () => {
  it('reads a real failure with an HTML error page', () => {
    const s = run(gcloud, fixture('gcloud-region-404.txt'), 1);
    expect(s.state.failedStage).toBe('prepare');
    expect(s.state.errors.find((e) => e.severity === 'fatal')?.message).toBe('HTTPError 404');
    const cause = s.state.errors.find((e) => e.severity === 'cause');
    expect(cause?.message).toBe('The requested URL /v1/projects/my-project/locations/not-a-region/services/unfold-probe:testIamPermissions was not found on this server.');
  });

  it('parses the start line, steps and tick marks', () => {
    const p = new GcloudParser();
    const feed = (text: string) => p.feed({ seq: 1, at: 0, text });
    expect(feed('Deploying container to Cloud Run service [api] in project [p1] region [europe-west1]')).toContainEqual({
      kind: 'evidence',
      stage: 'build',
      note: 'Deploying a prebuilt container image, so there is nothing to build.',
    });
    expect(feed('  ✓ Building Container... Logs are available at [ https://console.cloud.google.com/cloud-build/builds/x ].')).toContainEqual(
      expect.objectContaining({ kind: 'fact', key: 'logsUrl', value: 'https://console.cloud.google.com/cloud-build/builds/x' }),
    );
    expect(feed('  OK Creating Revision...')).toEqual([{ kind: 'evidence', stage: 'deploy', note: 'Creating Revision finished.' }]);
    expect(feed('  X Routing traffic...')).toEqual([{ kind: 'stage', stage: 'deploy', status: 'failed', note: 'Routing traffic failed.' }]);
  });

  it('runs the success demo to Live with the service URL', () => {
    const s = playDemo('gcloud', 'success');
    expect(status(s)).toEqual({ prepare: 'confirmed', build: 'confirmed', deploy: 'confirmed', live: 'confirmed' });
    expect(fact(s, 'deploymentUrl')).toBe('https://tiny-api-482910374615.us-central1.run.app');
    expect(fact(s, 'revision')).toBe('tiny-api-00001-xof');
  });

  it('runs the deploy-failure demo to a failed Deploy with PORT advice', () => {
    const s = playDemo('gcloud', 'deploy-failure');
    expect(status(s)).toEqual({ prepare: 'confirmed', build: 'confirmed', deploy: 'failed', live: 'unverified' });
    expect(note(s, 'deploy')).toBe('Creating Revision failed.');
    expect(s.state.errors.find((e) => e.severity === 'fatal')?.message).toMatch(/failed to start and listen on the port defined provided by the PORT=8080/);
    expect(s.state.fix?.prompt).toContain('must listen on 0.0.0.0 at the port in the PORT environment variable');
  });

  it('builds `gcloud run deploy` and accepts the full form', () => {
    expect(gcloud.launch(['--source', '.']).args).toEqual(['run', 'deploy', '--source', '.']);
    expect(gcloud.launch(['run', 'deploy', 'api']).args).toEqual(['run', 'deploy', 'api']);
  });
});

describe('agent demos', () => {
  it('claude success: a failing check followed by a passing one confirms Verify', () => {
    const s = playDemo('claude', 'success');
    expect(status(s)).toEqual({ start: 'confirmed', explore: 'confirmed', change: 'confirmed', verify: 'confirmed', done: 'confirmed' });
    expect(note(s, 'verify')).toBe('Check passed: npm test');
  });

  it('codex checks-failing: done, but Verify says the last check failed', () => {
    const s = playDemo('codex', 'checks-failing');
    expect(s.state.outcome).toBe('success');
    expect(status(s).verify).toBe('unverified');
    expect(note(s, 'verify')).toBe('Checks ran, but the last one failed: npm test');
    expect(fact(s, 'filesChanged')).toBe('src/dates.js');
  });
});
