// Redacts secrets from captured output before it is displayed or saved.
// Pattern based, plus exact values of secret-looking environment variables.
// Env values are only held in memory for matching; they are never stored.

const R = '[REDACTED]';

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|COOKIE|SESSION|DSN|DATABASE_URL|CONNECTION_STRING|WEBHOOK|SIGNING)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic style
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bnpm_[A-Za-z0-9]{36}\b/g, // npm
  /\b(?:vcp|vck|vci|vca|vcr)_[A-Za-z0-9]{20,}\b/g, // Vercel-style prefixed tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
];

const KEY_VALUE = new RegExp(
  String.raw`\b([A-Za-z0-9_.-]*` + SECRET_NAME.source.replace(/^\(/, '(?:') + String.raw`[A-Za-z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"']{3,})\3`,
  'gi',
);

export interface RedactorOptions {
  /** Environment to harvest secret-looking values from (in memory only). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export class Redactor {
  private readonly envSecrets: { name: string; value: string }[] = [];
  private inPrivateKey = false;

  constructor(opts: RedactorOptions = {}) {
    for (const [name, value] of Object.entries(opts.env ?? {})) {
      if (value && value.length >= 8 && SECRET_NAME.test(name)) this.envSecrets.push({ name, value });
    }
    // Longest first so overlapping values are fully replaced.
    this.envSecrets.sort((a, b) => b.value.length - a.value.length);
  }

  line(input: string): string {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input)) {
      this.inPrivateKey = !/-----END [A-Z ]*PRIVATE KEY-----/.test(input);
      return '-----BEGIN PRIVATE KEY----- ' + R;
    }
    if (this.inPrivateKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(input)) this.inPrivateKey = false;
      return R;
    }

    let out = input;
    for (const { name, value } of this.envSecrets) {
      if (out.includes(value)) out = out.split(value).join(`[REDACTED:${name}]`);
    }
    // user:password@host in URLs
    out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, `$1$2:${R}@`);
    // Authorization headers / bearer tokens
    out = out.replace(/\b(Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{12,})/g, `$1 ${R}`);
    // CLI flags carrying tokens
    out = out.replace(/(--token[=\s]+|\s-t\s+)(\S+)/g, `$1${R}`);
    for (const re of TOKEN_PATTERNS) out = out.replace(re, R);
    out = out.replace(KEY_VALUE, (m, key: string, sep: string, q: string, val: string) =>
      val.startsWith('[REDACTED') || /^(Bearer|Basic|token)$/i.test(val) ? m : `${key}${sep}${q}${R}${q}`,
    );
    return out;
  }
}

/** Redacts command-line args before they are shown (token flags, env values). */
export function redactArgs(args: string[]): string[] {
  const out: string[] = [];
  let hideNext: 'none' | 'all' | 'value' = 'none';
  for (const arg of args) {
    if (hideNext !== 'none') {
      out.push(hideNext === 'value' && arg.includes('=') ? `${arg.split('=')[0]}=${R}` : R);
      hideNext = 'none';
      continue;
    }
    if (arg === '--token' || arg === '-t') hideNext = 'all';
    else if (['--env', '-e', '--build-env', '-b'].includes(arg)) hideNext = 'value';
    const m = /^(--token|--env|--build-env)=(.*)$/.exec(arg);
    if (m) out.push(m[1] === '--token' ? `--token=${R}` : `${m[1]}=${(m[2] ?? '').split('=')[0]}=${R}`);
    else out.push(arg);
  }
  return out;
}
