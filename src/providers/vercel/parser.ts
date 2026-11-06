import type { LogLine, Signal } from '../../core/model.js';
import type { ProviderParser } from '../provider.js';

// Line formats are taken from Vercel CLI 65.x (`vercel deploy --logs`), plus the
// older emoji-prefixed format ("🔍  Inspect: …", "✅  Preview: …") for older CLIs.

type Phase = 'start' | 'prepare' | 'upload' | 'created' | 'build' | 'built' | 'ready';

const BUILD_LOG = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)(?:\s+(.*))?$/;

const INSPECT = /^(?:🔍\s*)?Inspect:?\s+(https?:\/\/\S+)/u;
const DEPLOY_URL = /^(?:[✅🔗▲]\s*)?(Preview|Production):?\s+(https?:\/\/\S+)/u;
const UPLOAD = /^Uploading\s+\[[^\]]*\]\s*\(([^)]+)\)/;
const READY = /^(?:✓\s*)?Ready\b(?:\s+in\s+(\S+))?/u;
const CLI_ERROR = /^(?:Error|❗️?\s*Error|Error!):?\s+(.+)$/u;
const COMMAND_EXITED = /Command "([^"]+)" exited with (\d+)/;

// Build output that is probably the real cause of a failure.
const CAUSE = /(\berror\b|\bERR!|Failed to compile|Type error|SyntaxError|ReferenceError|TypeError|Module not found|Cannot find module|Build failed|ELIFECYCLE|exited with)/i;
// Summary lines that say a build failed without saying why.
const GENERIC_CAUSE = /^(Failed to compile|Build failed|.*worker exited with|.*ELIFECYCLE|npm ERR! (code|errno|Lifecycle|A complete log))/i;
const NOT_CAUSE = /\b0 errors?\b|no errors|error[-_]boundary|errorHandler|\bwarn(ing)?\b/i;

export class VercelParser implements ProviderParser {
  private phase: Phase = 'start';
  private sawUpload = false;
  private buildStarted = false;

