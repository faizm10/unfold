import type { ProviderNotes, StageDefinition } from '../../core/model.js';

// General explanations. Nothing here is evidence from a run.
export const VERCEL_STAGES: StageDefinition[] = [
  {
    id: 'prepare',
    title: 'Prepare',
    summary: 'The CLI works out who you are, which project this folder belongs to, and which files to send.',
    explanation: [
      'The Vercel CLI uses the login saved on your machine and the link in .vercel/project.json. If the folder is not linked yet, it asks you a few questions in the terminal and creates that link.',
      'It then lists the files to deploy (skipping anything in .vercelignore) and computes a fingerprint (SHA) of each one. Those fingerprints let Vercel skip files it already has.',
    ],
    confirmedBy: 'A "Deploying <team>/<project>" line, which the CLI prints only after your login has been checked and the project resolved.',
    docsUrl: 'https://vercel.com/docs/cli/deploy',
  },
  {
    id: 'upload',
    title: 'Upload',
    summary: 'Files Vercel does not already have are sent to Vercel, then a deployment is created.',
    explanation: [
      'Only files whose fingerprint Vercel has not seen before are uploaded, so a small change usually means a small upload. If nothing changed, there may be no visible upload at all.',
      'Once Vercel has every file, the CLI creates the deployment and gets back an Inspect URL (the deployment page in the dashboard) and the URL the preview will live at.',
    ],
    confirmedBy: 'An "Uploading [...]" progress line followed by the Inspect URL, which only appears once the deployment has been created.',
    docsUrl: 'https://vercel.com/docs/deployments/overview',
  },
  {
    id: 'build',
    title: 'Build',
    summary: 'Vercel builds your project on its own machines, not on your laptop.',
    explanation: [
      'The deployment waits in a queue for a build machine. That machine downloads your files, restores the build cache if there is one, installs dependencies and runs your build command (for example npm run build).',
      'The build uses the environment variables configured in the Vercel project for the Preview environment, not the .env files on your machine. This is a common reason a build passes locally but fails here.',
    ],
    confirmedBy: '"Build Completed" in the build logs, or the CLI reporting the deployment Ready.',
    docsUrl: 'https://vercel.com/docs/deployments/builds',
  },
  {
    id: 'preview',
    title: 'Preview',
    summary: 'The build output is put behind its own unique URL that you can open and share.',
    explanation: [
      'Each preview deployment gets an immutable URL. The CLI prints that URL early, but it only serves your site once the deployment is Ready.',
      'Preview deployments never change your production domain. Many teams keep Deployment Protection on, so visitors may need to sign in to Vercel to see it.',
    ],
    confirmedBy: 'The CLI printing "Ready", meaning Vercel reports the deployment as live at its URL.',
    docsUrl: 'https://vercel.com/docs/deployments/environments#preview-environment-pre-production',
  },
];

export const VERCEL_NOTES: ProviderNotes = {
  interrupted:
    'You pressed Ctrl+C while this stage was in progress. That stops the CLI, but if the deployment had already been created, Vercel may keep building it. Check the Inspect URL.',
  unverified: "This run's output never confirmed this stage, so Unfold does not claim it happened.",
};
