/**
 * Pure tool handlers — the business logic behind each MCP tool, decoupled from
 * the SDK so they can be unit-tested directly. Each returns a `{ text, data }`
 * pair: `text` is the human/LLM-readable summary, `data` is the structured
 * payload embedded as JSON for agents that want to parse it.
 */
import {
  asFlavorLevel,
  fixturesByDate,
  formatDate,
  formatShareSnippet,
  formatShareTable,
  formatShareBracket,
  formatBracketList,
  bracketShareCard,
  dateShareCard,
  liveShareCard,
  EARLIER_RECORD_NOTE,
  matchNoneReadSentence,
  matchShareCard,
  matchWindowSentence,
  nationArg,
  nextHorizonSentence,
  nextNoneReadSentence,
  nextShareCard,
  tableShareCard,
  tableData,
  marketDisplayable,
  type MatchShareCard,
  type NextFixtureResult,
  tableKeyArg,
  verdictExtras,
  verdictNotice,
  verdictQualifiers,
  getBracket,
  getLiveMatches,
  cacheableKeys,
  getMarketSignals,
  resolvedValues,
  getMatchById,
  getMatchesForDate,
  getNextFixtureForTeam,
  getStandings,
  isReliableMarketSignal,
  isFinished,
  liveSourceLabel,
  localDate,
  lookupTeam,
  makeAdapter,
  makeMarketProvider,
  marketBlock,
  marketFixtureForTeam,
  marketRelevant,
  marketsCoverCompetition,
  marketScopeVerdict,
  MARKETS_SCOPE_NOTE,
  bundleApplies,
  marketSignalRendersFor,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  resolveCompetition,
  resolveMarketSource,
  resolveTz,
  t,
  type ShareSnippetOptions,
  type Stage,
  type VerdictSource,
} from '@claudinho/core';
import {
  boundedRecords,
  capSignals,
  DISCLAIMER,
  matchLine,
  matchList,
  standingsTable,
  truncationNote,
} from './format';

export interface ToolResult {
  text: string;
  data: unknown;
  /**
   * The end of `text` that a cut at a length keeps (see `toContent`): the
   * attribution, when live data served the answer, and the non-affiliation
   * disclaimer. Always a suffix of `text`. Required, so no tool can be written
   * without stating it: `disclaimed` returns it with the text it ends, and a
   * share snippet's is its footer paragraph (`snippetFooter`).
   */
  footer: string;
}

export interface CommonOpts {
  tz?: string;
  lang?: string;
  source?: string;
  /**
   * An explicit competition for this request (wins over `CLAUDINHO_COMPETITION`).
   * Not yet a tool argument — no schema exposes it — but it is how a caller
   * that already knows the competition hands it in.
   */
  competition?: string;
  /** Commentary flair level: 'off' | 'subtle' | 'full' (default: full). */
  flavor?: string;
  /** Injected adapter (tests). Defaults to makeAdapter(source). */
  adapter?: ProviderAdapter;
  /** Injected market provider (tests). Defaults to makeMarketProvider(). */
  marketProvider?: MarketProvider;
  /** Injected clock (tests) for time-dependent gates (live windows, relevance). */
  now?: Date;
}

/**
 * Server-lifetime adapters, keyed by source. A stdio MCP session serves many
 * tool calls, and constructing a fresh adapter per call re-fetched the group
 * map (a standings request) every time. Freshness is bounded inside the
 * adapter itself: the standings fetch is shared for ~30s, then re-fetched, so
 * a long-lived session never serves stale tables.
 */
const adapters = new Map<string, ProviderAdapter>();

/** The adapter already resolved for a request, keyed by that request's args object. */
const perRequest = new WeakMap<object, ProviderAdapter>();

/**
 * THE SERVER'S EDGE: the adapter for a request, and with it the competition
 * the whole request is for.
 *
 * This is the one place the server lets the environment decide the
 * competition, and it decides ONCE per request: the answer is remembered
 * against the request's args, so every helper a tool calls gets the same
 * adapter — and `competitionOf` the same competition — however many times it
 * asks. Nothing else in the server resolves a competition.
 */
export function resolveAdapter(args: CommonOpts): ProviderAdapter {
  if (args.adapter) return args.adapter;
  const resolved = perRequest.get(args);
  if (resolved) return resolved;
  const source = args.source ?? 'espn';
  const competition = resolveCompetition(args.competition);
  // Keyed by source AND competition: an adapter serves exactly one
  // competition, so a cache keyed by source alone would pin the first
  // competition seen for the whole session.
  const key = `${source}::${competition}`;
  let adapter = adapters.get(key);
  if (!adapter) {
    adapter = makeAdapter(source, { competition });
    adapters.set(key, adapter);
  }
  perRequest.set(args, adapter);
  return adapter;
}

/** The competition a request is for: its adapter's. */
function competitionOf(args: CommonOpts): string {
  return resolveAdapter(args).competition;
}

function resolveMarketProvider(args: CommonOpts): MarketProvider {
  return args.marketProvider ?? makeMarketProvider(undefined, competitionOf(args));
}

/**
 * Header for a market read, dated. The date is agent UX: "South Korea (Jun 18)"
 * is the one token that stops a model conflating a future fixture's read (or
 * its null) with the match being played right now — they skim like we do.
 */
function marketHeader(m: Match, args: CommonOpts): string {
  const when = formatDate(m.kickoff, { tz: args.tz, locale: args.lang });
  return `${m.home.flag} ${m.home.name} vs ${m.away.name} ${m.away.flag} (${when})`;
}

