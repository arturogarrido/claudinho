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
 * cannot drift from the request shapes the adapter really uses. It wraps
 * `fetch` only to see what was asked and what came back, and hands the adapter
 * the provider's response untouched: the adapter's own status handling (the
 * cooldown a 403/429 arms) and its own bounded reader see exactly what the
 * product would see. The canary reads a COPY of the body, through that same
 * bounded reader.
 *
 * It asks the product's parser what it could not read (the result's
 * completeness, see core `fetchMeta`) instead of keeping a second opinion.
 * The one place it reads raw is standings: the table parser does not accept
 * every competition's table shape yet, so its verdict there would say more
 * about us than about the feed.
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

/**
 * The statistics the standings parser requires of every row. A copy of the
 * parser's needs, pinned to it both ways by a test (each is required by the
 * real parser, and it requires no other).
 */
export const STANDING_STATS = Object.freeze([
  'gamesPlayed',
  'wins',
  'ties',
  'losses',
  'pointsFor',
  'pointsAgainst',
  'pointDifferential',
  'points',
  'rank',
]);

/** A provider team id, as the adapter accepts it. */
const RAW_TEAM_ID = /^[0-9]{1,20}$/;
/** An error body is read for its message only. */
const ERROR_BODY_BYTES = 64 * 1024;
/** More tables, rows or nesting than any competition has is a changed shape, not more work. */
const MAX_TABLES = 64;
const MAX_ROWS = 128;
const MAX_DEPTH = 4;

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

/**
 * Read the canary's copy of a body, through the adapter's own bounded reader.
 * Never rejects: what went wrong is part of the answer.
 */
async function readCopy(core, res, maxBytes) {
  try {
    return { json: await core.readJsonBounded(res, maxBytes) };
  } catch (e) {
    if (e instanceof core.ResponseTooLargeError) return { tooLarge: true };
    if (e instanceof SyntaxError) return { notJson: true };
    return { failed: String(e?.message ?? e) };
  }
}

/**
 * Invariants of a served scoreboard: the envelope, every record, identity,
 * season. The same checks for the default scoreboard as for a dated one: the
 * live question keeps only matches in play, so what it filtered out is judged
 * on the parser's own account of the WHOLE response and on what was sent.
 */
function checkScoreboard(core, body, matches) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
    return { verdict: 'changed', detail: 'the response has no `events` list' };
  }
  const meta = core.fetchMeta(matches);
  if (meta?.complete !== true) {
    // The parser's verdict, not a count of ids: a record refused as unreadable
    // and one contradicting a sibling under the same id both land here.
    return {
      verdict: 'changed',
      detail: `the adapter could not read every event (${body.events.length} sent, ${meta?.complete === false ? matches.length : 'unknown'} read)`,
    };
  }
  const sent = body.events.flatMap((e) => {
    const competitors = e?.competitions?.[0]?.competitors;
    return Array.isArray(competitors) ? competitors : [];
  });
  const rawNoId = sent.filter((c) => typeof c?.team?.id !== 'string' || !RAW_TEAM_ID.test(c.team.id));
  if (rawNoId.length > 0) {
    const first = rawNoId[0]?.team?.displayName ?? rawNoId[0]?.team?.abbreviation ?? 'unnamed';
    return { verdict: 'changed', detail: `${rawNoId.length} team(s) arrived without an id (first: ${first})` };
  }
  const noId = matches.flatMap((m) => [m.home, m.away]).filter((t) => t.id === undefined);
  if (noId.length > 0) {
    return { verdict: 'changed', detail: `${noId.length} team(s) left the adapter without an id (first: ${noId[0].name})` };
  }
  if (!meta.season) {
    return { verdict: 'changed', detail: 'the response states no readable season' };
  }
  return { verdict: 'ok', detail: `${body.events.length} event(s)` };
}

/**
 * Every table in a standings payload, at any depth: a league has one, a cup one
 * per group, and some competitions nest groups under a phase. A node that is
 * not what a table tree is made of is reported, never skipped.
 */
function collectTables(node, depth, tables) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return 'a table node is not an object';
  if (node.standings !== undefined) {
    if (tables.length >= MAX_TABLES) return `more than ${MAX_TABLES} tables`;
    tables.push(node.standings);
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) return '`children` is not a list';
    if (depth >= MAX_DEPTH) return `tables nested more than ${MAX_DEPTH} deep`;
    for (const child of node.children) {
      const problem = collectTables(child, depth + 1, tables);
      if (problem) return problem;
    }
  }
  return undefined;
}

/**
 * Invariants of a served standings payload, read RAW (see the header). What
 * must hold for any table shape: every table has a list of rows, and every row
 * names its team by id and states each statistic the parser requires exactly
 * once, as a number. Nothing is skipped for being malformed: malformed IS the
 * finding.
 */
