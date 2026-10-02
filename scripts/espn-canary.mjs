#!/usr/bin/env node
/**
 * The ESPN canary: ask the real feed, once a day, the same questions the
 * product asks, and say which KIND of problem it met.
 *
 * The feed is unofficial and changes without notice. A payload-shape change
 * makes the parsers refuse records; a request-shape change makes whole reads
 * fail (on Oct 2 2026 every date-RANGE scoreboard request began returning
 * HTTP 400 while single days kept working). Both are invisible in CI, which
 * never touches the network, and both used to be found by a user.
 *
 * The canary goes THROUGH the adapter: it never builds a URL of its own, so it
 * cannot drift from the request shapes the adapter really uses. It only wraps
 * `fetch` to see what was asked and what came back.
 *
 * Verdicts
 *   ok           the request was served and the payload fits the parsers
 *   rejected     the provider refused the request FORM (a 4xx that is not a
 *                throttle)                                           → red
 *   changed      a 2xx payload broke an invariant a parser relies on → red
 *   blocked      403/429: THIS runner is throttled or blocked. Says nothing
 *                about the feed's shape                              → neutral
 *   unreachable  network error, timeout or 5xx                       → neutral
 *
 *   pnpm -r build && node scripts/espn-canary.mjs
 *
 * Exit code 1 when anything is red, 0 otherwise. Run by
 * `.github/workflows/espn-canary.yml` on a schedule; it gates nothing.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The competitions 0.11 supports. A plain list until the supported-set table
 * exists in core; the canary then reads that table instead.
 */
export const CANARY_COMPETITIONS = Object.freeze([
  'fifa.world',
  'eng.1',
  'esp.1',
  'ita.1',
  'ger.1',
  'mex.1',
  'uefa.champions',
  'concacaf.champions',
  'fifa.cwc',
  'conmebol.libertadores',
  'conmebol.america',
  'concacaf.gold',
  'uefa.euro',
  'uefa.nations',
  'concacaf.nations.league',
]);

/** The statistics the standings parser reads from every row. */
const STANDING_STATS = [
  'gamesPlayed',
  'wins',
  'ties',
  'losses',
  'pointsFor',
  'pointsAgainst',
  'pointDifferential',
  'points',
  'rank',
];

const RED = new Set(['rejected', 'changed']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d) => d.toISOString().slice(0, 10);
const shiftDay = (d, days) => new Date(d.getTime() + days * 86_400_000);

/** What an HTTP status means for the canary, before any payload is read. */
function statusVerdict(status) {
  if (status === 403 || status === 429) return 'blocked';
  if (status >= 500) return 'unreachable';
  if (status >= 400) return 'rejected';
  return 'ok';
}

/** Invariants of a served scoreboard: the envelope, every record, identity, season. */
function checkScoreboard(core, body, matches, countRecords) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
    return { verdict: 'changed', detail: 'the response has no `events` list' };
  }
  if (countRecords) {
    const sent = new Set(body.events.map((e) => String(e?.id))).size;
    const refused = sent - matches.length;
    if (refused > 0) {
      return { verdict: 'changed', detail: `the adapter refused ${refused} of ${sent} events` };
    }
  }
  const noId = matches.flatMap((m) => [m.home, m.away]).filter((t) => t.id === undefined);
  if (noId.length > 0) {
    return { verdict: 'changed', detail: `${noId.length} team(s) arrived without an id (first: ${noId[0].name})` };
  }
  if (!core.fetchMeta(matches)?.season) {
    return { verdict: 'changed', detail: 'the response states no readable season' };
  }
  return { verdict: 'ok', detail: `${body.events.length} event(s)` };
}

/**
 * Invariants of a served standings payload, read RAW: the table parser does not
 * accept every competition's table shape yet, so its own verdict would say more
 * about us than about the feed. What must hold for any shape: a row that has
 * statistics names its team by id and carries every statistic the parser reads.
 */
function checkStandings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { verdict: 'changed', detail: 'the response is not an object' };
  }
  const children = Array.isArray(body.children) ? body.children : [];
  let rows = 0;
  for (const child of children) {
    const entries = child?.standings?.entries;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry?.stats)) continue;
      rows++;
      const who = entry?.team?.displayName ?? entry?.team?.abbreviation ?? 'a row';
      if (typeof entry?.team?.id !== 'string' || !/^[0-9]{1,20}$/.test(entry.team.id)) {
        return { verdict: 'changed', detail: `${who} has no team id` };
      }
      const names = new Set(entry.stats.map((s) => s?.name));
      const missing = STANDING_STATS.filter((n) => !names.has(n));
      if (missing.length > 0) {
        return { verdict: 'changed', detail: `${who} lacks the statistic(s) ${missing.join(', ')}` };
      }
    }
  }
  return { verdict: 'ok', detail: rows > 0 ? `${rows} row(s) in ${children.length} table(s)` : 'no table' };
}

