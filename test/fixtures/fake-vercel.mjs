#!/usr/bin/env node
// Stand-in for the Vercel CLI used to exercise Unfold's live (PTY) path without
// deploying anything. Replays a demo transcript, optionally after an interactive prompt.
//   FAKE_VERCEL_DEMO=success|build-failure  FAKE_VERCEL_PROMPT=1
import { readFileSync } from 'node:fs';

const demo = JSON.parse(readFileSync(new URL(`../../demos/vercel-${process.env.FAKE_VERCEL_DEMO || 'success'}.json`, import.meta.url), 'utf8'));
process.stderr.write(`[fake-vercel] args=${JSON.stringify(process.argv.slice(2))} stdinTTY=${!!process.stdin.isTTY} stdoutTTY=${!!process.stdout.isTTY}\n`);

async function prompt() {
  process.stdout.write('? Set up and deploy “~/acme-web”? (y/N) ');
  process.stdin.setRawMode?.(true);
  const key = await new Promise((r) => process.stdin.once('data', (d) => r(d.toString())));
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  process.stdout.write(`${key.trim() || '?'}\r\n`);
  if (key.includes('\x03')) process.exit(130);
}

if (process.env.FAKE_VERCEL_PROMPT) await prompt();
const start = Date.now();
for (const c of demo.chunks) {
  const wait = c.t / 4 - (Date.now() - start);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  process.stdout.write(c.d);
}
process.exit(demo.exitCode ?? 1);
