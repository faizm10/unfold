// Generates demos/vercel-*.json: synthetic terminal transcripts that mimic what
// Vercel CLI 65.2.0 prints in a TTY for `vercel deploy --logs` (spinner redraws,
// ANSI colors, aligned labels, timestamped build logs). No real deployment data.
//   node scripts/make-demos.mjs
import { writeFileSync } from 'node:fs';

const ESC = '\x1b';
const bold = (s) => `${ESC}[1m${s}${ESC}[22m`;
const dim = (s) => `${ESC}[2m${s}${ESC}[22m`;
const cyan = (s) => `${ESC}[36m${s}${ESC}[39m`;
const red = (s) => `${ESC}[31m${s}${ESC}[39m`;
const green = (s) => `${ESC}[32m${s}${ESC}[39m`;
const yellow = (s) => `${ESC}[33m${s}${ESC}[39m`;
const CLEAR = `${ESC}[2K${ESC}[1G`;
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const label = (l, v) => `  ${bold(l.padEnd(16))}${bold(cyan(v))}\r\n`;

class Tape {
  chunks = [];
  t = 0;
  ts = Date.parse('2026-11-05T18:04:02.000Z');
  out(d, dt = 0) {
    this.t += dt;
    this.chunks.push({ t: this.t, d });
    return this;
  }
  line(text, dt = 60) {
    return this.out(text + '\r\n', dt);
  }
  spin(text, ms, dt = 80) {
    for (let i = 0; i * 80 < ms; i++) this.out(`${CLEAR}${cyan(FRAMES[i % FRAMES.length])} ${text}`, i === 0 ? dt : 80);
    return this;
  }
  clear(dt = 0) {
    return this.out(CLEAR, dt);
  }
  log(text, dt = 140, color = (s) => s) {
    this.ts += Math.max(1, Math.round(dt * 7.3));
    return this.out(`${dim(new Date(this.ts).toISOString())}  ${color(text)}\r\n`, dt);
  }
}

const INSPECT = 'https://vercel.com/acme/acme-web/6TfY2pQkzR1mWcN8xLbV3hGd';
const PREVIEW = 'https://acme-web-7k2m9xq4p-acme.vercel.app';

function intro(tape) {
  tape.line('Vercel CLI 65.2.0', 0);
  tape.spin('Retrieving project…', 700, 300);
  tape.spin(`Deploying ${bold('acme/acme-web')}`, 700);
  const total = 184.6;
  for (let i = 0; i <= 8; i++) {
    const done = ((total * i) / 8).toFixed(1);
    const bar = '='.repeat(i * 2.5).padEnd(20, '-');
    tape.out(`${CLEAR}${cyan(FRAMES[i % 10])} Uploading ${ESC}[0m[${bar}] (${done}KB/${total}KB)`, i === 0 ? 120 : 260);
  }
  tape.clear(300);
  tape.out(label('Inspect', INSPECT), 0);
  tape.out(label('Preview', PREVIEW), 20);
  tape.spin('Queued…', 1100, 120);
  tape.clear();
  tape.log('Running build in Washington, D.C., USA (East) – iad1', 200);
  tape.log('Build machine configuration: 2 cores, 8 GB');
  tape.log('Retrieving list of deployment files...');
  tape.log('Downloading 41 deployment files...', 300);
  tape.log('Restored build cache from previous deployment (9QwErTy2uIoPaSdF)', 500);
  tape.log('Running "vercel build"', 200);
  tape.log('Vercel CLI 65.2.0', 300);
  tape.log('Installing dependencies...', 200);
  tape.log('added 3 packages, and audited 318 packages in 3s', 1600);
  tape.log('Detected Next.js version: 16.0.1', 200);
  tape.log('Running "npm run build"', 200);
  tape.log('');
  tape.log('> acme-web@0.1.0 build', 200);
  tape.log('> next build');
  tape.log('');
  tape.log('   ▲ Next.js 16.0.1', 400);
  tape.log('   Creating an optimized production build ...', 200);
}