function marketText(m: Match, sig: MarketSignal, args: CommonOpts): string {
  return `${marketHeader(m, args)}\n${marketBlock(sig, m).join('\n')}`;
}


/** Null/suppressed-signal text, specific about WHY when the match is finished. */
function noSignalText(m: Match, args: CommonOpts, now: Date): string {
  if (!marketsCoverCompetition(competitionOf(args))) {
    return `${marketHeader(m, args)} — ${MARKETS_SCOPE_NOTE}`;
  }
  if (marketRelevant(m, now)) return `No reliable market signal for ${marketHeader(m, args)}.`;
  // "has finished" only when a live overlay confirmed it; a static fixture
  // whose window merely lapsed gets the honest, hedged variant.
  const verb = isFinished(m.status) ? 'has finished' : 'appears to have finished';
  return `${marketHeader(m, args)} ${verb} — market signals are pre-match and in-play reads.`;
}

/** Structured, link-free market payload. `url` is always null in v1. */
function marketData(sig: MarketSignal) {
  return {
    matchId: sig.matchId,
    source: sig.source,
    asOf: sig.asOf,
    fetchedAt: sig.fetchedAt,
    market: { id: sig.sourceMarketId ?? null, url: null },
    outcomes: sig.outcomes,
    favorite: sig.favorite ?? null,
    liquidity: sig.liquidity ?? null,
    stale: sig.stale,
    ambiguous: sig.ambiguous,
    informationalOnly: true,
  };
}

/** Default-on; off when CLAUDINHO_MARKETS=off (mirrors the CLI opt-out). */
function marketsEnabled(): boolean {
  return (process.env.CLAUDINHO_MARKETS ?? '').toLowerCase() !== 'off';
}

// In-process positive/negative cache — the MCP server is long-running, so this
// avoids re-fetching the same matches (incl. the many with no market) on every
// get_today/get_match. Injected providers (tests) bypass it.
interface MarketMemEntry {
  at: number;
  signal: MarketSignal | null;
}
interface MarketSignalsResult {
  readonly signals: Map<string, MarketSignal>;
  readonly complete: boolean;
}
type MarketProviderFactory = (source: string | undefined, competition: string) => MarketProvider;
const marketMem = new Map<string, MarketMemEntry>();
const MEM_POSITIVE_TTL = 10 * 60_000;
const MEM_NEGATIVE_TTL = 3 * 60_000;
// Default-on surfaces must never block; the dedicated tool may wait longer.
const DEFAULT_ON_MARKET_OPTS = { deadlineMs: 2000, timeoutMs: 2500 };
const MARKETS_TOOL_OPTS = { deadlineMs: 12000, timeoutMs: 6000 };

function memKey(competition: string, id: string): string {
  return `polymarket:${competition}:${id}`;
}

/**
 * Market signals with an in-process cache + fetch deadline so optional
 * enrichment never slows get_today/get_match. Injected providers bypass it.
 */
export async function cachedMarketSignals(
  args: CommonOpts,
  matches: readonly Match[],
  providerFactory: MarketProviderFactory = makeMarketProvider,
): Promise<MarketSignalsResult> {
  if (args.marketProvider) {
    const batch = await getMarketSignals(args.marketProvider, matches);
    return { signals: resolvedValues(batch), complete: batch.complete };
  }
  const source = resolveMarketSource();
  const competition = competitionOf(args);
  if (source !== 'polymarket') {
    const batch = await getMarketSignals(
      providerFactory(source, competition),
      matches,
      DEFAULT_ON_MARKET_OPTS,
    );
    return { signals: resolvedValues(batch), complete: batch.complete };
  }
  const now = Date.now();
  const result = new Map<string, MarketSignal>();
  const miss: Match[] = [];
  for (const m of matches) {
    const e = marketMem.get(memKey(competition, m.id));
    const ttl = e?.signal ? MEM_POSITIVE_TTL : MEM_NEGATIVE_TTL;
    const fresh = e && now - e.at <= ttl;
    // A cached signal is keyed by match id, but the FIXTURE behind that id can
    // change — a knockout slot degrading back to a placeholder — so a hit has to
    // be re-checked against the match in hand. The CLI has done this since
    // 0.8.12 (`marketSignalRendersFor`); MCP accepted on the id alone, so a
    // changed pairing both hid the market line and suppressed the refetch that
    // would have produced a real one, for the full ten-minute TTL.
    if (fresh && (!e.signal || marketSignalRendersFor(m, e.signal))) {
      if (e.signal) result.set(m.id, e.signal);
    } else {
      miss.push(m);
    }
  }
  let complete = true;
  if (miss.length > 0) {
    const batch = await getMarketSignals(
      providerFactory('polymarket', competition),
      miss,
      DEFAULT_ON_MARKET_OPTS,
    );
    const fetched = resolvedValues(batch);
    complete = batch.complete;
    // Cache only ids whose verdict may be remembered (see `isCacheable`): a
    // conclusion drawn from a payload we READ, including a stable ambiguity.
    // A shape we could not read and a deadline that expired are retried.
    for (const id of cacheableKeys(batch)) {
      marketMem.set(memKey(competition, id), { at: now, signal: fetched.get(id) ?? null });
    }
    for (const [id, s] of fetched) result.set(id, s);
  }
  return { signals: result, complete };
}

