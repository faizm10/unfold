import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from '../provider.js';
import { VercelParser } from './parser.js';
import { VERCEL_NOTES, VERCEL_STAGES } from './stages.js';

const SUBCOMMANDS = new Set(['deploy']);

export const vercel: Provider = {
  id: 'vercel',
  title: 'Vercel preview deploy',
  stages: VERCEL_STAGES,
  notes: VERCEL_NOTES,

  launch(userArgs) {
    const args = [...userArgs];
    if (!SUBCOMMANDS.has(args[0] ?? '')) args.unshift('deploy');
    // Ask the CLI to stream build logs so the Build stage has real evidence.
    if (!args.includes('--logs') && !args.includes('--no-wait') && !args.includes('--json')) args.push('--logs');
    return { bin: process.env.UNFOLD_VERCEL_BIN || 'vercel', args };
  },

  preflight(cwd) {
    const msgs: string[] = [];
    if (!existsSync(join(cwd, '.vercel', 'project.json')) && !existsSync(join(cwd, '.vercel', 'repo.json'))) {
      msgs.push('This folder is not linked to a Vercel project yet; the Vercel CLI will ask you to link it in this terminal.');
    }
    return msgs;
  },

  createParser: () => new VercelParser(),

  fixHints(state) {
    const fact = (k: string) => state.facts.find((f) => f.key === k)?.value;
    switch (state.failedStage) {
      case 'prepare':
        return [
          'This failed before any files were sent to Vercel. Login, team scope and project-link problems are fixed with `vercel login` or `vercel link`, not code changes. If that is the cause, say so and stop.',
          'Check `.vercel/project.json` and `vercel.json` (or `vercel.ts`) for invalid configuration.',
        ];
      case 'upload':
        return [
          'This failed while sending files to Vercel. Too many or too large files usually means something should be in `.vercelignore` (build output, caches, large assets).',
          '`vercel deploy --archive=tgz` uploads a single archive and avoids upload limits.',
        ];
      case 'build':
        return [
          `The build ran on Vercel's machines, not locally. Reproduce it with \`${fact('buildCommand') ?? 'the build command'}\` (or \`vercel build\`) before and after the fix.`,
          'Vercel builds use the environment variables set on the Vercel project for the Preview environment, not local `.env` files. A missing or different variable is a common reason a build passes locally and fails on Vercel; `vercel env ls` lists them.',
          'Check the Node.js version (`engines.node` in package.json) and that the lockfile is committed and up to date.',
        ];
      case 'preview':
        return [
          'The build finished but the deployment did not become Ready. This is often deployment checks, domain/alias assignment or project settings rather than application code.',
        ];
      default:
        return [];
    }
  },
};