function success() {
  const tape = new Tape();
  intro(tape);
  tape.log(' ✓ Compiled successfully in 7.4s', 2400);
  tape.log('   Linting and checking validity of types ...', 200);
  tape.log('   Collecting page data ...', 1400);
  tape.log(' ✓ Generating static pages (7/7)', 700);
  tape.log('   Finalizing page optimization ...', 300);
  tape.log('');
  tape.log('Route (app)                                 Size  First Load JS', 200);
  tape.log('┌ ○ /                                    5.21 kB         112 kB', 20);
  tape.log('├ ○ /_not-found                              0 B         106 kB', 20);
  tape.log('└ ○ /checkout                            3.14 kB         110 kB', 20);
  tape.log('○  (Static)  prerendered as static content', 20);
  tape.log('Build Completed in /vercel/output [24s]', 500);
  tape.log('Deploying outputs...', 300);
  tape.log('Deployment completed', 1700);
  tape.log('Creating build cache...', 200);
  tape.log('Created build cache: 3.212s', 900);
  tape.log('Uploading build cache [41.2 MB]...', 100);
  tape.out(`\r\n${green('✓')} ${bold('Ready')} ${dim('in 31s')}\r\n\r\n`, 600);
  tape.out(`\r\n${yellow('!')} Deployment Protection is on for this project (Vercel Authentication). Use ${cyan('`vercel curl`')} to access it.\r\n`, 40);
  return {
    provider: 'vercel',
    description: 'A preview deploy of a small Next.js app that succeeds.',
    command: ['vercel', 'deploy', '--logs'],
    cwd: '~/projects/acme-web',
    exitCode: 0,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

function buildFailure() {
  const tape = new Tape();
  intro(tape);
  // A fake credential echoed by a build script, to show redaction in action.
  tape.log('[db] checking migrations with DATABASE_URL=postgres://acme_app:Demo-Pa55-not-real@db.acme.internal:5432/acme', 900);
  tape.log(' ✓ Compiled successfully in 6.9s', 1800);
  tape.log('   Linting and checking validity of types ...', 200);
  tape.log('Failed to compile.', 1500, red);
  tape.log('');
  tape.log('./app/checkout/page.tsx:42:21', 20, red);
  tape.log("Type error: Property 'totalCents' does not exist on type 'Cart'. Did you mean 'subtotalCents'?", 20, red);
  tape.log('');
  tape.log('  40 |   return (', 20);
  tape.log('  41 |     <OrderSummary', 20);
  tape.log('> 42 |       total={cart.totalCents}', 20);
  tape.log('     |                   ^', 20);
  tape.log('  43 |       currency={cart.currency}', 20);
  tape.log('Next.js build worker exited with code: 1 and signal: null', 200, red);
  tape.log('Error: Command "npm run build" exited with 1', 300, red);
  tape.out(`${red('Error:')} Command "npm run build" exited with 1\r\n`, 700);
  return {
    provider: 'vercel',
    description: 'A preview deploy whose Next.js build fails on a type error.',
    command: ['vercel', 'deploy', '--logs'],
    cwd: '~/projects/acme-web',
    exitCode: 1,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

function interrupted() {
  const tape = new Tape();
  intro(tape);
  tape.out('^C', 2600);
  return {
    provider: 'vercel',
    description: 'A preview deploy stopped with Ctrl+C while Vercel was building.',
    command: ['vercel', 'deploy', '--logs'],
    cwd: '~/projects/acme-web',
    exitCode: null,
    signal: 'SIGINT',
    interrupted: true,
    chunks: tape.chunks,
  };
}

// ---------- gcloud: `gcloud run deploy` (strings from Google Cloud SDK 591 source) ----------

const GCLOUD_START = `Building using Dockerfile and deploying container to Cloud Run service [${bold('tiny-api')}] in project [${bold('acme-prod')}] region [${bold('us-central1')}]`;
const BUILD_LOGS = 'https://console.cloud.google.com/cloud-build/builds;region=us-central1/5c1f0e7a-3d2b-4e8a-9f61-0a7b2c4d6e18?project=482910374615';

function gcloudStep(tape, label, ms, mark = green('✓'), suffix = '') {
  tape.spin(`${label}...`, ms, 60);
  tape.out(`${CLEAR}  ${mark} ${label}...${suffix}\r\n`, 80);
}

function gcloudIntro(tape) {
  tape.line(GCLOUD_START, 0);
  tape.spin('Building and deploying new service... Uploading sources.', 600, 200);
  tape.clear();
  gcloudStep(tape, 'Uploading sources', 900);
  gcloudStep(tape, 'Building Container', 5200, green('✓'), ` Logs are available at [ ${BUILD_LOGS} ].`);
}

function gcloudSuccess() {
  const tape = new Tape();
  gcloudIntro(tape);
  gcloudStep(tape, 'Creating Revision', 2600);
  gcloudStep(tape, 'Routing traffic', 900);
  gcloudStep(tape, 'Setting IAM Policy', 500);
  tape.line('Done.', 100);
  tape.line(`Service [${bold('tiny-api')}] revision [${bold('tiny-api-00001-xof')}] has been deployed and is serving ${bold('100')} percent of traffic.`, 80);
  tape.line(`Service URL: ${bold('https://tiny-api-482910374615.us-central1.run.app')}`, 40);
  return {
    provider: 'gcloud',
    description: 'A Cloud Run source deploy of a small API that succeeds.',
    command: ['gcloud', 'run', 'deploy', 'tiny-api', '--source', '.', '--region', 'us-central1'],
    cwd: '~/projects/tiny-api',
    exitCode: 0,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

function gcloudDeployFailure() {
  const tape = new Tape();
  gcloudIntro(tape);
  gcloudStep(tape, 'Creating Revision', 4200, red('X'));
  tape.line(`  . Routing traffic...`, 40);
  tape.line('Deployment failed', 200);
  tape.line(
    `${red('ERROR:')} (gcloud.run.deploy) Revision 'tiny-api-00002-wuv' is not ready and cannot serve traffic. The user-provided container failed to start and listen on the port defined provided by the PORT=8080 environment variable within the allocated timeout. This can happen when the port is misconfigured or if the timeout is too short. The health check timeout can be extended. Logs for this revision might contain more information.`,
    60,
  );
  tape.line('', 20);
  tape.line('Logs URL: https://console.cloud.google.com/logs/viewer?project=acme-prod&resource=cloud_run_revision/service_name/tiny-api/revision_name/tiny-api-00002-wuv', 20);
  tape.line('For more troubleshooting guidance, see https://cloud.google.com/run/docs/troubleshooting#container-failed-to-start', 20);
  return {
    provider: 'gcloud',
    description: 'A Cloud Run deploy whose container never starts listening on $PORT.',
    command: ['gcloud', 'run', 'deploy', 'tiny-api', '--source', '.', '--region', 'us-central1'],
    cwd: '~/projects/tiny-api',
    exitCode: 1,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

// ---------- coding agents: JSON event streams (schemas captured from real runs) ----------

const APP = '/home/dev/tiny-app';
const json = (tape, obj, dt) => tape.out(JSON.stringify(obj) + '\r\n', dt);

function claudeSuccess() {
  const tape = new Tape();
  const sid = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
  const msg = (content) => ({ type: 'assistant', message: { content }, session_id: sid });
  const res = (id, content, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] }, session_id: sid });
  json(tape, { type: 'system', subtype: 'init', cwd: APP, session_id: sid, model: 'claude-opus-5-5', permissionMode: 'acceptEdits', claude_code_version: '2.1.292', tools: ['Read', 'Edit', 'Bash'] }, 300);
  json(tape, msg([{ type: 'text', text: "I'll look at the code and run the tests first." }]), 1500);
  json(tape, msg([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${APP}/sum.js` } }]), 900);
  json(tape, res('t1', '1\texport function sum(a, b) {\n2\t  return a - b;\n3\t}\n'), 300);
  json(tape, msg([{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]), 1200);
  json(tape, res('t2', 'Exit code 1\nAssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n-1 !== 5\n', true), 1800);
  json(tape, msg([{ type: 'text', text: '`sum` subtracts instead of adding. Fixing it.' }]), 1400);
  json(tape, msg([{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: `${APP}/sum.js`, old_string: 'return a - b;', new_string: 'return a + b;' } }]), 1100);
  json(tape, res('t3', `The file ${APP}/sum.js has been updated.`), 300);
  json(tape, msg([{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'npm test', description: 'Run the tests again' } }]), 900);
  json(tape, res('t4', '> tiny-app@1.0.0 test\n> node test.js\n\nok\n'), 1700);
  const answer = 'Fixed `sum` in sum.js: it returned `a - b` instead of `a + b`. `npm test` now passes.';
  json(tape, msg([{ type: 'text', text: answer }]), 1200);
  json(tape, { type: 'result', subtype: 'success', is_error: false, duration_ms: 13800, num_turns: 6, result: answer, total_cost_usd: 0.1876, permission_denials: [], session_id: sid }, 200);
  return {
    provider: 'claude',
    description: 'Claude Code fixes a failing test and confirms it with npm test.',
    command: ['claude', '-p', 'Fix the failing test', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose'],
    cwd: APP,
    exitCode: 0,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

function codexChecksFailing() {
  const tape = new Tape();
  const zsh = (cmd) => `/bin/zsh -lc ${JSON.stringify(cmd)}`;
  const item = (type, it, dt) => json(tape, { type, item: it }, dt);
  json(tape, { type: 'thread.started', thread_id: '01a1ae40-5b6c-7d8e-9f01-23456789abcd' }, 300);
  json(tape, { type: 'turn.started' }, 100);
  item('item.completed', { id: 'item_0', type: 'agent_message', text: "I'll read the date helper and its tests, then fix the time zone bug." }, 2200);
  item('item.started', { id: 'item_1', type: 'command_execution', command: zsh('cat src/dates.js test/dates.test.js'), aggregated_output: '', exit_code: null, status: 'in_progress' }, 900);
  item('item.completed', { id: 'item_1', type: 'command_execution', command: zsh('cat src/dates.js test/dates.test.js'), aggregated_output: 'export function startOfDay(d) { … }\n', exit_code: 0, status: 'completed' }, 300);
  item('item.started', { id: 'item_2', type: 'file_change', changes: [{ path: `${APP}/src/dates.js`, kind: 'update' }], status: 'in_progress' }, 2600);
  item('item.completed', { id: 'item_2', type: 'file_change', changes: [{ path: `${APP}/src/dates.js`, kind: 'update' }], status: 'completed' }, 200);
  const failing = 'npm test';
  const out = '> tiny-app@1.0.0 test\n> node --test\n\n✖ startOfDay keeps the local date (2.1ms)\n  AssertionError: Expected "2026-11-05" but got "2026-11-04"\n\nℹ tests 6  pass 5  fail 1\n';
  item('item.started', { id: 'item_3', type: 'command_execution', command: zsh(failing), aggregated_output: '', exit_code: null, status: 'in_progress' }, 800);
  item('item.completed', { id: 'item_3', type: 'command_execution', command: zsh(failing), aggregated_output: out, exit_code: 1, status: 'failed' }, 2400);
  item('item.completed', { id: 'item_4', type: 'agent_message', text: 'I changed startOfDay to use local time, but one test still fails: it expects 2026-11-05 and gets 2026-11-04, so the test itself may assume UTC. Can you confirm which time zone the dates should use?' }, 2600);
  json(tape, { type: 'turn.completed', usage: { input_tokens: 64210, cached_input_tokens: 51200, output_tokens: 812 } }, 200);
  return {
    provider: 'codex',
    description: 'Codex edits a date helper, but the tests still fail when it stops.',
    command: ['codex', 'exec', '--json', 'Fix the time zone bug in startOfDay', '--sandbox', 'workspace-write'],
    cwd: APP,
    exitCode: 0,
    signal: null,
    interrupted: false,
    chunks: tape.chunks,
  };
}

const ALL = {
  'vercel-success': success(),
  'vercel-build-failure': buildFailure(),
  'vercel-interrupted': interrupted(),
  'gcloud-success': gcloudSuccess(),
  'gcloud-deploy-failure': gcloudDeployFailure(),
  'claude-success': claudeSuccess(),
  'codex-checks-failing': codexChecksFailing(),
};
for (const [name, t] of Object.entries(ALL)) {
  writeFileSync(new URL(`../demos/${name}.json`, import.meta.url), JSON.stringify(t, null, 1) + '\n');
  console.log(`demos/${name}.json  ${t.chunks.length} chunks, ${(t.chunks.at(-1).t / 1000).toFixed(1)}s`);
}