/** Strict-gated market payloads plus whether every relevant match was checked. */
async function reliableMarketData(
  args: CommonOpts,
  matches: readonly Match[],
): Promise<{
  data: Record<string, ReturnType<typeof marketData>> | undefined;
  complete: boolean;
}> {
  if (!marketsEnabled()) return { data: undefined, complete: true };
  const now = args.now ?? new Date();
  // Market reads are pre-match/in-play artifacts — never fetch/show for
  // finished matches (a resolved "favorite" reads as a bug, not information).
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return { data: undefined, complete: true };
  const result = await cachedMarketSignals(args, relevant);
  const out: Record<string, ReturnType<typeof marketData>> = {};
  for (const m of relevant) {
    const s = result.signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(m, s)) {
      out[m.id] = marketData(s);
    }
  }
  return {
    data: Object.keys(out).length > 0 ? out : undefined,
    complete: result.complete,
  };
}

/** Flavor from the call arg, else the server env, else the default (full). */
function fmtOpts(args: CommonOpts) {
  return {
    tz: args.tz,
    locale: args.lang,
    flavor: asFlavorLevel(args.flavor ?? process.env.CLAUDINHO_FLAVOR),
  };
}

/**
 * A tool's text: the body, then its footer (the attribution, when live data
 * actually served the result, and the disclaimer). The footer is returned on
 * its own too, so a text cut at a length keeps it (`toContent`).
 */
function disclaimed(body: string, source?: string, lang?: string): { text: string; footer: string } {
  const live = source
    ? `\n${t(lang, 'live.data', { source: liveSourceLabel(source) })}`
    : '';
  const footer = `${live}\n\n${DISCLAIMER}`;
  return { text: `${body}${footer}`, footer };
}

/**
 * A tool's text with the sentences that QUALIFY it (core `verdictQualifiers`:
 * the read was not whole) said FIRST, the body kept. First, because a tool's
 * text is cut at a fixed length from the end: a verdict at the tail would be
 * the first thing a long answer lost. Nothing is added when the result states
 * no qualifier, or states a replacement (which stands instead of the body).
 */
function qualified(body: string, result: VerdictSource, lang?: string): string {
  const qualifiers = verdictQualifiers(result, lang);
  return qualifiers.length > 0 ? `${qualifiers.join('\n')}\n\n${body}` : body;
}

/**
 * A share snippet's footer, with the blank line before it: its last
 * paragraph. Core's share formatters end every snippet with ONE footer
 * paragraph (the attribution, the disclaimer with the hashtag, the run cue)
 * that holds no blank line, so a cut keeps all of it.
 */
function snippetFooter(snippet: string): string {
  const at = snippet.lastIndexOf('\n\n');
  return at === -1 ? '' : snippet.slice(at);
}

/** today: fixtures for a date (default: today), with live overlay. */
export async function toolGetToday(
  args: { date?: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const date = args.date ?? localDate((args.now ?? new Date()).toISOString(), args.tz);
  // The viewer's zone, the one the day is filed by below: the read judges
  // "nothing on this date" in it too.
  const day = await getMatchesForDate(adapter, date, resolveTz(args.tz));
  const { matches, degraded, source } = day;
  const todays = fixturesByDate(date, matches, args.tz);
  const opts = fmtOpts(args);
  // A verdict (between editions) stands instead of the empty line.
  let text = `Matches on ${date}:\n${matchList(todays, verdictNotice(day, args.lang) ?? 'No matches scheduled.', opts)}`;
  // Degraded ⇒ the live overlay failed; these are static fixtures with no live scores.
  if (degraded) text += '\n\n(Live scores unavailable — showing the bundled schedule.)';
  const market = await reliableMarketData(args, todays);
  if (!market.complete) {
    text += '\n\n(Market data unavailable or incomplete — not all fixtures were checked.)';
  }
  const shownToday = boundedRecords(todays);
  return {
    ...disclaimed(text, source, args.lang),
    data: {
      date,
      degraded,
      source: source ?? null,
      // ONE bounded view, so `count`, `matches` and the signal set cannot
      // disagree about the same payload. `count` is the TRUE total; bounding
      // only the TEXT would leave structuredContent unbounded, and that is
      // model context too — a repeated-record payload measured ~5 MB there.
      count: shownToday.total,
      truncated: shownToday.truncated,
      matches: shownToday.items,
      marketComplete: market.complete,
      // Capped in step with `matches`: a signal keyed to a match that is no
      // longer in the payload is dead weight in model context.
      ...(market.data ? { marketSignals: capSignals(market.data, shownToday.items) } : {}),
      ...verdictExtras(day),
    },
  };
}

/** live: in-progress matches right now. */
export async function toolGetLive(args: CommonOpts = {}): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const live = await getLiveMatches(adapter, args.now ?? new Date());
  const { matches, degraded, source } = live;
  const opts = fmtOpts(args);
  // Degraded ⇒ the live feed failed, NOT "nothing is on". Distinguish them so the
  // agent doesn't tell the user no matches are live when the provider is unreachable.
  // A verdict (between editions) stands instead of the empty line.
  const text = degraded
    ? 'Live scores unavailable right now — could not reach the data provider.'
    : `Live now:\n${matchList(matches, verdictNotice(live, args.lang) ?? 'No matches in play right now.', opts)}`;
  const shownLive = boundedRecords(matches);
  return {
    ...disclaimed(text, source, args.lang),
    data: {
      degraded,
      source: source ?? null,
      count: shownLive.total,
      truncated: shownLive.truncated,
      matches: shownLive.items,
      ...verdictExtras(live),
    },
  };
}

