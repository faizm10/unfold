import { launch, which } from '../core/launch.js';
import { redactArgs } from '../core/redact.js';
import type { Provider } from '../providers/provider.js';
import { observe, say, type UiFlags } from './observe.js';

export async function runLive(provider: Provider, userArgs: string[], flags: UiFlags): Promise<number> {
  const cwd = process.cwd();
  const spec = provider.launch(userArgs);
  const bin = which(spec.bin);
  if (!bin) {
    say(`Could not find "${spec.bin}" on your PATH.${provider.install ? ` ${provider.install}` : ''}`);
    return 127;
  }
  for (const msg of provider.preflight?.(cwd) ?? []) say(msg);
  say(`Running: ${[spec.bin, ...redactArgs(spec.args)].join(' ')}`);

  return observe({
    provider,
    command: [spec.bin, ...redactArgs(spec.args)],
    cwd,
    mode: 'live',
    flags,
    save: true,
    run: (session, term) => launch({ bin, args: spec.args, cwd, term, onOutput: (d) => session.write(d) }),
  });
}
