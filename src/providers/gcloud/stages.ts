import type { ProviderNotes, StageDefinition } from '../../core/model.js';

// General explanations of `gcloud run deploy`. Nothing here is evidence from a run.
export const GCLOUD_STAGES: StageDefinition[] = [
  {
    id: 'prepare',
    title: 'Prepare',
    summary: 'gcloud works out which project, region and service to deploy to.',
    explanation: [
      'gcloud uses the account you logged in with (`gcloud auth login`) and your configured project and region. Anything missing, such as the service name or region, it asks for in the terminal.',
      'With `--source`, it also decides how to build: from your Dockerfile if there is one, otherwise with Google Cloud buildpacks.',
    ],
    confirmedBy: 'The "Deploying … to Cloud Run service [name] in project [id] region [region]" line, printed once the target is resolved.',
    docsUrl: 'https://cloud.google.com/sdk/gcloud/reference/run/deploy',
  },
  {
    id: 'build',
    title: 'Build',
    summary: 'Your source is uploaded and built into a container image by Cloud Build.',
    explanation: [
      'For source deploys, gcloud uploads your code and Cloud Build turns it into a container image, stored in Artifact Registry. The build runs on Google Cloud, not on your machine; the full log is in the Cloud Build link.',
      'If you deploy a prebuilt image with `--image`, there is nothing to build and this stage is skipped.',
    ],
    confirmedBy: 'A "✓ Building Container..." step.',
    docsUrl: 'https://cloud.google.com/run/docs/deploying-source-code',
  },
  {
    id: 'deploy',
    title: 'Deploy',
    summary: 'Cloud Run creates a new revision from the image and starts it.',
    explanation: [
      'Each deploy creates an immutable revision. Cloud Run starts a container from the image and waits for it to listen on the port in the PORT environment variable (8080 by default). A container that crashes or listens on the wrong port fails here.',
      'Once the revision is healthy, traffic is routed to it, and with `--allow-unauthenticated` the public access policy is set.',
    ],
    confirmedBy: 'A "✓ Creating Revision..." step, followed by "✓ Routing traffic...".',
    docsUrl: 'https://cloud.google.com/run/docs/troubleshooting',
  },
  {
    id: 'live',
    title: 'Live',
    summary: 'The new revision serves traffic at the service URL.',
    explanation: [
      'When the deploy finishes, the new revision receives its share of traffic (normally 100 percent) at the service URL. Older revisions stay available for rollback.',
      'Whether anyone on the internet can open the URL depends on the service’s authentication setting.',
    ],
    confirmedBy: 'The "Service [name] revision [id] has been deployed and is serving … percent of traffic." message.',
    docsUrl: 'https://cloud.google.com/run/docs/managing/revisions',
  },
];

export const GCLOUD_NOTES: ProviderNotes = {
  success: 'Deployed',
  successHeadline: 'Service is live',
  docsLabel: 'Cloud Run docs',
  highlights: ['revision', 'troubleshooting'],
  interrupted:
    'You pressed Ctrl+C while this stage was in progress. That stops gcloud, but Cloud Build or Cloud Run may finish the operation anyway. Check the Cloud Console.',
  unverified: "This run's output never confirmed this stage, so Unfold does not claim it happened.",
};
