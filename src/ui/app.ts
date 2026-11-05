import type { ErrorInfo, Fact, FlowState, LogLine, StageState } from '../core/model.js';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function fill(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}
const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zm0 0v16M8 7h7',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
};

const STATUS_LABEL: Record<StageState['status'], string> = {
  pending: 'Waiting',
  active: 'In progress',
  confirmed: 'Confirmed',
  failed: 'Failed',
  unverified: 'Unverified',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let state: FlowState | undefined;
const logs = new Map<number, LogLine>();
const logEls = new Map<number, HTMLLIElement>();
let selected: string | undefined; // stage id chosen by the user; undefined = follow the run
let logsOpen = false;
let fixAgent: 'claude' | 'codex' = 'claude';
let fixPromptOpen = false;

// ---------- rendering ----------

function rel(at: number): string {
  if (!state) return '';
  const s = Math.max(0, (at - state.startedAt) / 1000);
  return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function autoStage(s: FlowState): string {
  if (s.failedStage) return s.failedStage;
  const active = [...s.stages].reverse().find((st) => st.status === 'active');
  if (active) return active.id;
  if (s.outcome === 'success') return s.stages.at(-1)!.id;
  if (s.outcome === 'interrupted') {
    // Show where the run stopped: the first stage after the last confirmed one.
    const i = s.stages.findIndex((st) => st.id === s.lastConfirmed);
    return (s.stages[i + 1] ?? s.stages[0]!).id;
  }
  return s.lastConfirmed ?? s.stages[0]!.id;
}

function stageIcon(st: StageState): HTMLElement {
  const el = h('span', { class: `icon ${st.status}` });
  if (st.status === 'confirmed') el.append(icon(ICONS.check));
  else if (st.status === 'failed') el.append(icon(ICONS.x));
  else if (st.status === 'unverified') el.append('?');
  return el;
}

function renderHeader(s: FlowState): void {
  $('cmd').textContent = s.command.join(' ');
  $('cmd').title = `${s.command.join(' ')}\nin ${s.cwd}`;
  const mode = $('mode');
  mode.textContent = s.mode === 'demo' ? 'Demo replay' : s.mode === 'replay' ? 'Saved run' : 'Live';
  mode.className = `badge ${s.mode}`;
  const status = $('status');
  status.className = `pill ${s.outcome}`;
  status.textContent = { running: 'Running', success: s.stages.at(-1)?.status === 'confirmed' ? 'Deployed' : 'Exited 0', failure: 'Failed', interrupted: 'Stopped' }[s.outcome];
  $('saved').replaceChildren(...(s.savedTo ? ['Saved to ', h('code', {}, s.savedTo)] : s.mode === 'demo' ? ['Demo data: recorded output, nothing is sent anywhere.'] : []));
  document.title = `${status.textContent} · Unfold`;
}

function renderElapsed(): void {
  if (!state) return;
  const end = state.endedAt ?? Date.now();
  const s = Math.max(0, (end - state.startedAt) / 1000);
  $('elapsed').textContent = s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function fact(s: FlowState, key: string): Fact | undefined {
  return s.facts.find((f) => f.key === key);
}

function primaryError(s: FlowState): ErrorInfo | undefined {
  return s.errors.find((e) => e.severity === 'fatal') ?? s.errors.at(-1);
}

function causes(s: FlowState, stage?: string): ErrorInfo[] {
  const fatal = primaryError(s);
  return s.errors
    .filter((e) => e.severity === 'cause' && (!stage || e.stage === stage) && e.message !== fatal?.message)
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || a.seq - b.seq)
    .slice(0, 6);
}

function extLink(href: string, label: string): HTMLAnchorElement {
  const a = h('a', { class: 'btn', href, target: '_blank', rel: 'noreferrer noopener' }, label);
  a.append(icon(ICONS.ext));
  a.querySelector('svg')!.setAttribute('style', 'width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2');
  return a;
}

function renderBanner(s: FlowState): void {
  const el = $('banner');
  const title = (id?: string) => s.stages.find((st) => st.id === id)?.title ?? 'none';
  const inspect = fact(s, 'inspectUrl');
  if (s.outcome === 'running') {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `banner ${s.outcome}`;
  if (s.outcome === 'failure') {
    const err = primaryError(s);
    const cause = causes(s)[0];
    fill(
      el,
      h('h2', {}, `Deploy failed during ${title(s.failedStage)}`),
      h('p', {}, `Last confirmed stage: ${title(s.lastConfirmed)}. Exit code ${s.exitCode ?? s.exitSignal ?? 'unknown'}.`),
      err ? h('div', { class: 'err' }, err.message) : h('p', {}, 'The command failed without printing a recognizable error. Check the logs.'),
      cause ? h('p', {}, 'Most relevant output: ', h('code', {}, cause.message)) : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => jumpTo((cause ?? err)?.seq) }, 'Jump to the error in the logs'),
        h('button', { class: 'btn', onclick: () => select(s.failedStage) }, `Open the ${title(s.failedStage)} stage`),
        inspect && inspect.href ? extLink(inspect.href, 'Full logs on Vercel') : null,
      ),
      s.fix ? fixPanel(s) : null,
    );
  } else if (s.outcome === 'success') {
    const url = fact(s, 'alias') ?? fact(s, 'deploymentUrl');
    const live = s.stages.at(-1)?.status === 'confirmed';
    fill(
      el,
      h('h2', {}, live ? 'Preview is ready' : 'Command finished, deploy not confirmed'),
      live ? null : h('p', {}, "The command exited with code 0, but its output never confirmed the deployment went live."),
      url?.href ? h('a', { class: 'live-url', href: url.href, target: '_blank', rel: 'noreferrer noopener' }, url.value) : h('p', {}, 'The command succeeded.'),
      fact(s, 'protection') ? h('p', {}, 'Deployment Protection is on, so visitors may need to sign in to Vercel.') : null,
      h(
        'div',
        { class: 'actions' },
        url?.value ? h('button', { class: 'btn', onclick: (e) => copy(url.value, e.currentTarget as HTMLButtonElement) }, 'Copy URL') : null,
        inspect?.href ? extLink(inspect.href, 'Inspect on Vercel') : null,
      ),
    );
  } else {
    fill(
      el,
      h('h2', {}, 'Stopped with Ctrl+C'),
      h('p', {}, `Last confirmed stage: ${title(s.lastConfirmed)}. ${inspect ? 'The deployment had already been created, so Vercel may still finish building it.' : 'No deployment had been created yet.'}`),
      h('div', { class: 'actions' }, inspect?.href ? extLink(inspect.href, 'Check it on Vercel') : null, h('button', { class: 'btn', onclick: () => openLogs(true) }, 'View logs')),
    );
  }
}