/** match: a single fixture by id, with live overlay for that day. */
export async function toolGetMatch(
  args: { id: string } & CommonOpts,
): Promise<ToolResult> {
  // ±1-day window fetch: the provider buckets scoreboard days in its own zone
  // (ESPN: US/Eastern), so fetching only the fixture's UTC date can miss its
  // live/final state and silently render the match as still scheduled.
  const adapter = resolveAdapter(args);
  const found = await getMatchById(adapter, args.id, args.now);
  const { match, degraded, source: liveSource } = found;
  if (!match) {
    // A verdict first; then the span a whole read searched; an outage is
    // never "no such match". What qualifies the answer (a read that was not
    // whole) is said before it.
    const msg =
      verdictNotice(found, args.lang) ??
      matchWindowSentence(found, args.id, args.lang) ??
      matchNoneReadSentence(found, args.id, args.lang) ??
      (degraded
        ? `Couldn't reach the data provider — match ${args.id} could not be looked up.`
        : `No match found with id ${args.id}.`);
    return {
      ...disclaimed(qualified(msg, found, args.lang), undefined, args.lang),
      // "Not available for this competition" is not "no such id": the verdict
      // the text states is in the structured answer too, and so is an outage.
      data: {
        match: null,
        degraded,
        ...(found.window ? { window: found.window } : {}),
        ...verdictExtras(found),
      },
    };
  }
  const opts = fmtOpts(args);
  const now = args.now ?? new Date();
  let marketSignal: MarketSignal | undefined;
  let marketComplete = true;
  if (marketsEnabled() && marketRelevant(match, now)) {
    const market = await cachedMarketSignals(args, [match]);
    marketComplete = market.complete;
    const s = market.signals.get(match.id);
    if (s && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(match, s)) marketSignal = s;
  }
  const base = matchLine(match, opts);
  let text = marketSignal ? `${base}\n${marketBlock(marketSignal, match).join('\n')}` : base;
  // Degraded ⇒ the live overlay failed; this is the static fixture, no live
  // state. Off the bundled competition there is no static fixture: it is the
  // provider's own earlier record, whose state could not be refreshed.
  if (degraded) {
    text += found.earlierRecord
      ? `\n\n${EARLIER_RECORD_NOTE}`
      : '\n\n(Live state unavailable — showing the scheduled fixture.)';
  }
  if (!marketComplete) {
    text += '\n\n(Market data unavailable or incomplete — this match was not checked.)';
  }
  return {
    ...disclaimed(qualified(text, found, args.lang), liveSource, args.lang),
    data: {
      degraded,
      source: liveSource ?? null,
      match,
      marketComplete,
      marketSignal: marketSignal ? marketData(marketSignal) : null,
      ...verdictExtras(found),
    },
  };
}

/** standings: one group table, or all of them. */
export async function toolGetStandings(
  args: { group?: string } & CommonOpts,
): Promise<ToolResult> {
  // Authoritative cumulative standings from the provider. A degraded bundled
  // roster is valid only for a declared compatible scope; open-scope outages
  // stay empty rather than borrowing World Cup teams.
  const result = await getStandings(resolveAdapter(args), args.group);
  const { tables, degraded, source } = result;

  // Preserve the structured shape: { group, standings: StandingRow[] }.
  const boundedTables = boundedRecords(tables);
  const shaped = boundedTables.items.map(tableData);

  if (shaped.length === 0) {
    const g = args.group?.toUpperCase();
    const msg = degraded
      ? t(args.lang, 'standings.unavailable')
      : g
        ? t(args.lang, 'standings.none', { group: g })
        : t(args.lang, 'standings.empty');
    return {
      ...disclaimed(msg, source, args.lang),
      data: { degraded, source: source ?? null, tables: args.group ? null : [], ...verdictExtras(result) },
    };
  }

  // Tables are missing: what is shown is not the whole competition. Said
  // FIRST: a tool's text is cut at a fixed length from the end, and a verdict
  // at the tail would be the first thing a long answer lost. (The footer is
  // kept by the cut: `toContent`.) In parentheses, as it always was here.
  const qualifiers = verdictQualifiers(result, args.lang);
  let text = shaped
    .map((tb) => {
      const block = standingsTable(tb, tb.standings);
      // A table the provider served but we could not read in full says so
      // (A01), BEFORE its table for the same reason: one league table of forty
      // rows can be longer than the cut.
      return tb.partial
        ? `(${t(args.lang, 'standings.partial', { n: String(tb.partial.omitted) })})\n${block}`
        : block;
    })
    .join('\n\n');
  // Stated, not silent — the same rule the match lists follow.
  text += truncationNote(boundedTables);
  if (degraded) text += '\n\n(Live standings unavailable — showing the group roster.)';
  if (qualifiers.length > 0) text = `${qualifiers.map((q) => `(${q})`).join('\n')}\n\n${text}`;
  return {
    ...disclaimed(text, source, args.lang),
    data: {
      degraded,
      source: source ?? null,
      tables: args.group ? (shaped[0] ?? null) : shaped,
      ...verdictExtras(result),
    },
  };
}

const BRACKET_STAGES = new Set(['R32', 'R16', 'QF', 'SF', '3P', 'F']);

