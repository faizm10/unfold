import type { LogLine, Signal } from '../../core/model.js';
import type { ProviderParser } from '../provider.js';

// Line formats from Google Cloud SDK 591 (`gcloud run deploy`): the start message from
// command_lib/run/messages_util.py, step labels from command_lib/run/stages.py, and
// tick marks from core/console (✓ / OK done, X failed, - interrupted, . not started).

type Phase = 'start' | 'prepare' | 'build' | 'deploy' | 'live';

const START = /^(?:(Building using (\S+) and deploying)|Deploying(?: new)?)\s+(?:container|sources|locally-built source)?\s*to Cloud Run (service|job|worker pool) \[(.+?)\] in project \[(.+?)\](?: region \[(.+?)\])?/;
const STEP = /^(✓|OK|X|-|\.)?\s*(Creating Container Repository|Validating configuration|Uploading sources|Building Container|Creating Revision(?: in region: \S+)?|Routing traffic|Splitting instances|Setting IAM Policy|Enabling IAP)(?:\.\.\.)?\s*(.*)$/u;
const SERVED = /Service \[(.+?)\] revision \[(.+?)\] has been deployed and is serving (\d+) percent of traffic/;
const ERROR = /^ERROR: \((gcloud[\w.-]*)\) (.+)$/;
const PROMPT = /\((?:y\/N|Y\/n)\)\??\s*$|^Please (?:specify|enter)|^Service name|^Source code location|^Do you want to continue/;
const LOGS = /Logs are available at \[\s*(https?:\/\/\S+?)\s*\]/;
const CAUSE = /failed to start|listen on the port|PORT=\d+|HealthCheckContainerError|Container import failed|exited with|\berror\b|failed|denied|not found|quota/i;

const STEP_STAGE: Record<string, 'prepare' | 'build' | 'deploy'> = {
  'Creating Container Repository': 'prepare',
  'Validating configuration': 'prepare',
  'Uploading sources': 'build',
  'Building Container': 'build',
  'Creating Revision': 'deploy',
  'Routing traffic': 'deploy',
  'Splitting instances': 'deploy',
  'Setting IAM Policy': 'deploy',
  'Enabling IAP': 'deploy',
};

export class GcloudParser implements ProviderParser {
  private phase: Phase = 'start';
  /** gcloud sometimes prints an HTML error page after "ERROR: … HTTPError". */
  private inHtmlError = false;
  private sawBuild = false;
  private prebuiltImage = false;

