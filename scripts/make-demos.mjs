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

for (const [name, t] of Object.entries({ success: success(), 'build-failure': buildFailure(), interrupted: interrupted() })) {
  writeFileSync(new URL(`../demos/vercel-${name}.json`, import.meta.url), JSON.stringify(t, null, 1) + '\n');
  console.log(`demos/vercel-${name}.json  ${t.chunks.length} chunks, ${(t.chunks.at(-1).t / 1000).toFixed(1)}s`);
}