/** bracket: knockout tree with hybrid slot resolution. */
export async function toolGetBracket(
  args: { stage?: string } & CommonOpts,
): Promise<ToolResult> {
  const filter = args.stage?.toUpperCase();
  if (filter && !BRACKET_STAGES.has(filter)) {
    return {
      ...disclaimed(
        t(args.lang, 'bracket.unknownStage', { stage: args.stage ?? '' }),
        undefined,
        args.lang,
      ),
      data: { view: null },
    };
  }
  const bracket = await getBracket(
    resolveAdapter(args),
    filter ? { stage: filter as Stage, lang: args.lang } : { lang: args.lang },
  );
  const { view, degraded, standingsDegraded, source } = bracket;
  // A verdict that REPLACES the tree; one that qualifies it is said before it (below).
  const notice = verdictNotice(bracket, args.lang);
  if (notice) {
    // No World Cup topology off the bundle (A03). The marker is a declared
    // top-level key, like every other tool's (and still rides inside `view`,
    // where 0.10.1 put it before the schema could carry it).
    return {
      ...disclaimed(notice, undefined, args.lang),
      data: { degraded, standingsDegraded, source: null, view, ...verdictExtras(bracket) },
    };
  }
  let text = formatBracketList(view, { footer: false, locale: args.lang, tz: args.tz });
  if (degraded) {
    text += `\n\n(${t(args.lang, 'bracket.degraded')})`;
  } else if (standingsDegraded) {
    text += `\n\n(${t(args.lang, 'bracket.standingsDegraded')})`;
  }
  return {
    ...disclaimed(qualified(text, bracket, args.lang), source, args.lang),
    data: { degraded, standingsDegraded, source: source ?? null, view, ...verdictExtras(bracket) },
  };
}

/**
 * Text body for the `standings://{group}` resource. Shares the `get_standings`
 * path so it carries the SAME provider attribution + disclaimer — a resource that
 * served live ESPN data must still say `Live data: ESPN` (provider-attribution
 * constraint). Pure given an adapter, so it's unit-testable.
 */
export async function standingsResourceText(
  group: string,
  adapter: ProviderAdapter,
): Promise<string> {
  // A resource URI is typed by anyone: what is not a table key is refused
  // here, before a request, with the grammar a key has.
  const g = tableKeyArg(group);
  if (!g) {
    return disclaimed(
      'Not a table. Use standings://A for a group, or a key such as standings://A1, standings://A-B or standings://LEAGUE.',
      undefined,
    ).text;
  }
  const { tables, degraded, source } = await getStandings(adapter, g);
  const tb = tables[0];
  let text = tb
    ? standingsTable(tb, tb.rows)
    : degraded
      ? 'Live standings unavailable.'
      : `No group ${g}.`;
  // Before the table, as in `get_standings`: a reader meets what qualifies the
  // rows before the rows.
  if (tb?.partial) text = `(${t(undefined, 'standings.partial', { n: String(tb.partial.omitted) })})\n${text}`;
  if (degraded && tb) text += '\n\n(Live standings unavailable — showing the group roster.)';
  return disclaimed(text, source).text;
}

/** next_fixture: a team's next match, live-resolved across the knockout phase. */
/** "Did you mean" for a name that matched more than one team, as `get_team` says it. */
function ambiguousText(query: string, teams: readonly { name: string; code: string }[]): string {
  return `"${query}" is ambiguous. Did you mean: ${teams.map((t) => `${t.name} (${t.code})`).join(', ')}?`;
}

/**
 * What a `next` answer names: the club it resolved to, the query as asked,
 * or the nation's code (the World Cup).
 */
function nextTeamLabel(next: NextFixtureResult, fallback: string): string {
  return next.team?.name ?? next.query ?? fallback;
}

