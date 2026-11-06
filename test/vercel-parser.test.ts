import { describe, expect, it } from 'vitest';
import type { Signal } from '../src/core/model.js';
import { parseLines, VercelParser } from '../src/providers/vercel/parser.js';

const stageSignals = (sigs: Signal[]) => sigs.filter((s) => s.kind === 'stage').map((s) => s.kind === 'stage' && `${s.stage}:${s.status}`);
const facts = (sigs: Signal[]) => Object.fromEntries(sigs.flatMap((s) => (s.kind === 'fact' ? [[s.key, s.value]] : [])));
const errors = (sigs: Signal[]) => sigs.filter((s): s is Extract<Signal, { kind: 'error' }> => s.kind === 'error');

const TS = '2026-11-05T18:04:03.120Z';

describe('VercelParser: prepare', () => {
  it('starts Prepare on the CLI banner and records the version', () => {
    const [s] = parseLines(['Vercel CLI 65.2.0']);
    expect(stageSignals(s!)).toEqual(['prepare:active']);
    expect(facts(s!)).toEqual({ cliVersion: '65.2.0' });
  });

  it('confirms Prepare on "Deploying team/project" and captures the project', () => {
    const [, s] = parseLines(['Vercel CLI 65.2.0', 'Deploying acme/acme-web']);
    expect(stageSignals(s!)).toEqual(['prepare:confirmed']);
    expect(facts(s!)).toEqual({ project: 'acme/acme-web' });
  });

  it('treats interactive prompts as Prepare evidence, not progress', () => {
    const [, s] = parseLines(['Vercel CLI 65.2.0', '? Set up and deploy “~/acme-web”? yes']);
    expect(s).toEqual([{ kind: 'evidence', stage: 'prepare', note: expect.stringContaining('asked') }]);
  });

  it('attributes auth errors before upload to Prepare', () => {
    const [, s] = parseLines(['Vercel CLI 65.2.0', 'Error: The specified token is not valid. Use `vercel login` to generate a new token.']);
    expect(errors(s!)).toEqual([expect.objectContaining({ severity: 'fatal', stage: 'prepare' })]);
  });

  it('reads non-interactive JSON errors', () => {
    const [, s] = parseLines(['Vercel CLI 65.2.0', '{"status":"error","reason":"link_required","message":"Project not linked.","hint":"Run vercel link."}']);
    expect(errors(s!)[0]).toMatchObject({ severity: 'fatal', stage: 'prepare', message: 'Project not linked. Run vercel link.' });
  });
});

describe('VercelParser: upload and deployment creation', () => {
  it('tracks upload progress', () => {
    const [, , s] = parseLines(['Vercel CLI 65.2.0', 'Deploying acme/web', 'Uploading [=====---------------] (46.2KB/184.6KB)']);
    expect(s).toEqual([{ kind: 'stage', stage: 'upload', status: 'active', note: 'Uploading new or changed files: 46.2KB/184.6KB.' }]);
  });

  it('confirms Upload when the Inspect URL appears after an upload', () => {
    const out = parseLines([
      'Deploying acme/web',
      'Uploading [====================] (184.6KB/184.6KB)',
      'Inspect         https://vercel.com/acme/web/6TfY2pQk',
    ]);
    expect(stageSignals(out[2]!)).toEqual(['prepare:confirmed', 'upload:confirmed']);
    expect(facts(out[2]!)).toEqual({ inspectUrl: 'https://vercel.com/acme/web/6TfY2pQk' });
  });

  it('does not claim an upload it did not see', () => {
    const out = parseLines(['Deploying acme/web', 'Inspect         https://vercel.com/acme/web/6TfY2pQk']);
    expect(stageSignals(out[1]!)).toEqual(['prepare:confirmed']);
    expect(out[1]).toContainEqual(expect.objectContaining({ kind: 'evidence', stage: 'upload', note: expect.stringContaining('not confirmed') }));
  });

  it('records the preview URL early without claiming it is live', () => {
    const out = parseLines(['Deploying acme/web', 'Inspect         https://vercel.com/x/y/z', 'Preview         https://web-abc-acme.vercel.app']);
    expect(facts(out[2]!)).toEqual({ deploymentUrl: 'https://web-abc-acme.vercel.app' });
    expect(stageSignals(out[2]!)).toEqual([]);
  });

  it('understands the older emoji format', () => {
    const out = parseLines(['🔍  Inspect: https://vercel.com/x/y/z [1s]', '✅  Preview: https://web-abc.vercel.app [1s]']);
    expect(facts(out[0]!).inspectUrl).toBe('https://vercel.com/x/y/z');
    expect(facts(out[1]!).deploymentUrl).toBe('https://web-abc.vercel.app');
  });

  it('flags production deploys', () => {
    const out = parseLines(['Inspect         https://vercel.com/x/y/z', 'Production      https://web-abc.vercel.app']);
    expect(facts(out[1]!)).toMatchObject({ target: 'production' });
  });

  it('attributes upload failures to Upload', () => {
    const out = parseLines(['Deploying acme/web', 'Uploading [==--] (1KB/9KB)', 'Error: Uploading failed. Please try again.']);
    expect(errors(out[2]!)[0]).toMatchObject({ severity: 'fatal', stage: 'upload' });
  });
});