function checkStandings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { verdict: 'changed', detail: 'the response is not an object' };
  }
  const tables = [];
  const problem = collectTables(body, 0, tables);
  if (problem) return { verdict: 'changed', detail: problem };
  let rows = 0;
  for (const table of tables) {
    const entries = table?.entries;
    if (!Array.isArray(entries)) return { verdict: 'changed', detail: 'a table has no `entries` list' };
    if (entries.length > MAX_ROWS) return { verdict: 'changed', detail: `a table has more than ${MAX_ROWS} rows` };
    for (const entry of entries) {
      rows++;
      const who = entry?.team?.displayName ?? entry?.team?.abbreviation ?? 'a row';
      if (typeof entry?.team?.id !== 'string' || !RAW_TEAM_ID.test(entry.team.id)) {
        return { verdict: 'changed', detail: `${who} has no team id` };
      }
      if (!Array.isArray(entry.stats)) {
        return { verdict: 'changed', detail: `${who} has no statistics` };
      }
      for (const name of STANDING_STATS) {
        const stated = entry.stats.filter((s) => s?.name === name);
        if (stated.length === 0) return { verdict: 'changed', detail: `${who} lacks the statistic ${name}` };
        if (stated.length > 1) return { verdict: 'changed', detail: `${who} states the statistic ${name} more than once` };
        if (typeof stated[0].value !== 'number' || !Number.isFinite(stated[0].value)) {
          return { verdict: 'changed', detail: `${who}: the statistic ${name} is not a number` };
        }
      }
    }
  }
  return { verdict: 'ok', detail: rows > 0 ? `${rows} row(s) in ${tables.length} table(s)` : 'no table' };
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
  // A 403/429 is the provider speaking to this RUNNER, not to one competition:
  // once it is said, nothing more is asked in this run.
  let throttled = false;
  for (const competition of competitions) {
    /** What the adapter asked during the current call, and what came back. */
    let seen = [];
    const recording = async (input, init) => {
      const entry = { url: String(input), status: undefined, copy: undefined };
      seen.push(entry);
      const res = await fetchImpl(input, init);
      // Known from the headers. Whatever happens to the body cannot take it back.
      entry.status = res.status;
      if (typeof res.clone === 'function') {
        entry.copy = readCopy(core, res.clone(), res.ok ? core.MAX_RESPONSE_BYTES : ERROR_BODY_BYTES);
      }
      // The provider's response, untouched: status, headers, body stream.
      return res;
    };
    const adapter = new core.EspnAdapter({ competition, enrichGroups: false, fetchImpl: recording });
    const today = isoDay(now);
    const requests = [
      ['live', () => adapter.fetchLive()],
      ['day', () => adapter.fetchByDate(today)],
      ['window', () => adapter.fetchWindow(isoDay(shiftDay(now, -1)), isoDay(shiftDay(now, 1)))],
      ['standings', () => adapter.fetchStandings()],
    ];
    for (const [request, call] of requests) {
      if (throttled) {
        rows.push({ competition, request, url: '', verdict: 'blocked', detail: 'not asked: the provider throttled this runner earlier in the run' });
        continue;
      }
      seen = [];
      let result;
      let failure;
      try {
        result = await call();
      } catch (e) {
        failure = e;
      }
      const sent = seen[0];
      const copy = sent?.copy ? await sent.copy : undefined;
      let verdict;
      let detail;
      if (!sent) {
        // Nothing was requested: the adapter is inside the cooldown a 403/429 armed.
        verdict = 'blocked';
        detail = 'not asked: provider cooldown in effect';
      } else if (sent.status === undefined) {
        verdict = 'unreachable';
        detail = String(failure?.message ?? 'no response');
      } else if (statusVerdict(sent.status) !== 'ok') {
        verdict = statusVerdict(sent.status);
        const message = typeof copy?.json?.message === 'string' ? copy.json.message.slice(0, 200) : '';
        detail = `HTTP ${sent.status}${message ? `: ${message}` : ''}`;
      } else if (!copy || copy.failed !== undefined) {
        // Served, and then the body did not arrive: an outage, not a changed feed.
        verdict = 'unreachable';
        detail = `the response body could not be read${copy?.failed ? ` (${copy.failed})` : ''}`;
      } else if (copy.tooLarge) {
        verdict = 'changed';
        detail = `the response is larger than the adapter accepts (${core.MAX_RESPONSE_BYTES} bytes)`;
      } else if (copy.notJson) {
        verdict = 'changed';
        detail = 'the response is not JSON';
      } else if (request === 'standings') {
        ({ verdict, detail } = checkStandings(copy.json));
      } else if (!Array.isArray(result)) {
        // Served, but the adapter could not turn it into fixtures at all.
        verdict = 'changed';
        detail = Array.isArray(copy.json?.events)
          ? `the adapter refused the payload (${failure?.message ?? 'no reason given'})`
          : 'the response has no `events` list';
      } else {
        ({ verdict, detail } = checkScoreboard(core, copy.json, result));
      }
      if (verdict === 'blocked') throttled = true;
      rows.push({ competition, request, url: sent?.url ?? '', verdict, detail });
      if (pauseMs > 0 && sent && !throttled) await sleep(pauseMs);
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