export async function toolGetNextFixture(
  args: { team: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  // The World Cup: a nation's code, or a name resolved against the bundled
  // roster (`nationArg`); a name that is no single nation is answered without
  // a request (the candidates, or no such team). Off the bundled competition
  // the query goes through as asked: core resolves the club against the
  // competition's roster and the schedule ahead.
  const asked = bundleApplies(adapter.competition) ? nationArg(args.team) : { code: args.team };
  const code = 'code' in asked ? asked.code : args.team;
  // Overlay the live knockout window so a confirmed R32+ tie resolves: the
  // bundled knockout slots are placeholders, so a static lookup goes blind once
  // a team's group games pass (it would answer "no upcoming fixture" even after
  // ESPN confirmed the tie). Fails closed to the static result on a feed outage.
  // The caller's clock is still threaded for deterministic tests.
  const next = 'code' in asked ? await getNextFixtureForTeam(adapter, code, args.now ?? new Date()) : asked.answer;
  const { fixture, degraded, source } = next;
  const label = nextTeamLabel(next, code);
  // The answer's own fields beside the verdicts: who it is about, the
  // candidates of an ambiguous name, the span a whole read searched, the season.
  const about = {
    team: next.team ?? next.query ?? code,
    ...(next.candidates ? { candidates: next.candidates } : {}),
    ...(next.horizon ? { horizon: next.horizon } : {}),
    ...(next.season ? { season: next.season } : {}),
  };
  if (!fixture) {
    const msg =
      verdictNotice(next, args.lang) ??
      nextHorizonSentence(next, code, args.lang) ??
      nextNoneReadSentence(next, code, args.lang) ??
      (next.candidates ? ambiguousText(next.query ?? code, next.candidates) : undefined) ??
      (degraded
        ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${label}.`
        : `No upcoming fixture found for ${label}.`);
    return {
      // "None found" from a window that was not whole says so: it is not elimination.
      ...disclaimed(qualified(msg, next, args.lang), undefined, args.lang),
      data: { ...about, fixture: null, degraded, source: source ?? null, ...verdictExtras(next) },
    };
  }
  const opts = fmtOpts(args);
  return {
    // `source` in data mirrors the text's "Live data: …" attribution (parity
    // with CLI `next --json`); null for a static group fixture (no live source).
    ...disclaimed(qualified(`Next up for ${label}:\n${matchLine(fixture, opts)}`, next, args.lang), source, args.lang),
    data: { ...about, fixture, degraded, source: source ?? null, ...verdictExtras(next) },
  };
}

/**
 * team: resolve a nation name or code to its FIFA code, flag, and group. Pure and
 * OFFLINE (bundled roster) — the name→code resolver agents call before the tools
 * that need a 3-letter code. Returns the confident match plus any candidates.
 */
export function toolGetTeam(args: { query: string }): ToolResult {
  const { team, matches } = lookupTeam(args.query ?? '');
  const data = { query: args.query ?? '', team: team ?? null, matches, count: matches.length };
  let text: string;
  if (team) {
    text = `${team.code} — ${team.flag} ${team.name}${team.group ? ` · Group ${team.group}` : ''}`;
  } else if (matches.length > 0) {
    text = `"${args.query}" is ambiguous. Did you mean: ${matches
      .map((t) => `${t.name} (${t.code})`)
      .join(', ')}?`;
  } else {
    text = `No team found for "${args.query}". Use a nation name or 3-letter code (e.g. Mexico, MEX).`;
  }
  return { ...disclaimed(text), data };
}

/**
 * market_signal: read-only prediction-market signals for a single match (by id), a
 * team's next fixture, or all of a date's matches (default: today). Returns
 * market-implied percentages with attribution; never links, never advice.
 */
export async function toolGetMarketSignal(
  args: { matchId?: string; team?: string; date?: string } & CommonOpts,
): Promise<ToolResult> {
  const provider = resolveMarketProvider(args);
  const now = args.now ?? new Date();

  // Most specific: a single match by id — with live overlay so FT gates the
  // resolved market correctly (the static fixture's status never changes).
  if (args.matchId) {
    // The market's scope is asked BEFORE any match lookup: off it nothing is
    // read for this competition, so no request is made to find the match.
    const scope = marketScopeVerdict(competitionOf(args), 0);
    const outOfScope = verdictNotice(scope, args.lang);
    if (outOfScope !== undefined) {
      return {
        ...disclaimed(outOfScope),
        data: {
          matchId: args.matchId,
          informationalOnly: true,
          complete: true,
          signal: null,
          ...verdictExtras(scope),
        },
      };
    }
    const found = await getMatchById(resolveAdapter(args), args.matchId);
    const { match } = found;
    const relevant = match ? marketRelevant(match, now) : false;
    const batch =
      match && relevant
        ? await getMarketSignals(provider, [match], MARKETS_TOOL_OPTS)
        : { results: new Map(), complete: true };
    const sig = match ? resolvedValues(batch).get(match.id) : undefined;
    const shown = batch.complete && match && sig && marketDisplayable(match, sig) ? sig : undefined;
    const text = !match
      ? (verdictNotice(found, args.lang) ?? `No match found with id ${args.matchId}.`)
      : !batch.complete
        ? `Market data unavailable or incomplete for ${marketHeader(match, args)} — this match could not be checked.`
      : shown
        ? marketText(match, shown, args)
        : noSignalText(match, args, now);
    return {
      ...disclaimed(text),
      data: {
        matchId: args.matchId,
        informationalOnly: true,
        complete: batch.complete,
        signal: shown ? marketData(shown) : null,
        ...verdictExtras(found),
      },
    };
  }

  // A team's current-or-next fixture. Mid-match, a team query means the match
  // being played — `nextFixtureForTeam` alone would skip it the moment kickoff
  // passed and silently answer about a future fixture's (often gated) market.
  if (args.team) {
    const code = args.team.toUpperCase();
    // Live-confirmed selection: handles extra time past the static window AND
    // early FTs inside it (the static fixture's status is forever SCHEDULED).
    const picked = await marketFixtureForTeam(resolveAdapter(args), code, now);
    const { match: fixture, degraded } = picked;
    const relevant = fixture ? marketRelevant(fixture, now) : false;
    const batch =
      fixture && relevant
        ? await getMarketSignals(provider, [fixture], MARKETS_TOOL_OPTS)
        : { results: new Map(), complete: true };
    const sig = fixture ? resolvedValues(batch).get(fixture.id) : undefined;
    const shown =
      batch.complete && fixture && sig && marketDisplayable(fixture, sig) ? sig : undefined;
    const text = !fixture
      ? (verdictNotice(picked, args.lang) ??
        (degraded
          ? `Live feed unavailable — can't resolve ${code}'s next fixture right now.`
          : `No upcoming fixture found for ${code}.`))
      : !batch.complete
        ? `Market data unavailable or incomplete for ${marketHeader(fixture, args)} — this match could not be checked.`
      : shown
        ? marketText(fixture, shown, args)
        : noSignalText(fixture, args, now);
    return {
      ...disclaimed(text),
      data: {
        team: code,
        matchId: fixture?.id ?? null,
        degraded,
        informationalOnly: true,
        complete: batch.complete,
        signal: shown ? marketData(shown) : null,
        ...verdictExtras(picked),
      },
    };
  }

  // A date's matches (default: today).
  const date = args.date ?? localDate(now.toISOString(), args.tz);
  const { matches } = await getMatchesForDate(resolveAdapter(args), date, resolveTz(args.tz));
  const todays = fixturesByDate(date, matches, args.tz).filter((m) => marketRelevant(m, now));
  const batch = await getMarketSignals(provider, todays, MARKETS_TOOL_OPTS);
  const signals = resolvedValues(batch);
  const all = todays
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.match, r.signal),
    );
  // Bounded: this branch serialized one object per fixture into model context.
  const shown = boundedRecords(all);
  let text = shown.shown
    ? `Market signals on ${date}:${truncationNote(shown)}\n${shown.items
        .map(({ match, signal }) => marketText(match, signal, args))
        .join('\n\n')}`
    : // An empty result and an INCOMPLETE one are different answers. The batch
      // knows which it was — a provider outage or an expired deadline leaves it
      // `complete: false` — and collapsing to `resolvedValues` threw that away,
      // so "we could not reach the market data" rendered as the confident
      // "there is none", which is the failure this project refuses everywhere
      // else.
      !marketsCoverCompetition(competitionOf(args))
        ? `${MARKETS_SCOPE_NOTE} (${date})`
        : batch.complete
          ? `No reliable market signals on ${date}.`
          : `Market data unavailable or incomplete for ${date} — not all fixtures could be checked.`;
  if (shown.shown > 0 && !batch.complete) {
    text += `\n\nMarket data unavailable or incomplete for ${date} — not all fixtures could be checked.`;
  }
  return {
    ...disclaimed(text),
    data: {
      date,
      informationalOnly: true,
      // Self-describing: the prose says it was truncated, and so does the
      // structured payload — a consumer reading only `data` could not otherwise
      // tell 40 signals from all of them.
      count: shown.total,
      truncated: shown.truncated,
      // Stated, so a consumer reading only `data` can tell "none" from
      // "we could not check them all".
      complete: batch.complete,
      signals: shown.items.map(({ signal }) => marketData(signal)),
      // Off the markets' scope, "none" means "not read for this competition".
      ...verdictExtras(marketScopeVerdict(competitionOf(args), shown.shown)),
    },
  };
}

/** Reliable, displayable signals keyed by id for a share snippet. Off → empty. */
async function reliableSignalMap(
  args: CommonOpts,
  matches: readonly Match[],
): Promise<MarketSignalsResult> {
  if (!marketsEnabled()) return { signals: new Map(), complete: true };
  const now = args.now ?? new Date();
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return { signals: new Map(), complete: true };
  const result = await cachedMarketSignals(args, relevant);
  const out = new Map<string, MarketSignal>();
  for (const m of relevant) {
    const s = result.signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now }) && marketDisplayable(m, s)) out.set(m.id, s);
  }
  return { signals: out, complete: result.complete };
}

interface ShareArgs extends CommonOpts {
  matchId?: string;
  team?: string;
  date?: string;
  live?: boolean;
  group?: string;
  bracket?: boolean;
  knockoutStage?: string;
  style?: 'social' | 'compact';
  includeHashtag?: boolean;
  includeInstallLine?: boolean;
  includeMarkets?: boolean;
}

function shareOptions(args: ShareArgs): ShareSnippetOptions {
  return {
    style: args.style === 'compact' ? 'compact' : 'social',
    includeMarkets: marketsEnabled() && args.includeMarkets !== false,
    includeHashtag: args.includeHashtag !== false,
    includeInstallLine: args.includeInstallLine !== false,
  };
}

/**
 * A match card as a tool result. The card comes assembled from core (the same
 * builders the CLI uses), verdict included; this only serializes it — and says
 * how many records there were before this surface bounded the list.
 */
function shareResult(
  card: MatchShareCard,
  options: ShareSnippetOptions,
  /** Records BEFORE capping, so the payload can say what it dropped. */
  total = card.input.matches.length,
): ToolResult {
  const { input } = card;
  const snippet = formatShareSnippet(input, options);
  return {
    // The snippet is self-contained: it carries its own non-affiliation
    // disclaimer (and, for any market line, the "informational only" caveat +
    // attribution), so it is deliberately NOT wrapped with `disclaimed` —
    // that would duplicate the disclaimer inside a paste-ready artifact.
    text: snippet,
    footer: snippetFooter(snippet),
    data: {
      kind: card.kind,
      target: card.target,
      ...(card.team ? { team: card.team } : {}),
      ...(card.candidates ? { candidates: card.candidates } : {}),
      source: input.source ?? null,
      degraded: input.degraded ?? false,
      informationalOnly: true,
      style: options.style ?? 'social',
      snippet,
      count: total,
      truncated: total > input.matches.length,
      matches: input.matches,
      marketSignals: Object.fromEntries(
        [...(input.marketSignals ?? new Map<string, MarketSignal>())].map(([id, s]) => [
          id,
          marketData(s),
        ]),
      ),
      marketComplete: input.marketComplete ?? true,
      // The span an empty card says was searched (horizon, window): plain fields.
      ...card.span,
      // The verdict the card's note stands for (e.g. not available for this competition).
      ...card.verdict,
    },
  };
}

/**
 * share_snippet: a polished, copy-pasteable card — the same artifact as the CLI
 * `claudinho share`. Routing precedence: live > group (standings) > matchId >
 * team > date (default today). Plain text, no links; the non-affiliation
 * disclaimer and any market caveat are baked into the snippet, so the model can
 * hand `text` to the user verbatim.
 */
export async function toolGetShareSnippet(args: ShareArgs): Promise<ToolResult> {
  const options = shareOptions(args);
  // Per-call opt-out: `includeMarkets: false` skips the provider ENTIRELY (no
  // fetch) and yields no market data — not merely suppressed rendering. The env
  // opt-out (CLAUDINHO_MARKETS=off) is handled inside reliableSignalMap.
  const signalsFor = (ms: readonly Match[]): Promise<MarketSignalsResult> =>
    args.includeMarkets === false
      ? Promise.resolve({ signals: new Map(), complete: true })
      : reliableSignalMap(args, ms);

  // The competition goes on the card: off the bundle its run cue names it.
  const where = { tz: args.tz, locale: args.lang, competition: competitionOf(args) };

  // live: matches in play right now (no market enrichment, matching the CLI).
  if (args.live) {
    const live = await getLiveMatches(resolveAdapter(args), args.now ?? new Date());
    // Bounded like the date branch: a share card is returned through MCP
    // before a human ever sees it. The count is STATED, not silently lost.
    const shownLive = boundedRecords(live.matches);
    return shareResult(
      liveShareCard(live, where, {
        matches: shownLive.items,
        titleSuffix: truncationNote(shownLive),
      }),
      { ...options, includeMarkets: false },
      live.matches.length,
    );
  }

  // a group's standings table (facts only; no market lines).
  if (args.group) {
    const group = args.group.toUpperCase();
    const standings = await getStandings(resolveAdapter(args), group);
    // Capped like the structured payload beside it. Bounding `data.tables`
    // while the rendered SNIPPET came from the full list meant the surface a
    // reader actually sees was the unbounded one.
    const card = tableShareCard(standings, group, boundedRecords(standings.tables).items, args.lang, competitionOf(args));
    const snippet = formatShareTable(card.input, options);
    return {
      text: snippet,
      footer: snippetFooter(snippet),
      data: {
        kind: 'table',
        target: 'table',
        group,
        source: card.source ?? null,
        degraded: card.degraded,
        informationalOnly: true,
        snippet,
        // The structured card keeps the verdict the snippet warns about (A01).
        // (No batch verdict here: this card is always for ONE key, and a keyed
        // read that found its table carries only that table's own `partial`.)
        tables: card.tables,
      },
    };
  }

  // knockout bracket card (facts only; no market lines).
  if (args.bracket) {
    const stageFilter = args.knockoutStage?.toUpperCase();
    if (stageFilter && !BRACKET_STAGES.has(stageFilter)) {
      return {
        ...disclaimed(
          t(args.lang, 'bracket.unknownStage', { stage: args.knockoutStage ?? '' }),
          undefined,
          args.lang,
        ),
        data: { kind: 'bracket', view: null },
      };
    }
    const bracket = await getBracket(
      resolveAdapter(args),
      stageFilter
        ? { stage: stageFilter as Stage, lang: args.lang }
        : { lang: args.lang },
    );
    const card = bracketShareCard(bracket, stageFilter, args.lang, competitionOf(args));
    const snippet = formatShareBracket(card.input, { ...options, locale: args.lang, tz: args.tz });
    return {
      text: snippet,
      footer: snippetFooter(snippet),
      data: {
        kind: 'bracket',
        target: 'bracket',
        ...(card.stage ? { stage: card.stage } : {}),
        source: card.source ?? null,
        degraded: card.degraded,
        informationalOnly: true,
        snippet,
        view: card.input.view,
        ...card.verdict,
      },
    };
  }

  // a single match by id, with live overlay (±1-day window — see toolGetMatch).
  if (args.matchId) {
    const found = await getMatchById(resolveAdapter(args), args.matchId, args.now);
    const market = await signalsFor(found.match ? [found.match] : []);
    return shareResult(matchShareCard(found, args.matchId, market, where), options);
  }

  // a team's next fixture, live-resolved across the knockout phase (+ market read).
  if (args.team) {
    const adapter = resolveAdapter(args);
    // The World Cup takes a nation's code or name, resolved as get_next_fixture
    // resolves it (`nationArg`): a name that is no single nation is the
    // candidates card, or the no-such-team card, with no request. Off the
    // bundle the query goes through as asked (core resolves the club).
    const asked = bundleApplies(adapter.competition) ? nationArg(args.team) : { code: args.team };
    const code = 'code' in asked ? asked.code : args.team;
    // Overlay the live knockout window so a confirmed R32+ tie pastes too (see
    // getNextFixtureForTeam / toolGetNextFixture); fail closed on an outage.
    const next = 'code' in asked ? await getNextFixtureForTeam(adapter, code, args.now ?? new Date()) : asked.answer;
    const market = await signalsFor(next.fixture ? [next.fixture] : []);
    return shareResult(nextShareCard(next, code, market, where), options);
  }

  // a date's matches (default: today).
  const date = args.date ?? localDate((args.now ?? new Date()).toISOString(), args.tz);
  const day = await getMatchesForDate(resolveAdapter(args), date, resolveTz(args.tz));
  const todays = fixturesByDate(date, day.matches, args.tz);
  // Bounded like every other model-facing payload — a share card is
  // returned through MCP before a human ever sees it.
  const shownToday = boundedRecords(todays);
  const market = await signalsFor(shownToday.items);
  return shareResult(
    dateShareCard(
      {
        date,
        explicit: !!args.date,
        matches: shownToday.items,
        degraded: day.degraded,
        source: day.source,
        scheduleKnown: bundleApplies(competitionOf(args)),
        titleSuffix: truncationNote(shownToday),
        read: day,
      },
      market,
      where,
    ),
    options,
    todays.length,
  );
}
