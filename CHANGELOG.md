# Changelog

## 0.2.0 (2026-11-05)

- `unfold gcloud`: Cloud Run deploys (`gcloud run deploy`) as Prepare → Build → Deploy → Live, with build and revision log links, troubleshooting links, and readable errors from gcloud's HTML error pages.
- `unfold claude "<task>"` and `unfold codex "<task>"`: run Claude Code or Codex non-interactively and show Start → Explore → Change → Verify → Done, with files changed, checks run, the final answer and cost or tokens. Verify is only confirmed by a passing check.
- Providers that emit JSON events are shown as readable lines instead of raw JSON; their saved runs replay from recorded events.
- New demos: `gcloud success`, `gcloud deploy-failure`, `claude success`, `codex checks-failing` (`unfold demo <provider> <name>`).
- Summary headlines and labels now come from the provider ("Deployed", "Done", …).

## 0.1.0 (2026-11-05)

First release.

- `unfold vercel`: runs `vercel deploy` with your existing login and project link, and shows a live Prepare → Upload → Build → Preview flow pinned to the bottom of the terminal.
- End-of-run summary with each stage's status and reason, the error, the most likely cause, and URLs.
- Stages are only confirmed when the output proves it; otherwise they are marked unverified with a reason.
- `unfold show`: full-screen terminal explorer for a run (stages, evidence, logs, fix prompt).
- Fix prompts for failed runs, with ready-to-run `claude` and `codex` commands; `--fix claude|codex` starts the agent automatically.
- Optional browser view with `--web`, served on 127.0.0.1 only.
- Secret redaction before anything is shown or saved; runs stored in `~/.unfold/runs` (mode 0600, newest 100 kept).
- Works without node-pty through the system `script` command (macOS and Linux).
- Demos that run without a Vercel account: `unfold demo success|build-failure|interrupted`.