  feed(line: LogLine): Signal[] {
    const text = line.text.trim();
    if (!text) return [];
    let m: RegExpExecArray | null;

    if ((m = START.exec(text))) {
      this.phase = 'prepare';
      this.prebuiltImage = !m[1] && /container to/.test(text);
      const out: Signal[] = [
        { kind: 'fact', key: 'service', label: 'Service', value: m[4]!, stage: 'prepare' },
        { kind: 'fact', key: 'project', label: 'Project', value: m[5]!, stage: 'prepare' },
        { kind: 'stage', stage: 'prepare', status: 'confirmed', note: `Deploying ${m[3]} ${m[4]} in project ${m[5]}${m[6] ? `, region ${m[6]}` : ''}.` },
      ];
      if (m[6]) out.push({ kind: 'fact', key: 'region', label: 'Region', value: m[6], stage: 'prepare' });
      if (m[2]) out.push({ kind: 'fact', key: 'buildType', label: 'Build with', value: m[2], stage: 'build' });
      if (this.prebuiltImage)
        out.push({ kind: 'evidence', stage: 'build', note: 'Deploying a prebuilt container image, so there is nothing to build.' });
      return out;
    }

    if (PROMPT.test(text)) return [{ kind: 'evidence', stage: 'prepare', note: 'gcloud asked a question in your terminal.' }];

    if ((m = STEP.exec(text))) {
      const label = m[2]!.replace(/ in region: .*/, '');
      const stage = STEP_STAGE[label]!;
      const mark = m[1];
      const rest = m[3] ?? '';
      const out: Signal[] = [];
      const logs = LOGS.exec(rest);
      if (logs) out.push({ kind: 'fact', key: 'logsUrl', label: 'Build logs', value: logs[1]!, href: logs[1]!, stage: 'build' });
      if (stage === 'build') this.sawBuild = true;
      if (stage !== 'prepare' && this.rank(stage) > this.rank(this.phase)) this.phase = stage;

      if (mark === '✓' || mark === 'OK') {
        // A finished build step only confirms the stage once the container is built;
        // a finished revision step only once traffic is routed (or the IAM policy set).
        if (label === 'Building Container' || label === 'Routing traffic' || label === 'Splitting instances')
          out.push({ kind: 'stage', stage, status: 'confirmed', note: `${label} finished.` });
        else out.push({ kind: 'evidence', stage, note: `${label} finished.` });
      } else if (mark === 'X') {
        out.push({ kind: 'stage', stage, status: 'failed', note: `${label} failed.${rest && !logs ? ` ${rest}` : ''}` });
        if (rest && !logs) out.push({ kind: 'error', severity: 'cause', stage, message: rest, priority: 2 });
      } else if (mark === '-') {
        out.push({ kind: 'evidence', stage, note: `${label} was interrupted.` });
      } else if (mark !== '.') {
        out.push({ kind: 'stage', stage, status: 'active', note: `${label}…` });
      }
      return out;
    }

    if ((m = SERVED.exec(text))) {
      this.phase = 'live';
      const percent = Number(m[3]);
      return [
        { kind: 'fact', key: 'revision', label: 'Revision', value: m[2]!, stage: 'deploy' },
        { kind: 'fact', key: 'traffic', label: 'Traffic', value: `${percent}%`, stage: 'live' },
        { kind: 'stage', stage: 'deploy', status: 'confirmed', note: `Revision ${m[2]} is ready.` },
        percent > 0
          ? { kind: 'stage', stage: 'live', status: 'confirmed', note: `Serving ${percent} percent of traffic.` }
          : { kind: 'stage', stage: 'live', status: 'unverified', note: 'The revision is deployed but receives no traffic (deployed with --no-traffic).' },
      ];
    }

    if ((m = /^For more troubleshooting guidance, see (https?:\/\/\S+)/.exec(text))) {
      return [{ kind: 'fact', key: 'troubleshooting', label: 'Troubleshooting', value: m[1]!, href: m[1]!, stage: this.currentStage() }];
    }

    if ((m = /^Logs URL:\s*(https?:\/\/\S+)/.exec(text))) {
      return [{ kind: 'fact', key: 'logsUrl', label: 'Logs', value: m[1]!, href: m[1]!, stage: this.currentStage() }];
    }

    if ((m = /^Service URL:\s*(https?:\/\/\S+)/.exec(text))) {
      return [{ kind: 'fact', key: 'deploymentUrl', label: 'Service URL', value: m[1]!, href: m[1]!, stage: 'live' }];
    }

    if ((m = ERROR.exec(text))) {
      const html = /<!DOCTYPE|<html/i.test(m[2]!);
      this.inHtmlError = html;
      const message = html ? m[2]!.replace(/<!DOCTYPE[\s\S]*$|<html[\s\S]*$/i, '').replace(/:\s*$/, '').trim() : m[2]!;
      return [{ kind: 'error', severity: 'fatal', stage: this.stageForError(message), message }];
    }

    if (this.inHtmlError) {
      // Keep only the readable sentences of the error page, e.g. "The requested URL … was not found".
      if (/<\/html>/i.test(text)) this.inHtmlError = false;
      if (/<title>|<style|<meta/i.test(text)) return [];
      const plain = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/That[’']s (all we know|an error)\.?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (/[a-z]{3,} [a-z]{3,}/i.test(plain) && !/[{}]|^[\w-]+:/.test(plain)) {
        return [{ kind: 'error', severity: 'cause', stage: this.currentStage(), message: plain, priority: 3 }];
      }
      return [];
    }

    if (/^(Deployment failed|Failed\.|Local build failed)/.test(text)) {
      return [{ kind: 'evidence', stage: this.currentStage(), note: 'gcloud reported the deployment failed.' }];
    }

    // Revision start-up and build errors printed as plain lines.
    if (this.phase !== 'start' && CAUSE.test(text) && !/^(Done|OK)\b/.test(text)) {
      return [{ kind: 'error', severity: 'cause', stage: this.currentStage(), message: text, priority: /failed to start|listen on the port|PORT=/.test(text) ? 3 : 1 }];
    }
    return [];
  }

  private rank(p: Phase): number {
    return ['start', 'prepare', 'build', 'deploy', 'live'].indexOf(p);
  }

  private currentStage(): string {
    return this.phase === 'start' ? 'prepare' : this.phase;
  }

  private stageForError(message: string): string {
    if (/build/i.test(message) && !/revision/i.test(message)) return 'build';
    if (/revision|container failed|failed to start|PORT|health ?check/i.test(message)) return 'deploy';
    if (/permission|denied|not authenticated|auth|project|api .*(not|has not) been (used|enabled)|billing/i.test(message) && this.phase !== 'deploy')
      return this.phase === 'build' ? 'build' : 'prepare';
    return this.currentStage();
  }
}
