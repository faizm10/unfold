import { runDemo, DEMO_NAMES } from './commands/demo.js';
import { DEFAULT_FLAGS, type UiFlags } from './commands/observe.js';
import { listRuns, runReplay } from './commands/replay.js';
import { runLive } from './commands/run.js';
import { runShow } from './commands/show.js';
import { providers } from './providers/index.js';

const HELP = `unfold — Watch what happens after you hit Enter.

Usage
  unfold vercel [vercel deploy flags]   Run a Vercel preview deploy with a live flow in your terminal
  unfold show [run]                      Explore a run in the terminal (defaults to the latest)
  unfold demo <name>                     Play a recorded demo (${DEMO_NAMES.join(', ')})
  unfold replay [run]                    Play a saved run again
  unfold runs                            List saved runs

Unfold options (anywhere on the line)
  --fix <agent>  If the run fails, start "claude" or "codex" with the fix prompt
                 (a fix prompt is always saved on failure; this only launches the agent)
  --web          Also show the flow in a local browser page (off by default)
  --no-open      With --web: don't open the browser automatically
  --once         With --web: exit when the run ends instead of keeping the page served
  --port <n>     With --web: port for the page (default 4317)
  --no-panel     Don't pin the live flow panel to the bottom of the terminal
  --speed <n>    Playback speed for demo/replay (default 1)

Examples
  unfold vercel
  unfold vercel --fix claude
  unfold show
  unfold demo build-failure
`;

/** Pulls Unfold's own flags out of argv; everything else goes to the wrapped CLI. */
export function parseArgs(argv: string[]): { rest: string[]; flags: UiFlags; speed: number } {
  const rest: string[] = [];
  const flags: UiFlags = { ...DEFAULT_FLAGS };
  let speed = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--web') flags.web = true;
    else if (a === '--no-open') flags.open = false;
    else if (a === '--once') flags.once = true;
    else if (a === '--no-panel') flags.panel = false;
    else if (a === '--port') flags.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) flags.port = Number(a.slice(7));
    else if (a === '--fix' || a.startsWith('--fix=')) {
      const v = a === '--fix' ? argv[++i] : a.slice(6);
      if (v !== 'claude' && v !== 'codex') throw new Error(`--fix expects "claude" or "codex", got "${v ?? ''}"`);
      flags.fix = v;
    } else if (a === '--speed') speed = Number(argv[++i]) || 1;
    else if (a.startsWith('--speed=')) speed = Number(a.slice(8)) || 1;
    else rest.push(a);
  }
  return { rest, flags, speed };
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...tail] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const provider = providers[cmd];
  if (provider) {
    // Only strip Unfold flags; the wrapped CLI receives everything else verbatim.
    const { rest, flags } = parseArgs(tail);
    return runLive(provider, rest, flags);
  }
  const { rest, flags, speed } = parseArgs(tail);
  switch (cmd) {
    case 'show':
      return runShow(rest[0], flags);
    case 'demo':
      return runDemo(rest[0] ?? 'success', flags, speed);
    case 'replay':
      return runReplay(rest[0], flags, speed);
    case 'runs':
      for (const r of listRuns()) process.stdout.write(r + '\n');
      return 0;
    default:
      process.stderr.write(`Unknown command "${cmd}".\n\n${HELP}`);
      return 2;
  }
}