/**
 * Run the canary. `core` is the @claudinho/core module (its built `dist` when
 * run from the command line, its source under test); `fetchImpl` is the network.
 */
export async function runCanary({
  core,
  competitions = CANARY_COMPETITIONS,
  fetchImpl = fetch,
  now = new Date(),
  pauseMs = 250,
} = {}) {
  const rows = [];
  for (const competition of competitions) {
    /** What the adapter asked during the current call, and what came back. */
    let seen = [];
    const recording = async (input, init) => {
      const url = String(input);
      const entry = { url, status: undefined, body: undefined, unreadable: false };
      seen.push(entry);
      const res = await fetchImpl(input, init);
      const text = await res.text();
      entry.status = res.status;
      try {
        entry.body = JSON.parse(text);
      } catch {
        entry.unreadable = true;
      }
      return new Response(text, { status: res.status, headers: res.headers });
    };
    const adapter = new core.EspnAdapter({ competition, enrichGroups: false, fetchImpl: recording });
    const today = isoDay(now);
    const requests = [
      ['live', () => adapter.fetchLive(), false],
      ['day', () => adapter.fetchByDate(today), true],
      ['window', () => adapter.fetchWindow(isoDay(shiftDay(now, -1)), isoDay(shiftDay(now, 1))), true],
      ['standings', () => adapter.fetchStandings(), false],
    ];
    for (const [request, call, countRecords] of requests) {
      seen = [];
      let result;
      let failure;
      try {
        result = await call();
      } catch (e) {
        failure = e;
      }
      const sent = seen[0];
      let verdict;
      let detail;
      if (!sent) {
        // Nothing was requested: the adapter is inside the cooldown a 403/429 armed.
        verdict = 'blocked';
        detail = 'not requested: provider cooldown in effect';
      } else if (sent.status === undefined) {
        verdict = 'unreachable';
        detail = String(failure?.message ?? 'no response');
      } else if (statusVerdict(sent.status) !== 'ok') {
        verdict = statusVerdict(sent.status);
        detail = `HTTP ${sent.status}${sent.body?.message ? `: ${sent.body.message}` : ''}`;
      } else if (sent.unreadable) {
        verdict = 'changed';
        detail = 'the response is not JSON';
      } else if (request === 'standings') {
        ({ verdict, detail } = checkStandings(sent.body));
      } else if (!Array.isArray(result)) {
        // Served, but the adapter could not turn it into fixtures at all.
        const reason = Array.isArray(sent.body?.events)
          ? `the adapter refused the payload (${failure?.message ?? 'no reason given'})`
          : 'the response has no `events` list';
        verdict = 'changed';
        detail = reason;
      } else {
        ({ verdict, detail } = checkScoreboard(core, sent.body, result, countRecords));
      }
      rows.push({ competition, request, url: sent?.url ?? '', verdict, detail });
      if (pauseMs > 0 && sent) await sleep(pauseMs);
    }
  }
  return { rows, red: rows.some((r) => RED.has(r.verdict)) };
}

/** A plain-text report: one line per request, then the totals. */
export function formatCanary(result) {
  const count = (v) => result.rows.filter((r) => r.verdict === v).length;
  const lines = result.rows.map(
    (r) => `${r.competition.padEnd(24)} ${r.request.padEnd(10)} ${r.verdict.toUpperCase().padEnd(12)} ${r.detail}`,
  );
  const red = result.rows.filter((r) => RED.has(r.verdict)).length;
  lines.push(
    '',
    `${red} red · ${count('ok')} ok · ${count('blocked')} blocked · ${count('unreachable')} unreachable`,
  );
  return lines.join('\n');
}

/** The same report as a Markdown table, for the workflow's job summary. */
function formatMarkdown(result) {
  const mark = { ok: '✅', rejected: '❌', changed: '❌', blocked: '⚪', unreachable: '⚪' };
  return [
    '### ESPN canary',
    '',
    '| Competition | Request | Verdict | Detail |',
    '|---|---|---|---|',
    ...result.rows.map((r) => `| \`${r.competition}\` | ${r.request} | ${mark[r.verdict]} ${r.verdict} | ${r.detail} |`),
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
  if (!existsSync(dist)) {
    console.error('✗ packages/core/dist not found — run `pnpm -r build` first.');
    process.exit(2);
  }
  const core = await import(pathToFileURL(dist).href);
  const result = await runCanary({ core });
  console.log(formatCanary(result));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatMarkdown(result));
  process.exit(result.red ? 1 : 0);
}
