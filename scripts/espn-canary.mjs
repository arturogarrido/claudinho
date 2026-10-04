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
 * product would see. The canary reads a COPY of a served body through that same
 * bounded reader, and an error body (which the adapter never reads) from the
 * response itself once the adapter is done with it. Every body it waits for
 * has a deadline.
 *
 * It asks the product's parser what it could not read (the result's
 * completeness, see core `fetchMeta`) instead of keeping a second opinion.
 * Standings are also read raw, row by row, for a diagnosis the parser does
 * not give (which statistic a row lost, which team has no id); the verdict on
 * whether the tables were read is the parser's, for every competition.
 *
 * What it asks, per competition: every question the adapter answers, with the
 * spans the product uses today. A window is composed of several requests (the
 * provider refuses date ranges), and every one of them is judged.
 *   live       the default scoreboard bucket (the fallback of the live read)
 *   day        one calendar day
 *   window     yesterday to tomorrow, a day at a time: what `live` and the
 *              statusline's refresher request, asked as they ask it, across a
 *              season turn (on the days a competition turns, its days state
 *              two seasons, and the live read composes them). `today` and
 *              `match` request the same span strictly
 *   knockout   the bundled bracket's whole span, a month at a time, asked only
 *              of the competition the bundle belongs to: what `bracket`,
 *              `next` and the countdown request. Asked strictly, as they ask.
 *              It is the bundled competition's month form: discovery is not
 *              asked of it
 *   discovery  the schedule ahead (yesterday to 14 provider days ahead), each
 *              calendar month it touches one strict request, asked only of
 *              the competitions the product DISCOVERS (every one but the
 *              bundled competition): what the refresher, `next` and `match`
 *              request off the bundle. Core's `getScheduleAhead` chooses the
 *              requests, so they are discovery's own; each month is judged by
 *              its OWN window, asked again of exactly that response, and
 *              discovery's account of the whole must be whole too (a fixture
 *              served by two months is one it drops). Two months may state
 *              two seasons (no season is required of the whole), but only as
 *              a turn, by the window's rule: one step up, within the cadence
 *   standings  the tables
 * A test fails when the adapter gains a fetch method this list does not ask.
 *
 * Verdicts
 *   ok           the request was served and the payload fits the parsers
 *   rejected     the provider refused the request FORM (a 4xx that is not a
 *                throttle)                                           → red
 *   changed      a 2xx payload broke an invariant a parser relies on → red
 *   blocked      403/429: THIS runner is throttled or blocked. Says nothing
 *                about the feed's shape. Nothing more is asked in the run
 *                                                                    → neutral
 *   unreachable  network error, timeout or 5xx                       → neutral
 * A neutral row is a row the canary could not see: the run stays green and
 * says so in a warning.
 *
 * Work, worst case: 120 requests (15 × 6 + 14 × 2 + 2: the 15 competitions
 * at 6 each, 1 + 1 + 3 + 1 for live, day, window and standings; the 14 off the
 * bundle at up to 2 more each, discovery's two months; and 2 more for the
 * bundled one's knockout span), each bounded by the adapter's timeout and byte
 * limit. Questions are asked one at a time with a pause between them; the
 * requests of one question go together, so a throttle inside a window is seen
 * after up to three requests, and ends the run.
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
 * The competitions 0.11 supports: the fifteen core writes down in its
 * supported-set tables (`TEAM_KIND`, `COMPETITION_KIND` in
 * `packages/core/src/kinds.ts`). The canary keeps its own list of them on
 * purpose: it reaches core only through the BUILT package, loaded at run time
 * and handed to `runCanary({ core })`, while this list is read before that (by
 * the run's own defaults and by the tests that name what it asks), so it cannot
 * be derived from core in one line without loading core at import. A
 * competition added to the product is added here too; no test compares the two
 * lists yet.
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
 * What a competition's tables are is written down in core (`STANDINGS_SHAPE`:
 * a league's one table, no table at all, or groups by default), and the canary
 * checks the feed against it:
 *   - every competition that has tables must be read WHOLE by the product's
 *     own parser: a table or a row it refuses is red, and so is a payload it
 *     reads none of. No shape is excused as "not read yet";
 *   - `none` (knockout from the first round) is an expectation, not an
 *     exemption: the endpoint must answer with no table rows, and the adapter
 *     must accept that answer. The day it serves a table, that is a changed
 *     shape, and a person decides what it means.
 */
const shapeOf = (core, competition) => core.standingsShapeOf(competition);

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
/**
 * How often each supported competition has an edition, in years; a season turn
 * steps up by at most that (at most, not exactly: the Copa America went 2021,
 * 2024, 2028). The World Cup, the Euro, the Copa America and the Club World
 * Cup are four-yearly; both Nations Leagues and the Gold Cup two-yearly (the
 * Concacaf Nations League's next editions are 2026/27 and 2028/29, by
 * Concacaf's published 2026 to 2030 calendar); every other competition in
 * `CANARY_COMPETITIONS` yearly. A yearly league stating a season two years on
 * has skipped an edition: a changed feed, not a turn.
 */
const CADENCE_YEARS = Object.freeze({
  'fifa.world': 4,
  'uefa.euro': 4,
  'conmebol.america': 4,
  'fifa.cwc': 4,
  'uefa.nations': 2,
  'concacaf.nations.league': 2,
  'concacaf.gold': 2,
});
// By own property, like every written table: a name like a prototype key is not one.
const cadenceOf = (competition) => (Object.hasOwn(CADENCE_YEARS, competition) ? CADENCE_YEARS[competition] : 1);
/**
 * Whether the seasons a competition's responses stated, in the order of the
 * dates asked, are NOT a turn: a turn is ONE step up, of at most the
 * competition's cadence, wherever it falls. A step down, a second step, or a
 * jump past the cadence is a feed the dated reads refuse. Asked of a window's
 * days and of discovery's months alike, where they state more than one season.
 */
function notATurn(competition, years) {
  const steps = years.slice(1).map((year, i) => year - years[i]).filter((step) => step !== 0);
  return steps.length !== 1 || steps[0] < 1 || steps[0] > cadenceOf(competition);
}
/** An error body is read for its message only. */
const ERROR_BODY_BYTES = 64 * 1024;
/** How long the canary waits for a body it is reading for itself. */
const BODY_DEADLINE_MS = 6000;
/** More tables, rows or nesting than any competition has is a changed shape, not more work. */
const MAX_TABLES = 64;
const MAX_ROWS = 128;
const MAX_DEPTH = 4;

/**
 * The questions, in the order they are asked. `method` is the adapter method a
 * question goes through; `bundleOnly` questions are asked of the competition
 * the bundled schedule belongs to, `offBundleOnly` ones of every other.
 */
export const CANARY_QUESTIONS = Object.freeze([
  { request: 'live', method: 'fetchLive' },
  { request: 'day', method: 'fetchByDate' },
  { request: 'window', method: 'fetchWindow' },
  { request: 'knockout', method: 'fetchWindow', bundleOnly: true },
  { request: 'discovery', method: 'fetchWindow', offBundleOnly: true },
  { request: 'standings', method: 'fetchStandings' },
]);

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
 * A promise, or `fallback` once `ms` have passed. The canary never waits on a
 * body without one: the adapter's own deadline ends with the response headers
 * of an error, and a body can stall after them.
 */
function within(promise, ms, fallback) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * What one response of a question is, before anything is compared: the kind of
 * failure, or its body. A question can take several requests (a window is
 * asked a day or a month at a time), and every one of them is judged.
 */
function judgePart(core, sent, copy, failure) {
  if (sent.status === undefined) {
    // No response: a network error or a timeout.
    return { verdict: 'unreachable', detail: String(failure?.message ?? 'no response') };
  }
  const byStatus = statusVerdict(sent.status);
  if (byStatus !== 'ok') {
    const message = typeof copy?.json?.message === 'string' ? copy.json.message.slice(0, 200) : '';
    return { verdict: byStatus, detail: `HTTP ${sent.status}${message ? `: ${message}` : ''}` };
  }
  if (!copy || copy.failed !== undefined) {
    // Served, and then the body did not arrive: an outage, not a changed feed.
    return { verdict: 'unreachable', detail: `the response body could not be read${copy?.failed ? ` (${copy.failed})` : ''}` };
  }
  if (copy.tooLarge) {
    return { verdict: 'changed', detail: `the response is larger than the adapter accepts (${core.MAX_RESPONSE_BYTES} bytes)` };
  }
  if (copy.notJson) return { verdict: 'changed', detail: 'the response is not JSON' };
  return { verdict: 'ok', detail: '', json: copy.json };
}

/**
 * A question takes one verdict from its parts, and what was SEEN to be wrong
 * comes first: a refused form or a changed payload is a finding whatever
 * happened to a sibling request. A part that could not be seen (throttled,
 * down) decides only when nothing seen was wrong, and is named in the detail
 * either way. Whether the run goes on asking is a separate decision: a
 * throttle on any part stops it.
 */
const SEEN_WRONG = ['rejected', 'changed'];
const NOT_SEEN = ['blocked', 'unreachable'];
const firstOf = (parts, verdicts) => verdicts.map((v) => parts.find((part) => part.verdict === v)).find(Boolean);

/** What a request asked for: the `dates` parameter of its URL (empty for the default scoreboard). */
function datesOf(url) {
  try {
    return new URL(url).searchParams.get('dates') ?? '';
  } catch {
    return '';
  }
}

/**
 * Invariants of a served scoreboard answer, over EVERY response it took: the
 * envelope, every record, identity, how a day is filed, season. The same
 * checks for the default scoreboard as for a dated one: the live question
 * keeps only matches in play, so what it filtered out is judged on the
 * parser's own account of the whole answer and on what was sent.
 */
function checkScoreboard(core, adapter, parts, matches) {
  const envelope = envelopeProblem(parts);
  if (envelope) return { verdict: 'changed', detail: envelope };
  const events = parts.flatMap((part) => part.json.events);
  const meta = core.fetchMeta(matches);
  if (meta?.complete !== true) {
    // The parser's verdict, not a count of ids: a record refused as unreadable
    // and one contradicting a sibling under the same id both land here.
    return {
      verdict: 'changed',
      detail: `the adapter could not read every event (${events.length} sent, ${meta?.complete === false ? matches.length : 'unknown'} read)`,
    };
  }
  const sent = sentProblem(adapter, parts);
  if (sent) return { verdict: 'changed', detail: sent };
  // A window asked across a season turn states no season when its parts
  // stated two, and names both: a normal answer on the days a competition
  // turns. No season stated at all is still a changed feed, and so are two
  // seasons that are not a turn. A turn is ONE step up, on a later day, of at
  // most this competition's cadence (`CADENCE_YEARS`: a yearly league turns by
  // one, the Nations League by two). The adapter lists DISTINCT seasons, which
  // cannot show a day stating the earlier season again after the later one,
  // so the steps are read from each part's own envelope in the order of the
  // days asked: a step down, a second step, or a jump past the cadence is a
  // feed the dated reads refuse, not a turn.
  const seasons = Array.isArray(meta.seasons) ? meta.seasons : [];
  if (!meta.season && seasons.length < 2) {
    return { verdict: 'changed', detail: 'the response states no readable season' };
  }
  if (!meta.season) {
    const stated = [...parts]
      .sort((a, b) => datesOf(a.url).localeCompare(datesOf(b.url)))
      .map((part) => part.json?.leagues?.[0]?.season?.year)
      .filter((year) => Number.isInteger(year));
    if (notATurn(adapter.competition, stated)) {
      return { verdict: 'changed', detail: `the parts state seasons that are not a turn (${stated.join(', ')})` };
    }
  }
  const turn = meta.season ? '' : `; across a season turn (${seasons.map((s) => s.year).join(' and ')})`;
  return {
    verdict: 'ok',
    detail: `${events.length} event(s)${parts.length > 1 ? ` in ${parts.length} requests` : ''}${turn}`,
  };
}

/**
 * What is wrong with the responses that WERE served for a question whose
 * other requests failed, or nothing. The question is asked again of an adapter
 * that is given exactly those responses (and an honest empty one in place of
 * each that failed): no request is made, and the verdict is the product's own
 * (a record its parser refuses, one fixture in two parts, parts of two
 * seasons where the question is asked strictly, a response that filled its
 * limit), not a copy of its rules.
 */
async function servedProblem(core, competition, askOf, request, served) {
  const envelope = envelopeProblem(served);
  if (envelope) return envelope;
  const again = replayAdapter(core, competition, served);
  let result;
  let failure;
  try {
    result = await askOf(again)[request]();
  } catch (e) {
    failure = e;
  }
  if (!Array.isArray(result)) {
    return `the adapter refused what was served (${failure?.message ?? 'no reason given'})`;
  }
  const judged = checkScoreboard(core, again, served, result);
  return judged.verdict === 'ok' ? undefined : judged.detail;
}

/**
 * An adapter given exactly the responses that were served, and an honest
 * empty answer in place of any other request: asking it makes no request.
 */
function replayAdapter(core, competition, served) {
  const replay = async (input) => {
    const part = served.find((p) => p.url === String(input));
    return new Response(JSON.stringify(part ? part.json : { events: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return new core.EspnAdapter({ competition, enrichGroups: false, fetchImpl: replay });
}

/** The calendar month a `dates=YYYYMM` request asked for, as its first and last day; nothing for any other request. */
function monthAsked(url) {
  const dates = datesOf(url);
  if (!/^\d{6}$/.test(dates)) return undefined;
  const year = Number(dates.slice(0, 4));
  const month = Number(dates.slice(4, 6));
  if (month < 1 || month > 12) return undefined;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${dates.slice(0, 4)}-${dates.slice(4, 6)}`;
  return { first: `${prefix}-01`, last: `${prefix}-${String(days).padStart(2, '0')}` };
}

/**
 * Discovery's months, each judged as what it is: one strict window of its own
 * month (`fetchWindow(first, last)`, as `getScheduleAhead` asks it), asked
 * again of an adapter given only that month's response, and judged by the
 * scoreboard checks with THAT window's own account. Discovery's aggregate is
 * never what is judged here: it swallows a month's refusal into
 * `complete: false`, and its object is not a scoreboard answer.
 *
 * The first month with a problem, named by `which`; otherwise, per month, the
 * ids its response held (before the span narrowed it) and the season it
 * stated, which is what the whole is judged on next.
 */
async function discoveryMonths(core, competition, served, which) {
  const months = [];
  for (const part of served) {
    const month = monthAsked(part.url);
    if (!month) return { problem: `the request was not one calendar month${which(part)}` };
    const envelope = envelopeProblem([part]);
    if (envelope) return { problem: `${envelope}${which(part)}` };
    const again = replayAdapter(core, competition, [part]);
    let result;
    let failure;
    try {
      result = await again.fetchWindow(month.first, month.last);
    } catch (e) {
      failure = e;
    }
    if (!Array.isArray(result)) {
      // A month whose list held only records the parser refuses lands here
      // (`noReadableRecord`): discovery itself takes it as "not whole".
      return { problem: `the adapter refused what was served (${failure?.message ?? 'no reason given'})${which(part)}` };
    }
    const judged = checkScoreboard(core, again, [part], result);
    if (judged.verdict !== 'ok') return { problem: `${judged.detail}${which(part)}` };
    const meta = core.fetchMeta(result);
    months.push({
      dates: datesOf(part.url),
      ids: Array.isArray(meta?.mentioned) ? meta.mentioned : result.map((m) => m.id),
      year: meta?.season?.year,
    });
  }
  return { months };
}

/** What discovery said of its own answer, as a row reports it. */
function discoveryState(result) {
  if (!result || typeof result !== 'object') return 'discovery gave no answer';
  if (result.degraded === true) return 'discovery degraded';
  return `discovery complete: ${result.complete === true}`;
}

/**
 * The discovery row when every request was served: each month by its own
 * window, then discovery's account of the whole. The row is ok only when
 * every month passed AND that account is whole and not degraded: discovery
 * refuses what no single month can show (one fixture served by two months: it
 * keeps the first copy, wherever it fell, and an in-span fixture can vanish
 * behind a copy outside the span). No season is asked of the whole, but two
 * months stating two seasons must be a turn, by the window's rule
 * (`notATurn`): one step up, within the competition's cadence.
 */
async function judgeDiscovery(core, competition, parts, result, which, span) {
  const judged = await discoveryMonths(core, competition, parts, which);
  if (judged.problem) return { verdict: 'changed', detail: judged.problem };
  const { months } = judged;
  if (!result || typeof result !== 'object' || result.degraded === true) {
    return { verdict: 'changed', detail: 'every month was read, and discovery still could not use them' };
  }
  if (result.complete !== true) {
    // Discovery does not say which fixture it set aside; the months' own
    // records do. An id two months both held is the contradiction.
    const where = new Map();
    for (const { dates, ids } of months) {
      for (const id of ids) where.set(id, [...(where.get(id) ?? []), dates]);
    }
    const twice = [...where].filter(([, held]) => held.length > 1);
    const left = Number.isInteger(result.omitted) ? `, ${result.omitted} record(s) left out` : '';
    return {
      verdict: 'changed',
      detail:
        twice.length > 0
          ? `discovery is not whole${left}: ${twice
              .slice(0, 5)
              .map(([id, held]) => `fixture ${id} was served by ${held.length} months (${held.join(' and ')})`)
              .join('; ')}${twice.length > 5 ? `; and ${twice.length - 5} more` : ''}`
          : `discovery is not whole${left}`,
    };
  }
  // Two months may state two seasons (no season is asked of the whole), but
  // only as a window's days may: a turn, read in the order of the months.
  const stated = [...months]
    .sort((a, b) => a.dates.localeCompare(b.dates))
    .map((m) => m.year)
    .filter((y) => Number.isInteger(y));
  const years = [...new Set(stated)];
  if (years.length > 1 && notATurn(competition, stated)) {
    return { verdict: 'changed', detail: `the months state seasons that are not a turn (${stated.join(', ')})` };
  }
  const fixtures = Array.isArray(result.fixtures) ? result.fixtures.length : 0;
  const seasons = years.length > 1 ? `; the months state seasons ${years.join(' and ')}` : '';
  return { verdict: 'ok', detail: `${fixtures} fixture(s) in the span ${span.start} to ${span.end}${seasons}` };
}

/** A served scoreboard response with no `events` list, or nothing. */
function envelopeProblem(parts) {
  for (const part of parts) {
    if (!part.json || typeof part.json !== 'object' || !Array.isArray(part.json.events)) {
      return 'the response has no `events` list';
    }
  }
  return undefined;
}

/**
 * What is wrong with what was SENT, read raw, or nothing. It needs no answer
 * from the adapter, so it is asked of every response that was served, also
 * when a sibling request failed and the adapter had no answer to give.
 */
function sentProblem(adapter, parts) {
  const sent = parts
    .flatMap((part) => part.json.events)
    .flatMap((e) => {
      const competitors = e?.competitions?.[0]?.competitors;
      return Array.isArray(competitors) ? competitors : [];
    });
  const rawNoId = sent.filter((c) => typeof c?.team?.id !== 'string' || !RAW_TEAM_ID.test(c.team.id));
  if (rawNoId.length > 0) {
    const first = rawNoId[0]?.team?.displayName ?? rawNoId[0]?.team?.abbreviation ?? 'unnamed';
    return `${rawNoId.length} team(s) arrived without an id (first: ${first})`;
  }
  // How the provider files a day: the adapter keeps, from a month's response,
  // the fixtures whose PROVIDER day a window asked for, so that rule is checked
  // on every dated response. A fixture filed under a day (or a month) it does
  // not kick off on, by the adapter's rule, means the rule no longer holds.
  // (This sees a fixture that is there and should not be. One that is missing
  // from its day cannot be seen from one response.)
  for (const part of parts) {
    const asked = datesOf(part.url);
    if (!/^\d{6}(\d{2})?$/.test(asked)) continue;
    for (const e of part.json.events) {
      const kickoff = new Date(e?.date);
      if (Number.isNaN(kickoff.getTime())) continue;
      const day = adapter.bucketDay(kickoff).replace(/-/g, '');
      if (!day.startsWith(asked)) {
        return `a fixture filed under ${asked} kicks off on provider day ${day}: the provider no longer files a day the way the adapter assumes`;
      }
    }
  }
  return undefined;
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
 * What is wrong with the tables the adapter read, or nothing. THREE separate
 * questions, because each can be the only one that knows:
 *   - a table marked partial: a row was left out. The batch can still call
 *     itself complete (a row the parser treats as "not a team" is left out
 *     without being counted as refused);
 *   - a batch that is not complete: a row or a whole TABLE was refused (a
 *     second table for a group already read, a name that is no group). A
 *     refused table leaves the survivors whole and unmarked;
 *   - an expected group that is not there.
 * (A table outside an expected list is not read by the parser at all, so it
 * lands in the second question: a child that did not become a table.)
 * Only "complete, no partial table, nothing missing" is healthy. An adapter
 * that does not say whether the batch is complete has not said it is.
 */
export function adapterTablesProblem({ complete, tables, expected = [], sent }) {
  const partial = tables.filter((t) => t.partial).map((t) => t.group);
  if (partial.length > 0) {
    // A lettered group is named as the product names it; any other table by its key.
    const named = partial.map((key) => (/^[A-Z]$/.test(key) ? `Group ${key}` : `table ${key}`));
    return `the adapter could not read every row of ${named.join(', ')}`;
  }
  if (complete !== true) return `the adapter could not read every table (${sent} sent, ${tables.length} read)`;
  const got = new Set(tables.map((t) => t.group));
  const missing = expected.filter((g) => !got.has(g));
  if (missing.length > 0) return `the adapter expects group(s) ${missing.join(', ')} and did not get them`;
  return undefined;
}

/**
 * Invariants of a served standings payload, read RAW (see the header). What
 * must hold for any table shape: every table has a list of rows, and every row
 * names its team by id and states each statistic the parser requires exactly
 * once, as a number. Nothing is skipped for being malformed: malformed IS the
 * finding.
 */
function checkStandings(core, body, adapter, result, competition) {
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
  const expectNone = shapeOf(core, competition) === 'none';
  // Absence is a finding, except where no table is expected; and there, a
  // table is.
  if (rows === 0) {
    if (!expectNone) return { verdict: 'changed', detail: 'the response holds no table rows' };
    // Healthy only if the product's own reader accepted the answer as an empty one.
    return Array.isArray(result) && result.length === 0
      ? { verdict: 'ok', detail: 'no table (none expected: knockout only)' }
      : { verdict: 'changed', detail: 'no table rows, and the adapter did not read the response as an empty answer' };
  }
  if (expectNone) {
    return { verdict: 'changed', detail: `${rows} row(s) in ${tables.length} table(s), where no table was expected` };
  }

  // Rows can be well formed and still not be a table the product can show, so
  // the product's own parser is asked, for every competition: it must have
  // read the payload, and whole.
  const expected = adapter.expectedStandingsGroups ?? [];
  if (!Array.isArray(result) || result.length === 0) {
    return { verdict: 'changed', detail: 'the adapter could not read the tables' };
  }
  const unread = adapterTablesProblem({
    complete: core.fetchMeta(result)?.complete,
    tables: result,
    expected,
    sent: tables.length,
  });
  if (unread) return { verdict: 'changed', detail: unread };
  return { verdict: 'ok', detail: `${rows} row(s) in ${tables.length} table(s)` };
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
  bodyDeadlineMs = BODY_DEADLINE_MS,
} = {}) {
  const rows = [];
  // A 403/429 is the provider speaking to this RUNNER, not to one competition:
  // once it is said, nothing more is asked in this run.
  let throttled = false;
  for (const competition of competitions) {
    /** What the adapter asked during the current call, and what came back. */
    let seen = [];
    const recording = async (input, init) => {
      const entry = { url: String(input), status: undefined, copy: undefined, unread: undefined };
      seen.push(entry);
      const res = await fetchImpl(input, init);
      // Known from the headers. Whatever happens to the body cannot take it back.
      entry.status = res.status;
      if (!res.ok) {
        // The adapter does not read an error body, so no copy is made: a
        // clone's two branches only finish cancelling TOGETHER, and a branch
        // nobody reads would hold the other one's cancel forever. The body is
        // read from the response itself, after the adapter is done with it.
        entry.unread = res;
      } else if (typeof res.clone === 'function') {
        // The adapter reads its branch to the end or cancels it at the same
        // limit, so the two finish together.
        entry.copy = readCopy(core, res.clone(), core.MAX_RESPONSE_BYTES);
      }
      // The provider's response, untouched: status, headers, body stream.
      return res;
    };
    const adapter = new core.EspnAdapter({ competition, enrichGroups: false, fetchImpl: recording });
    const today = isoDay(now);
    const bundled = core.bundleApplies(competition);
    // The span the bracket, `next` and the countdown read: the bundle's own.
    const span = bundled ? core.knockoutWindow() : null;
    /** The questions, as asked of an adapter: the real one, or one replaying what was served. */
    const askOf = (a) => ({
      live: () => a.fetchLive(),
      day: () => a.fetchByDate(today),
      // The live read's call: across a season turn (core `getLiveRead`).
      window: () => a.fetchWindow(isoDay(shiftDay(now, -1)), isoDay(shiftDay(now, 1)), { acrossSeasons: true }),
      // Strict, as the bracket, `next` and the countdown ask it.
      knockout: () => a.fetchWindow(span.start, span.end),
      // Discovery's own call: it CHOOSES the requests (a strict window per
      // calendar month of its span). What it returns is reported, never judged
      // as the months' answer: each month is judged by its own window.
      discovery: () => core.getScheduleAhead(a, now),
      standings: () => a.fetchStandings(),
    });
    const calls = askOf(adapter);
    for (const { request, bundleOnly, offBundleOnly } of CANARY_QUESTIONS) {
      if (bundleOnly && !span) continue;
      if (offBundleOnly && bundled) continue;
      const call = calls[request];
      if (throttled) {
        rows.push({ competition, request, url: '', requests: 0, verdict: 'blocked', detail: 'not asked: the provider throttled this runner earlier in the run' });
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
      // Every response the question took is read and judged. An error body
      // abandoned at the deadline stays open behind its reader until the
      // process exits; nothing waits on it, and no verdict depends on it.
      const parts = [];
      for (const sent of seen) {
        const reading = sent.unread ? readCopy(core, sent.unread, ERROR_BODY_BYTES) : sent.copy;
        const copy = reading
          ? await within(reading, bodyDeadlineMs, { failed: 'the body did not finish in time' })
          : undefined;
        parts.push({ url: sent.url, ...judgePart(core, sent, copy, failure) });
      }
      const wrong = firstOf(parts, SEEN_WRONG);
      const unseen = firstOf(parts, NOT_SEEN);
      // A request is named past one request, and always for discovery: its
      // requests are calendar months, and the month is where the finding is.
      const which = (part) =>
        parts.length > 1
          ? ` (${datesOf(part.url) || 'no dates'}, 1 of ${parts.length} requests)`
          : request === 'discovery'
            ? ` (${datesOf(part.url) || 'no dates'})`
            : '';
      const beside = unseen ? `; another request was ${unseen.verdict} (${unseen.detail})` : '';
      let verdict;
      let detail;
      if (parts.length === 0) {
        // The call asked for nothing and has no answer.
        verdict = 'unreachable';
        detail = String(failure?.message ?? 'no response');
      } else if (wrong) {
        verdict = wrong.verdict;
        detail = `${wrong.detail}${which(wrong)}${beside}`;
      } else if (unseen) {
        // The adapter had no answer to give for the question as asked. What
        // WAS served is still judged, and by the same code as a whole answer:
        // a defect in it is a finding whatever happened to its sibling.
        const served = parts.filter((part) => part.verdict === 'ok');
        // Discovery's served months are judged one at a time, each by its own
        // window (which names the month): never by asking discovery again.
        const seen =
          request === 'standings' || served.length === 0
            ? undefined
            : request === 'discovery'
              ? (await discoveryMonths(core, competition, served, which)).problem
              : await servedProblem(core, competition, askOf, request, served);
        verdict = seen ? 'changed' : unseen.verdict;
        detail = seen ? `${seen}${beside}` : `${unseen.detail}${which(unseen)}`;
      } else if (request === 'standings') {
        ({ verdict, detail } = checkStandings(core, parts[0].json, adapter, result, competition));
      } else if (request === 'discovery') {
        // `result` is discovery's own object, not a scoreboard answer: the
        // months are judged by their own windows, then its account of the whole.
        ({ verdict, detail } = await judgeDiscovery(core, competition, parts, result, which, core.scheduleSpan(adapter, now)));
      } else if (!Array.isArray(result)) {
        // Served, but the adapter could not turn it into fixtures at all.
        verdict = 'changed';
        detail = parts.every((part) => Array.isArray(part.json?.events))
          ? `the adapter refused the payload (${failure?.message ?? 'no reason given'})`
          : 'the response has no `events` list';
      } else {
        ({ verdict, detail } = checkScoreboard(core, adapter, parts, result));
      }
      // Discovery's row says how many months it asked and what discovery said
      // of its own answer, whatever the verdict: a month refused, throttled or
      // unreadable leaves the whole degraded or not whole, and the row says so.
      if (request === 'discovery' && parts.length > 0) {
        detail = `${detail}; requests: ${seen.length}; ${discoveryState(result)}`;
      }
      const sent = seen[0];
      // Believed on any part, whatever the row's own verdict turned out to be.
      if (parts.some((part) => part.verdict === 'blocked')) throttled = true;
      rows.push({ competition, request, url: sent?.url ?? '', requests: seen.length, verdict, detail });
      if (pauseMs > 0 && sent && !throttled) await sleep(pauseMs);
    }
  }
  return { rows, red: rows.some((r) => RED.has(r.verdict)) };
}

/**
 * What a person should be told about a run that is not red: the rows the
 * canary could not see. A blocked runner makes it green and blind; that must
 * not look like a healthy feed.
 */
export function canaryWarnings(result) {
  const blocked = result.rows.filter((r) => r.verdict === 'blocked').length;
  const unreachable = result.rows.filter((r) => r.verdict === 'unreachable').length;
  if (blocked + unreachable === 0) return [];
  return [
    `${blocked + unreachable} of ${result.rows.length} questions were not answered (${blocked} blocked, ${unreachable} unreachable): the canary saw nothing of those`,
  ];
}

/** A plain-text report: one line per question (a question can take several requests), then the totals. */
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
    '| Competition | Question | Verdict | Detail |',
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
  // An annotation on the run page (GitHub Actions) or a plain line elsewhere.
  for (const warning of canaryWarnings(result)) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=ESPN canary::${warning}` : `warning: ${warning}`);
  }
  process.exit(result.red ? 1 : 0);
}
