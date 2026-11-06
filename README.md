# Unfold

**Watch what happens after you hit Enter.**

Unfold wraps a CLI command and shows what it's doing as a flow, right in your terminal. The command's own output and prompts work exactly as before, and a small panel pinned to the bottom of the terminal tracks each stage as it happens.

| Command | Wraps | Flow |
| --- | --- | --- |
| `unfold vercel` | `vercel deploy` | Prepare → Upload → Build → Preview |
| `unfold gcloud` | `gcloud run deploy` (Cloud Run) | Prepare → Build → Deploy → Live |
| `unfold claude "<task>"` | Claude Code, non-interactive | Start → Explore → Change → Verify → Done |
| `unfold codex "<task>"` | Codex CLI, non-interactive | Start → Explore → Change → Verify → Done |

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

## Install

Requires Node.js 20 or later, on macOS or Linux. Windows should work but hasn't been tested yet.

```sh
npm install -g unfold-deploy
```

The package is `unfold-deploy`; the command is `unfold`. To try it without installing, prefix commands with `npx unfold-deploy` (for example `npx unfold-deploy demo success`).

## Try it without an account

The demos play recorded terminal output through the same pipeline a real run uses:

```sh
unfold demo success                  # Vercel: a preview deploy that succeeds
unfold demo build-failure            # Vercel: the build fails on a TypeScript error
unfold demo interrupted              # Vercel: Ctrl+C while building
unfold demo gcloud success           # Cloud Run: a source deploy that goes live
unfold demo gcloud deploy-failure    # Cloud Run: the container never listens on $PORT
unfold demo claude success           # Claude Code fixes a failing test and confirms it
unfold demo codex checks-failing     # Codex finishes, but the tests still fail
unfold show                          # explore the run you just watched
```

Add `--speed 2` to play faster. Press Ctrl+C during any demo to see the interrupted state.

## Run a real preview deploy

You need the Vercel CLI (`npm i -g vercel`) and `vercel login`. Then, from your app's folder (the one with its `package.json`):

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

## Deploy to Cloud Run

You need the Google Cloud CLI, logged in (`gcloud auth login`) with a project set. From your service's folder:

```sh
unfold gcloud --source . --region us-central1      # runs: gcloud run deploy --source . --region us-central1
unfold gcloud my-api --image us-docker.pkg.dev/…   # prebuilt image: no Build stage
```

Everything after `unfold gcloud` goes to `gcloud run deploy`, and its questions (service name, region, unauthenticated access) still appear in your terminal. On failure the summary shows the error, the Cloud Build or revision logs link, and the troubleshooting link gcloud printed. HTML error pages gcloud sometimes prints are reduced to their readable sentence.

## Watch a coding agent: Claude Code and Codex

Unfold runs the agent in its non-interactive mode, which reports every step as a structured event, and shows it as a flow: what it read (**Explore**), which files it edited (**Change**), whether checks such as `npm test` or `tsc` passed (**Verify**), and its final answer (**Done**). The summary lists the files changed, the answer, and the cost or token use.

```sh
unfold claude "fix the failing test" --allowedTools Read Edit "Bash(npm test)"
unfold claude "add input validation to the signup form" --permission-mode acceptEdits
unfold codex "fix the failing test" --sandbox workspace-write
```

- Non-interactive agents can't stop to ask for permission. Give Claude Code the tools it needs with `--allowedTools` or `--permission-mode acceptEdits`; give Codex write access with `--sandbox workspace-write`. Denied tools are listed in the summary.
- **Verify is only confirmed when a check passes.** If the agent never runs one, or the last one failed, Verify stays `?` with the reason, even when the agent says it's done.
- Edits go straight to your working tree. Review them with `git diff`.

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

Try it without an account: `unfold demo build-failure`.

## Privacy

- **Everything stays local.** By default nothing is served at all. With `--web` the page is served on `127.0.0.1` only, and requests for any other host name are rejected. Unfold sends no telemetry.
- **Secrets are redacted** before any output is shown on the page or saved to disk. This covers tokens, keys, JWTs, `user:password@` in URLs, `KEY=value` pairs with secret-looking names, private key blocks, and `--token` / `--env` flag values. Values of secret-looking environment variables are also matched, in memory only.
- **The environment is never recorded.** The Vercel CLI inherits it so that your login works, and Unfold doesn't save it.
- **Saved runs are private to you.** They're written to `~/.unfold/runs/*.jsonl` with mode `0600`, outside your project, so they can't be committed by accident. The newest 100 runs are kept (`UNFOLD_KEEP_RUNS` changes this). Set `UNFOLD_HOME` to store them elsewhere.
- Your own terminal shows the CLI's unredacted output, the same as it would without Unfold.

## Troubleshooting

- **"Could not find vercel / gcloud / claude / codex on your PATH"**: install that CLI and log in to it first; Unfold prints the install command.
- **Agent stopped without changing anything**: it probably wasn't allowed to. Check "Permission denied" in the summary and allow the tool (see above).
- **Stuck at a Vercel question**: Unfold passes your keystrokes straight to the Vercel CLI, so answer it as usual. In scripts, pass `--yes` and `--scope <team>`.
- **"Unfold didn't recognize any of this output"**: your Vercel CLI may print a format Unfold doesn't know yet. The deploy itself is unaffected. Please open an issue and include your `vercel --version`.
- **No live panel**: the panel needs a terminal at least 50×12 and the `node-pty` package. On Linux without build tools, node-pty may not install; Unfold then runs the CLI through the system `script` command, prints only the summary, and keeps prompts working. `UNFOLD_TERMINAL=script` or `UNFOLD_TERMINAL=pipe` forces a fallback, and `--no-panel` turns the panel off.
- **Terminal looks wrong after a crash**: run `reset`. Unfold restores the terminal on normal exits, Ctrl+C and crashes, so please report the crash.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, and how to add a provider such as `gcloud`.

## License

MIT