/** A ready-made prompt so a coding agent can pick up the failure. */
function fixPanel(s: FlowState): HTMLElement {
  const fix = s.fix!;
  const name = fixAgent === 'claude' ? 'Claude Code' : 'Codex';
  const command = fix.commands?.[fixAgent];
  const seg = (agent: 'claude' | 'codex', label: string) =>
    h('button', { class: 'seg-btn', 'aria-pressed': String(fixAgent === agent), onclick: () => ((fixAgent = agent), render()) }, label);
  return h(
    'div',
    { class: 'fix' },
    h('div', { class: 'fix-head' }, h('strong', {}, 'Fix it with an AI agent'), h('span', { class: 'seg', role: 'group', 'aria-label': 'Agent' }, seg('claude', 'Claude Code'), seg('codex', 'Codex'))),
    h(
      'p',
      {},
      'Unfold wrote a prompt from this run: the error, the likely cause, a redacted log excerpt and hints about this stage. ',
      command ? `Run this in your project folder to start ${name} with it:` : `Copy it into ${name}.`,
    ),
    command ? h('div', { class: 'cmdline' }, h('code', {}, command), h('button', { class: 'btn', onclick: (e) => copy(command, e.currentTarget as HTMLButtonElement, 'Copy command') }, 'Copy command')) : null,
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn', onclick: (e) => copy(fix.prompt, e.currentTarget as HTMLButtonElement, 'Copy prompt') }, 'Copy prompt'),
      h('button', { class: 'btn', 'aria-expanded': String(fixPromptOpen), onclick: () => ((fixPromptOpen = !fixPromptOpen), render()) }, fixPromptOpen ? 'Hide prompt' : 'Show prompt'),
    ),
    fixPromptOpen ? h('pre', { class: 'prompt' }, fix.prompt) : null,
    h('p', { class: 'fine' }, 'Tip: ', h('code', {}, `unfold vercel --fix ${fixAgent}`), ` starts ${name} automatically when a deploy fails.`),
  );
}