  feed(line: LogLine): Signal[] {
    const raw = line.text.trim();
    const m = BUILD_LOG.exec(raw);
    if (m) return this.buildLine((m[2] ?? '').trim(), true);

    // Older CLIs prefix spinner build messages with "Building: ".
    const text = raw.replace(/^Building:\s+/, '');
    const out: Signal[] = [];

    if (this.phase === 'start' || this.phase === 'prepare') {
      const v = /^Vercel CLI (\S+)/.exec(text);
      if (v) {
        this.phase = 'prepare';
        return [
          { kind: 'fact', key: 'cliVersion', label: 'Vercel CLI', value: v[1]!, stage: 'prepare' },
          { kind: 'stage', stage: 'prepare', status: 'active', note: 'The Vercel CLI started.' },
        ];
      }
    }

    // Interactive prompts (linking a project, confirmations).
    if (/^\?\s+\S/.test(text)) {
      return [{ kind: 'evidence', stage: 'prepare', note: 'The CLI asked a question in your terminal.' }];
    }

    const linked = /^(?:🔗\s*)?Linked to (\S+)/u.exec(text);
    if (linked) {
      return [
        { kind: 'fact', key: 'project', label: 'Project', value: linked[1]!.replace(/\s*\(.*$/, ''), stage: 'prepare' },
        { kind: 'evidence', stage: 'prepare', note: 'This folder was linked to a Vercel project.' },
      ];
    }

    if (/^(Retrieving project|Loading scopes|Searching for existing projects)/.test(text) && (this.phase === 'start' || this.phase === 'prepare')) {
      this.phase = 'prepare';
      return [{ kind: 'stage', stage: 'prepare', status: 'active', note: 'Resolving the project.' }];
    }

    const deploying = /^(Deploying|Setting up project)\s*(.*?)\s*$/.exec(text);
    if (deploying && (this.phase === 'start' || this.phase === 'prepare')) {
      this.phase = 'prepare';
      if (deploying[2]) out.push({ kind: 'fact', key: 'project', label: 'Project', value: deploying[2], stage: 'prepare' });
      out.push({ kind: 'stage', stage: 'prepare', status: 'confirmed', note: 'Login checked and project resolved; the deployment request is starting.' });
      return out;
    }

    const up = UPLOAD.exec(text);
    if (up) {
      this.sawUpload = true;
      this.phase = 'upload';
      const [done, total] = up[1]!.split('/');
      const complete = done && total && done.trim() === total.trim();
      return [{ kind: 'stage', stage: 'upload', status: 'active', note: complete ? `Uploaded ${total!.trim()} of new or changed files.` : `Uploading new or changed files: ${up[1]}.` }];
    }

    const inspect = INSPECT.exec(text);
    if (inspect) {
      this.phase = 'created';
      out.push({ kind: 'fact', key: 'inspectUrl', label: 'Inspect', value: inspect[1]!, href: inspect[1]!, stage: 'upload' });
      out.push({ kind: 'stage', stage: 'prepare', status: 'confirmed', note: 'Project resolved and files prepared.' });
      if (this.sawUpload) {
        out.push({ kind: 'stage', stage: 'upload', status: 'confirmed', note: 'Files uploaded and the deployment was created.' });
      } else {
        out.push({
          kind: 'evidence',
          stage: 'upload',
          note: 'The deployment was created, but no upload appeared in the output. Vercel may already have had every file, so the upload itself is not confirmed.',
        });
      }
      return out;
    }

    const dep = DEPLOY_URL.exec(text);
    if (dep) {
      const label = dep[1] === 'Production' ? 'Production URL' : 'Preview URL';
      out.push({ kind: 'fact', key: 'deploymentUrl', label, value: dep[2]!, href: dep[2]!, stage: 'preview' });
      if (dep[1] === 'Production') out.push({ kind: 'fact', key: 'target', label: 'Target', value: 'production', stage: 'preview' });
      if (this.phase === 'built' || this.phase === 'ready' || (this.buildStarted && /\[\d+(\.\d+)?m?s\]$/.test(text))) {
        out.push({ kind: 'stage', stage: 'preview', status: 'confirmed', note: 'The deployment is live at its URL.' });
      } else {
        out.push({ kind: 'evidence', stage: 'preview', note: 'URL reserved. It will not serve your site until the deployment is Ready.' });
      }
      return out;
    }

    const aliased = /^(?:▲\s*)?Aliased\s+(https?:\/\/\S+)/u.exec(text);
    if (aliased) {
      return [
        { kind: 'fact', key: 'alias', label: 'Aliased', value: aliased[1]!, href: aliased[1]!, stage: 'preview' },
        { kind: 'evidence', stage: 'preview', note: 'A domain was pointed at this deployment.' },
      ];
    }

    if (/^Queued/.test(text)) {
      this.phase = 'build';
      return [{ kind: 'stage', stage: 'build', status: 'active', note: 'Waiting in the queue for a build machine.' }];
    }
    if (/^Building…?\.{0,3}$/.test(text)) {
      this.phase = 'build';
      this.buildStarted = true;
      return [{ kind: 'stage', stage: 'build', status: 'active', note: 'Building on Vercel.' }];
    }

    if (/^(Running Checks|Completing)/.test(text)) {
      this.phase = 'built';
      return [
        { kind: 'stage', stage: 'build', status: 'confirmed', note: 'Vercel reported the build finished.' },
        { kind: 'stage', stage: 'preview', status: 'active', note: /^Running Checks/.test(text) ? 'Waiting for deployment checks.' : 'Finishing the deployment.' },
      ];
    }

    const ready = READY.exec(text);
    if (ready && this.phase !== 'start' && this.phase !== 'prepare') {
      this.phase = 'ready';
      if (ready[1]) out.push({ kind: 'fact', key: 'duration', label: 'Total time', value: ready[1], stage: 'preview' });
      out.push({ kind: 'stage', stage: 'build', status: 'confirmed', note: 'The build finished.' });
      out.push({ kind: 'stage', stage: 'preview', status: 'confirmed', note: 'Vercel reports the deployment is Ready.' });
      return out;
    }

    if (/Deployment Protection is on/.test(text)) {
      return [
        { kind: 'fact', key: 'protection', label: 'Deployment Protection', value: 'On', stage: 'preview' },
        { kind: 'evidence', stage: 'preview', note: 'Visitors may need to sign in to Vercel to view this URL.' },
      ];
    }

    const err = CLI_ERROR.exec(text);
    if (err) {
      const stage = this.stageForError();
      const exited = COMMAND_EXITED.exec(text);
      if (exited) out.push({ kind: 'fact', key: 'failedCommand', label: 'Failed command', value: `${exited[1]} (exit ${exited[2]})`, stage: 'build' });
      out.push({ kind: 'error', severity: 'fatal', stage, message: err[1]! });
      return out;
    }

    // Non-interactive mode reports errors as a JSON object on one line.
    if (text.startsWith('{') && /"status"\s*:\s*"error"/.test(text)) {
      let message = text;
      try {
        const j = JSON.parse(text) as { reason?: string; message?: string; hint?: string };
        message = [j.message ?? j.reason, j.hint].filter(Boolean).join(' ') || text;
      } catch {
        // keep raw text
      }
      return [{ kind: 'error', severity: 'fatal', stage: this.stageForError(), message }];
    }

    if (/^Uploading failed|too_many_files|missing_files/.test(text)) {
      return [{ kind: 'error', severity: 'fatal', stage: 'upload', message: text }];
    }

    // After the deployment exists, unprefixed spinner lines are the latest build log line.
    if (this.phase === 'created' || this.phase === 'build') return this.buildLine(text, false);
    return out;
  }

  private stageForError(): string {
    switch (this.phase) {
      case 'start':
      case 'prepare':
        return 'prepare';
      case 'upload':
        return 'upload';
      case 'created':
      case 'build':
        return 'build';
      default:
        return 'preview';
    }
  }

  private buildLine(text: string, timestamped: boolean): Signal[] {
    if (text === '') return [];
    const out: Signal[] = [];
    if (this.phase !== 'built' && this.phase !== 'ready') {
      if (!this.buildStarted) out.push({ kind: 'stage', stage: 'build', status: 'active', note: timestamped ? 'Build logs are streaming from Vercel.' : 'Building on Vercel.' });
      this.buildStarted = true;
      this.phase = 'build';
    }

    let r: RegExpExecArray | null;
    if ((r = /Running build in (.+)$/.exec(text))) {
      out.push({ kind: 'fact', key: 'region', label: 'Build region', value: r[1]!, stage: 'build' });
      out.push({ kind: 'evidence', stage: 'build', note: 'A build machine picked up the deployment.' });
    } else if ((r = /Build machine configuration: (.+)$/.exec(text))) {
      out.push({ kind: 'fact', key: 'machine', label: 'Build machine', value: r[1]!, stage: 'build' });
    } else if (/(Downloading \d+ deployment files|Retrieving list of deployment files|Cloning )/.test(text)) {
      out.push({ kind: 'evidence', stage: 'build', note: 'The build machine fetched your files.' });
    } else if (/Restored build cache|Build cache/.test(text) && !/Creat|Upload/.test(text)) {
      out.push({ kind: 'evidence', stage: 'build', note: 'A previous build cache was restored.' });
    } else if ((r = /^Running "(?!vercel build)(.+)"$/.exec(text))) {
      out.push({ kind: 'fact', key: 'buildCommand', label: 'Build command', value: r[1]!, stage: 'build' });
      out.push({ kind: 'evidence', stage: 'build', note: 'Your build command started.' });
    } else if (/(Installing dependencies|added \d+ packages|up to date, audited|Lockfile|packages are looking for funding)/.test(text) && /Installing|added/.test(text)) {
      out.push({ kind: 'evidence', stage: 'build', note: 'Dependencies were installed.' });
    } else if ((r = /Detected (.+?) version:? (\S+)/.exec(text))) {
      out.push({ kind: 'fact', key: 'framework', label: 'Framework', value: `${r[1]} ${r[2]}`, stage: 'build' });
    } else if ((r = /Build Completed in (\S+)(?:\s*\[(.+)\])?/.exec(text))) {
      this.phase = 'built';
      out.push({ kind: 'stage', stage: 'build', status: 'confirmed', note: r[2] ? `Build completed in ${r[2]}.` : 'Build completed.' });
    } else if (/Deploying outputs/.test(text)) {
      if (this.phase !== 'ready') this.phase = 'built';
      out.push({ kind: 'stage', stage: 'preview', status: 'active', note: 'Build output is being deployed to Vercel’s network.' });
    } else if (/^Deployment completed/.test(text)) {
      out.push({ kind: 'evidence', stage: 'preview', note: 'Build output was deployed.' });
    }

    const exited = COMMAND_EXITED.exec(text);
    if (exited) {
      out.push({ kind: 'fact', key: 'failedCommand', label: 'Failed command', value: `${exited[1]} (exit ${exited[2]})`, stage: 'build' });
      out.push({ kind: 'error', severity: 'cause', stage: 'build', message: text.replace(/^Error:\s*/, ''), priority: 0 });
    } else if (CAUSE.test(text) && !NOT_CAUSE.test(text)) {
      out.push({ kind: 'error', severity: 'cause', stage: 'build', message: text.replace(/^Error:\s*/, ''), priority: GENERIC_CAUSE.test(text) ? 1 : 2 });
    }
    return out;
  }
}

/** Test helper: run lines through a fresh parser. */
export function parseLines(lines: string[]): Signal[][] {
  const p = new VercelParser();
  return lines.map((text, i) => p.feed({ seq: i + 1, at: i, text }));
}