describe('VercelParser: build', () => {
  const created = ['Deploying acme/web', 'Uploading [====] (1KB/1KB)', 'Inspect         https://vercel.com/x/y/z'];

  it('treats Queued as build waiting for a machine', () => {
    const out = parseLines([...created, 'Queued…']);
    expect(stageSignals(out[3]!)).toEqual(['build:active']);
  });

  it('extracts region, machine, build command and framework from timestamped logs', () => {
    const p = new VercelParser();
    const all = [
      ...created,
      `${TS}  Running build in Washington, D.C., USA (East) – iad1`,
      `${TS}  Build machine configuration: 2 cores, 8 GB`,
      `${TS}  Running "vercel build"`,
      `${TS}  Detected Next.js version: 16.0.1`,
      `${TS}  Running "npm run build"`,
    ].flatMap((text, i) => p.feed({ seq: i, at: i, text }));
    expect(facts(all)).toMatchObject({
      region: 'Washington, D.C., USA (East) – iad1',
      machine: '2 cores, 8 GB',
      framework: 'Next.js 16.0.1',
      buildCommand: 'npm run build',
    });
  });

  it('does not mistake the builder\'s own "Vercel CLI" banner for Prepare', () => {
    const out = parseLines([...created, `${TS}  Vercel CLI 65.2.0`]);
    expect(stageSignals(out[3]!)).toEqual(['build:active']);
    expect(facts(out[3]!)).toEqual({});
  });

  it('confirms Build on "Build Completed" with the duration', () => {
    const out = parseLines([...created, `${TS}  Build Completed in /vercel/output [24s]`]);
    expect(out[3]).toContainEqual({ kind: 'stage', stage: 'build', status: 'confirmed', note: 'Build completed in 24s.' });
  });

  it('keeps suspicious build lines as causes, not failures', () => {
    const out = parseLines([...created, `${TS}  Type error: Property 'x' does not exist on type 'Cart'.`]);
    expect(errors(out[3]!)).toEqual([expect.objectContaining({ severity: 'cause', stage: 'build' })]);
    expect(stageSignals(out[3]!)).not.toContain('build:failed');
  });

  it('ignores lines that only look like errors', () => {
    for (const line of ['Found 0 errors.', 'Compiled with no errors', 'warning: error-boundary.tsx is large']) {
      expect(errors(parseLines([...created, `${TS}  ${line}`])[3]!)).toEqual([]);
    }
  });

  it('makes the CLI error after a failed build fatal for Build and records the command', () => {
    const out = parseLines([...created, `${TS}  Running "npm run build"`, 'Error: Command "npm run build" exited with 1']);
    expect(errors(out[4]!)).toEqual([expect.objectContaining({ severity: 'fatal', stage: 'build', message: 'Command "npm run build" exited with 1' })]);
    expect(facts(out[4]!)).toEqual({ failedCommand: 'npm run build (exit 1)' });
  });

  it('treats unprefixed spinner lines after creation as build output (no --logs)', () => {
    const out = parseLines([...created, 'Building…', 'Installing dependencies...', 'Build Completed in /vercel/output [12s]']);
    expect(stageSignals(out[3]!)).toEqual(['build:active']);
    expect(out[4]).toContainEqual(expect.objectContaining({ kind: 'evidence', stage: 'build' }));
    expect(stageSignals(out[5]!)).toEqual(['build:confirmed']);
  });
});

describe('VercelParser: preview', () => {
  const built = ['Deploying acme/web', 'Inspect         https://vercel.com/x/y/z', `${TS}  Build Completed in /vercel/output [24s]`];

  it('marks Preview active while outputs deploy', () => {
    expect(stageSignals(parseLines([...built, `${TS}  Deploying outputs...`])[3]!)).toEqual(['preview:active']);
  });

  it('confirms Build and Preview on Ready', () => {
    const out = parseLines([...built, '✓ Ready in 31s']);
    expect(stageSignals(out[3]!)).toEqual(['build:confirmed', 'preview:confirmed']);
    expect(facts(out[3]!)).toEqual({ duration: '31s' });
  });

  it('confirms Preview when the URL is reprinted after the build (spinner mode)', () => {
    const out = parseLines(['Deploying acme/web', 'Inspect         https://vercel.com/x/y/z', 'Completing…', 'Preview         https://web-abc.vercel.app']);
    expect(stageSignals(out[2]!)).toEqual(['build:confirmed', 'preview:active']);
    expect(stageSignals(out[3]!)).toEqual(['preview:confirmed']);
  });

  it('notes Deployment Protection', () => {
    const out = parseLines([...built, '! Deployment Protection is on for this project (Vercel Authentication). Use `vercel curl` to access it.']);
    expect(facts(out[3]!)).toEqual({ protection: 'On' });
  });

  it('does not treat "Ready" before a deployment exists as success', () => {
    expect(stageSignals(parseLines(['Vercel CLI 65.2.0', 'Ready to deploy?'])[1]!)).toEqual([]);
  });
});