function renderFlow(s: FlowState): void {
  const nav = $('flow');
  nav.style.setProperty('--n', String(s.stages.length));
  const current = selected ?? autoStage(s);
  nav.replaceChildren(
    ...s.stages.map((st, i) =>
      h(
        'button',
        {
          class: `stage ${st.status}${i > 0 && s.stages[i - 1]!.status === 'confirmed' ? ' prev-confirmed' : ''}`,
          role: 'tab',
          id: `tab-${st.id}`,
          'aria-selected': String(st.id === current),
          'aria-controls': 'detail',
          tabindex: st.id === current ? '0' : '-1',
          onclick: () => select(st.id),
        },
        h('span', { class: 'stage-head' }, stageIcon(st), h('span', { class: 'stage-title' }, st.title), h('span', { class: 'stage-num' }, `${i + 1}/${s.stages.length}`)),
        h('span', { class: 'stage-status' }, STATUS_LABEL[st.status]),
        h('span', { class: 'stage-note' }, st.note ?? st.summary),
      ),
    ),
  );
}

// Build log lines carry an ISO timestamp; the relative time column already says when.
const stripStamp = (text: string) => text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '');

function evidenceItem(seq: number, at: number, note: string, rawText: string): HTMLLIElement {
  const text = stripStamp(rawText);
  return h(
    'li',
    {},
    h('span', { class: 'ev-time' }, rel(at)),
    h('span', { class: 'ev-note' }, note),
    h('span', { class: 'ev-line' }, h('code', { title: text }, text), h('button', { class: 'jump', onclick: () => jumpTo(seq) }, `line ${seq} →`)),
  );
}

function renderDetail(s: FlowState): void {
  const id = selected ?? autoStage(s);
  const st = s.stages.find((x) => x.id === id) ?? s.stages[0]!;
  const facts = s.facts.filter((f) => f.stage === st.id);
  const stageCauses = st.status === 'failed' ? causes(s, st.id) : [];
  const fatal = st.status === 'failed' ? s.errors.find((e) => e.severity === 'fatal' && e.stage === st.id) : undefined;

  const statusText =
    st.status === 'pending' ? 'Not started yet. Nothing about this stage has appeared in the output.' : st.note ?? STATUS_LABEL[st.status];

  const observed = h(
    'div',
    { class: 'card observed' },
    h('div', { class: 'kicker observed' }, icon(ICONS.eye), "Observed in this run"),
    h('h3', {}, stageIcon(st), st.title, h('span', { class: 'stage-status' }, STATUS_LABEL[st.status])),
    h('div', { class: `status-line ${st.status}` }, statusText),
    fatal ? h('div', { class: 'causes' }, h('div', { class: 'sub' }, 'Error'), h('span', { class: 'ev-line' }, h('code', { title: fatal.message }, fatal.message), h('button', { class: 'jump', onclick: () => jumpTo(fatal.seq) }, `line ${fatal.seq} →`))) : null,
    stageCauses.length
      ? h(
          'div',
          { class: 'causes' },
          h('div', { class: 'sub' }, 'Lines that look like the cause'),
          ...stageCauses.map((c) => h('span', { class: 'ev-line' }, h('code', { title: c.message }, c.message), h('button', { class: 'jump', onclick: () => jumpTo(c.seq) }, `line ${c.seq} →`))),
        )
      : null,
    facts.length
      ? h(
          'dl',
          { class: 'facts' },
          ...facts.flatMap((f) => [h('dt', {}, f.label), h('dd', {}, f.href ? h('a', { href: f.href, target: '_blank', rel: 'noreferrer noopener' }, f.value) : f.value)]),
        )
      : null,
    st.evidence.length
      ? h('div', { class: 'sub' }, 'Evidence from the output')
      : null,
    st.evidence.length
      ? h('ul', { class: 'evidence' }, ...st.evidence.map((e) => evidenceItem(e.seq, e.at, e.note, logs.get(e.seq)?.text ?? e.text)))
      : h('p', { class: 'empty' }, 'No output from this run relates to this stage.'),
  );

  const explain = h(
    'div',
    { class: 'card explain' },
    h('div', { class: 'kicker' }, icon(ICONS.book), 'How this stage works · general, not from this run'),
    h('p', { class: 'summary' }, st.summary),
    ...st.explanation.map((p) => h('p', {}, p)),
    h('p', { class: 'confirm' }, h('b', {}, 'What would confirm it: '), st.confirmedBy),
    st.docsUrl ? h('a', { href: st.docsUrl, target: '_blank', rel: 'noreferrer noopener' }, 'Vercel docs') : null,
  );

  $('detail').setAttribute('aria-labelledby', `tab-${st.id}`);
  $('detail').replaceChildren(observed, explain);
}

function render(): void {
  if (!state) return;
  renderHeader(state);
  renderBanner(state);
  renderFlow(state);
  renderDetail(state);
  renderElapsed();
  markLogLines();
}

