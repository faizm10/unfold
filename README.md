# Unfold

**Watch what happens after you hit Enter.**

Unfold wraps a CLI command and shows what it's doing as a flow, right in your terminal. The command's own output and prompts work exactly as before, and a small panel pinned to the bottom of the terminal tracks each stage as it happens. It starts with one workflow: a Vercel preview deploy.

```
Vercel CLI 65.2.0
  Inspect         https://vercel.com/acme/acme-web/6TfY2pQk…
2026-11-05T18:04:31Z  Running "npm run build"
…
── unfold · vercel deploy --logs ─────────────────────── Running 12.4s
 ✓ Prepare ── ✓ Upload ── ⠹ Build ── ○ Preview
 Build: Build logs are streaming from Vercel.  ·  Your build command started.
```

When the command finishes, the panel turns into a summary: every stage's status and reason, the error and most likely cause with line numbers, the URLs, and (on failure) a ready-made fix command for Claude Code or Codex.

Run `unfold show` to explore the run full screen. For each stage it shows two things side by side:

- **Observed in this run**: status, facts and the exact output lines from your deploy, each linking to its place in the logs.
- **How this stage works**: a general, plain-language explanation. It is clearly labeled as not coming from your run.

Use ←/→ to switch stages, `l` for the logs, `e` to jump to the error, `f` for the fix prompt, `c`/`x` to copy the Claude/Codex command, and `q` to quit.

A stage is only marked **Confirmed** when the output proves it. If the output can't confirm a stage, it stays **Unverified** (`?`) and Unfold says why. One example: Vercel skips uploading files it already has, so a deploy can finish without the output ever showing an upload. When a deploy fails, you see the stage it failed in, the last confirmed stage, the error, the line most likely to be the cause, and a link to that line in the logs.

## Setup

Requires Node 20+.

```sh
npm install
npm run build
npm link        # optional: puts `unfold` on your PATH
```

## Try the demos (no Vercel account needed)

The demos play recorded terminal output through the same pipeline a real run uses.

```sh
npm run demo:success        # preview deploy that succeeds
npm run demo:failure        # build fails on a TypeScript error
npm run demo:interrupted    # Ctrl+C while Vercel is building
```

Or run `node bin/unfold.js demo build-failure --speed 2`, then `node bin/unfold.js show` to explore it. Press Ctrl+C during any demo to see the interrupted state.

## Run a real preview deploy

You need the Vercel CLI (`npm i -g vercel`) and `vercel login`. From a project folder:

```sh
cd ~/code/my-app
unfold vercel                 # runs: vercel deploy --logs
unfold vercel --yes           # any vercel deploy flags pass straight through
```

- Unfold runs your installed `vercel` with your existing login and `.vercel/` project link. If the folder isn't linked yet, the Vercel CLI asks its usual questions in your terminal.
- Unfold adds `--logs` so that the Build stage has real evidence.
- Unfold creates preview deployments by default. Adding `--prod` makes a production deploy, so don't pass it unless that's what you want.
- If you belong to several Vercel teams, the CLI asks which one to use. Pass `--scope <team>` to skip the question.
- Ctrl+C goes to the Vercel CLI as usual. If the deployment had already been created, Vercel may keep building it, and the summary shows its Inspect URL so you can check.
- Every run is saved. `unfold show` explores the latest one, `unfold show <run-id>` an older one, and `unfold runs` lists them.

Unfold options: `--fix claude|codex` (see below), `--no-panel` (no pinned panel, summary only), `--speed <n>` (demos and replays).

### Browser view (optional)

Nothing is served unless you ask for it. Add `--web` to also open the flow in a local browser page, for example `unfold vercel --web` or `unfold show --web`. The page is served on `127.0.0.1` only. With `--web` you can also use `--no-open`, `--once` (exit when the run ends) and `--port <n>` (default 4317).

## When a deploy fails: hand it to Claude Code or Codex

Every failed run automatically gets a fix prompt built from that run. It contains:

- the error and the output lines most likely to be the cause, most specific first
- a redacted log excerpt
- files mentioned in the errors, such as `./app/checkout/page.tsx:42:21`
- the framework and build command
- hints about the stage that failed, for example that Vercel builds use the project's Preview environment variables rather than your local `.env`

The prompt also tells the agent not to deploy and not to change environment variables.

- The prompt is saved to `~/.unfold/runs/<run>.fix-prompt.md` and the summary prints a ready-to-paste command: `claude "$(cat ~/.unfold/runs/<run>.fix-prompt.md)"` or the same with `codex`.
- In `unfold show`, `f` displays the prompt and `c`/`x` copy the Claude/Codex command. The browser view (`--web`) has the same options.
- `unfold vercel --fix claude` (or `--fix codex`) goes one step further: if the deploy fails, Unfold starts that agent in your project folder with the prompt. Nothing starts on success, and nothing starts unless you pass the flag.

Try it without an account: `node bin/unfold.js demo build-failure`.

## Privacy

- **Everything stays local.** By default nothing is served at all. With `--web` the page is served on `127.0.0.1` only, and requests for any other host name are rejected. Unfold sends no telemetry.
- **Secrets are redacted** before any output is shown on the page or saved to disk. This covers tokens, keys, JWTs, `user:password@` in URLs, `KEY=value` pairs with secret-looking names, private key blocks, and `--token` / `--env` flag values. Values of secret-looking environment variables are also matched, in memory only.
- **The environment is never recorded.** The Vercel CLI inherits it so that your login works, and Unfold doesn't save it.
- **Saved runs are private to you.** They're written to `~/.unfold/runs/*.jsonl` with mode `0600`, outside your project, so they can't be committed by accident.
- Your own terminal shows the CLI's unredacted output, the same as it would without Unfold.

## How it's built

```
src/core/          shared and provider-agnostic
  model.ts         event model: Signal, RunEvent, FlowState
  terminal.ts      PTY bytes → lines (ANSI, OSC links, spinner redraws)
  redact.ts        secret redaction
  flow.ts          reducer: signals → stage states (confirmed / unverified rules)
  session.ts       decoder → redactor → provider parser → reducer
  launch.ts        node-pty passthrough (falls back to pipes)
  server.ts        optional browser view (--web) over Server-Sent Events
src/tui/           terminal views
  panel.ts         live panel pinned below the command's output (scroll region)
  render.ts        flow line and end-of-run summary
  explore.ts       full-screen explorer (`unfold show`)
src/providers/
  provider.ts      the interface a provider implements
  vercel/          stage text, launch args, and the output parser
src/ui/            the browser page (plain TypeScript, no framework)
demos/             recorded transcripts (regenerate: node scripts/make-demos.mjs)
```

To add a provider such as `gcloud`, add a `src/providers/gcloud/` folder with stage definitions, a `launch()` function and a parser that turns lines into `Signal`s, then register it in `src/providers/index.ts`. Nothing in `core/` needs to change.

## Tests

```sh
npm test
```

The tests cover the Vercel parser line by line (the current CLI 65 format and the older emoji format), full demo transcripts end to end, the terminal decoder, and redaction. `test/fixtures/fake-vercel.mjs` is a stand-in CLI you can point Unfold at with `UNFOLD_VERCEL_BIN` to exercise the live terminal path without deploying.
