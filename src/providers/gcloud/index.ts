import type { Provider } from '../provider.js';
import { GcloudParser } from './parser.js';
import { GCLOUD_NOTES, GCLOUD_STAGES } from './stages.js';

export const gcloud: Provider = {
  id: 'gcloud',
  title: 'Cloud Run deploy',
  stages: GCLOUD_STAGES,
  notes: GCLOUD_NOTES,
  install: 'Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install), then run `gcloud auth login`.',

  launch(userArgs) {
    const args = [...userArgs];
    // `unfold gcloud …` means `gcloud run deploy …`; accept the full form too.
    if (args[0] === 'run' && args[1] === 'deploy') args.splice(0, 2);
    return { bin: process.env.UNFOLD_GCLOUD_BIN || 'gcloud', args: ['run', 'deploy', ...args] };
  },

  createParser: () => new GcloudParser(),

  fixHints(state) {
    const fact = (k: string) => state.facts.find((f) => f.key === k)?.value;
    switch (state.failedStage) {
      case 'prepare':
        return [
          'This failed before anything was built. Account, project, billing and disabled-API problems are fixed with gcloud commands, not code: `gcloud auth login`, `gcloud config set project <id>`, and `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com`. If that is the cause, say so and stop.',
        ];
      case 'build':
        return [
          `The container was built by Cloud Build, not locally.${fact('logsUrl') ? ` The full build log is at ${fact('logsUrl')}.` : ''}`,
          `It was built with ${fact('buildType') ?? 'a Dockerfile or buildpacks'}. Reproduce it locally with \`docker build .\` (Dockerfile) or \`pack build\` (buildpacks) before and after the fix.`,
          'For buildpacks, check that the project declares how to start (for example a `start` script in package.json, or a Procfile).',
        ];
      case 'deploy':
        return [
          'The image built, but the new revision did not become healthy. The most common cause: the container must listen on 0.0.0.0 at the port in the PORT environment variable (8080 by default).',
          `Check start-up errors with \`gcloud run services logs read ${fact('service') ?? '<service>'}${fact('region') ? ` --region ${fact('region')}` : ''}\`. Crashes on start, missing environment variables and memory limits show up there.`,
        ];
      default:
        return [];
    }
  },
};