// ---------- logs ----------

function evidenceSeqs(): { ev: Set<number>; err: Set<number> } {
  const ev = new Set<number>();
  const err = new Set<number>();
  state?.stages.forEach((st) => st.evidence.forEach((e) => ev.add(e.seq)));
  state?.errors.forEach((e) => err.add(e.seq));
  return { ev, err };
}

function markLogLines(): void {
  const { ev, err } = evidenceSeqs();
  for (const [seq, li] of logEls) {
    li.classList.toggle('ev', ev.has(seq) && !err.has(seq));
    li.classList.toggle('err', err.has(seq));
  }
  applyFilter();
}

function upsertLogs(lines: LogLine[]): void {
  const list = $('log-lines');
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  for (const line of lines) {
    logs.set(line.seq, line);
    let li = logEls.get(line.seq);
    if (!li) {
      li = h('li', { id: `L${line.seq}` }, h('span', { class: 'ln' }, String(line.seq)), h('span', { class: 'lt' }), h('span', { class: 'tx' }));
      logEls.set(line.seq, li);
      list.append(li);
    }
    li.querySelector('.lt')!.textContent = rel(line.at);
    li.querySelector('.tx')!.textContent = line.text;
  }
  $('log-count').textContent = `${logs.size} lines`;
  if (($('follow') as HTMLInputElement).checked && atBottom) list.scrollTop = list.scrollHeight;
}

function applyFilter(): void {
  const q = ($('log-filter') as HTMLInputElement).value.toLowerCase();
  const errorsOnly = ($('errors-only') as HTMLInputElement).checked;
  for (const [seq, li] of logEls) {
    const text = logs.get(seq)?.text.toLowerCase() ?? '';
    li.hidden = (q !== '' && !text.includes(q)) || (errorsOnly && !li.classList.contains('err'));
  }
}

function openLogs(open: boolean): void {
  logsOpen = open;
  $('log-lines').hidden = !open;
  $('logs-toggle').setAttribute('aria-expanded', String(open));
}

function jumpTo(seq: number | undefined): void {
  openLogs(true);
  ($('log-filter') as HTMLInputElement).value = '';
  ($('errors-only') as HTMLInputElement).checked = false;
  ($('follow') as HTMLInputElement).checked = false;
  applyFilter();
  const li = seq !== undefined ? logEls.get(seq) : undefined;
  $('logs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!li) return;
  const list = $('log-lines');
  list.scrollTop = li.offsetTop - list.offsetTop - list.clientHeight / 3;
  li.classList.remove('flash');
  void li.offsetWidth;
  li.classList.add('flash');
}

// ---------- interaction ----------

function select(id: string | undefined): void {
  selected = id;
  render();
  if (id) document.getElementById(`tab-${id}`)?.focus();
}

async function copy(text: string, btn: HTMLButtonElement, label = 'Copy URL'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

$('flow').addEventListener('keydown', (e) => {
  if (!state || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const ids = state.stages.map((s) => s.id);
  const i = ids.indexOf(selected ?? autoStage(state));
  const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1);
  select(ids[next]);
});
$('logs-toggle').addEventListener('click', () => openLogs(!logsOpen));
$('log-filter').addEventListener('input', applyFilter);
$('errors-only').addEventListener('change', applyFilter);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected) {
    selected = undefined; // go back to following the run
    render();
  }
});

// ---------- connection ----------

function reset(): void {
  logs.clear();
  logEls.clear();
  $('log-lines').replaceChildren();
  selected = undefined;
}

const es = new EventSource('/api/events');
es.addEventListener('snapshot', (e) => {
  const data = JSON.parse((e as MessageEvent<string>).data) as { state: FlowState; logs: LogLine[] };
  reset();
  state = data.state;
  upsertLogs(data.logs);
  if (state.outcome === 'failure') openLogs(true);
  render();
});
es.addEventListener('reset', () => reset());
es.addEventListener('logs', (e) => upsertLogs(JSON.parse((e as MessageEvent<string>).data) as LogLine[]));
es.addEventListener('state', (e) => {
  const prev = state?.outcome;
  state = JSON.parse((e as MessageEvent<string>).data) as FlowState;
  if (prev === 'running' && state.outcome === 'failure') openLogs(true);
  render();
});
es.addEventListener('error', () => {
  if (state && state.outcome !== 'running') es.close(); // the run is over and Unfold exited; keep the last view
});

setInterval(() => state?.outcome === 'running' && renderElapsed(), 250);
