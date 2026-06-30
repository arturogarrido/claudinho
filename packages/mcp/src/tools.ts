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
  getBracket,
  getLiveMatches,
  getMarketSignal,
  getMarketSignals,
  getMatchById,
  getMatchesForDate,
  getNextFixtureForTeam,
  getStandings,
  hasSaneDistribution,
  isReliableMarketSignal,
  isFinished,
  liveSourceLabel,
  localDate,
  makeAdapter,
  makeMarketProvider,
  marketBlock,
  marketFixtureForTeam,
  marketRelevant,
  marketSignalRendersFor,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  resolveCompetition,
  resolveMarketSource,
  t,
  type ShareSnippetInput,
  type ShareSnippetOptions,
  type Stage,
} from '@claudinho/core';
import { DISCLAIMER, matchLine, matchList, standingsTable } from './format';

export interface ToolResult {
  text: string;
  data: unknown;
}

export interface CommonOpts {
  tz?: string;
  lang?: string;
  source?: string;
  /** Commentary flair level: 'off' | 'subtle' | 'full' (default: full). */
  flavor?: string;
  /** Injected adapter (tests). Defaults to makeAdapter(source). */
  adapter?: ProviderAdapter;
  /** Injected market provider (tests). Defaults to makeMarketProvider(). */
  marketProvider?: MarketProvider;
  /** Injected clock (tests) for time-dependent gates (live windows, relevance). */
  now?: Date;
}

function resolveAdapter(args: CommonOpts): ProviderAdapter {
  return args.adapter ?? makeAdapter(args.source);
}

function resolveMarketProvider(args: CommonOpts): MarketProvider {
  return args.marketProvider ?? makeMarketProvider();
}

/**
 * Show a signal only if it maps cleanly, has a determinable favorite, AND still
 * matches the fixture being rendered — the last check (`marketSignalRendersFor`)
 * re-validates a cached signal against the current Match so it can't print
 * against a degraded knockout placeholder (display labels come from the Match).
 */
function marketDisplayable(match: Match, sig: MarketSignal): boolean {
  return (
    marketSignalRendersFor(match, sig) &&
    !sig.ambiguous &&
    sig.favorite != null &&
    hasSaneDistribution(sig.outcomes)
  );
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
async function cachedMarketSignals(
  args: CommonOpts,
  matches: Match[],
): Promise<Map<string, MarketSignal>> {
  if (args.marketProvider) return (await getMarketSignals(args.marketProvider, matches)).signals;
  const source = resolveMarketSource();
  if (source !== 'polymarket') {
    return (await getMarketSignals(makeMarketProvider(source), matches, DEFAULT_ON_MARKET_OPTS))
      .signals;
  }
  const competition = resolveCompetition();
  const now = Date.now();
  const result = new Map<string, MarketSignal>();
  const miss: Match[] = [];
  for (const m of matches) {
    const e = marketMem.get(memKey(competition, m.id));
    const ttl = e?.signal ? MEM_POSITIVE_TTL : MEM_NEGATIVE_TTL;
    if (e && now - e.at <= ttl) {
      if (e.signal) result.set(m.id, e.signal);
    } else {
      miss.push(m);
    }
  }
  if (miss.length > 0) {
    const { signals: fetched, checked } = await getMarketSignals(
      makeMarketProvider('polymarket'),
      miss,
      DEFAULT_ON_MARKET_OPTS,
    );
    // Cache only DEFINITIVELY-checked ids; errored/skipped matches are retried.
    for (const id of checked) {
      marketMem.set(memKey(competition, id), { at: now, signal: fetched.get(id) ?? null });
    }
    for (const [id, s] of fetched) result.set(id, s);
  }
  return result;
}

/** Strict-gated market payloads keyed by matchId, or undefined when none/off. */
async function reliableMarketData(
  args: CommonOpts,
  matches: Match[],
): Promise<Record<string, ReturnType<typeof marketData>> | undefined> {
  if (!marketsEnabled()) return undefined;
  const now = args.now ?? new Date();
  // Market reads are pre-match/in-play artifacts — never fetch/show for
  // finished matches (a resolved "favorite" reads as a bug, not information).
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return undefined;
  const signals = await cachedMarketSignals(args, relevant);
  const out: Record<string, ReturnType<typeof marketData>> = {};
  for (const m of relevant) {
    const s = signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(m, s)) {
      out[m.id] = marketData(s);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Flavor from the call arg, else the server env, else the default (full). */
function fmtOpts(args: CommonOpts) {
  return {
    tz: args.tz,
    locale: args.lang,
    flavor: asFlavorLevel(args.flavor ?? process.env.CLAUDINHO_FLAVOR),
  };
}

function withDisclaimer(text: string, source?: string, lang?: string): string {
  // Attribute the live-data provider when live data actually served the result.
  const live = source
    ? `\n${t(lang, 'live.data', { source: liveSourceLabel(source) })}`
    : '';
  return `${text}${live}\n\n${DISCLAIMER}`;
}

/** today: fixtures for a date (default: today), with live overlay. */
export async function toolGetToday(
  args: { date?: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches, degraded, source } = await getMatchesForDate(adapter, date);
  const todays = fixturesByDate(date, matches, args.tz);
  const opts = fmtOpts(args);
  let text = `Matches on ${date}:\n${matchList(todays, 'No matches scheduled.', opts)}`;
  // Degraded ⇒ the live overlay failed; these are static fixtures with no live scores.
  if (degraded) text += '\n\n(Live scores unavailable — showing the bundled schedule.)';
  const marketSignals = await reliableMarketData(args, todays);
  return {
    text: withDisclaimer(text, source, args.lang),
    data: {
      date,
      degraded,
      source: source ?? null,
      count: todays.length,
      matches: todays,
      ...(marketSignals ? { marketSignals } : {}),
    },
  };
}

/** live: in-progress matches right now. */
export async function toolGetLive(args: CommonOpts = {}): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const { matches, degraded, source } = await getLiveMatches(adapter);
  const opts = fmtOpts(args);
  // Degraded ⇒ the live feed failed, NOT "nothing is on". Distinguish them so the
  // agent doesn't tell the user no matches are live when the provider is unreachable.
  const text = degraded
    ? 'Live scores unavailable right now — could not reach the data provider.'
    : `Live now:\n${matchList(matches, 'No matches in play right now.', opts)}`;
  return {
    text: withDisclaimer(text, source, args.lang),
    data: { degraded, source: source ?? null, count: matches.length, matches },
  };
}

/** match: a single fixture by id, with live overlay for that day. */
export async function toolGetMatch(
  args: { id: string } & CommonOpts,
): Promise<ToolResult> {
  // ±1-day window fetch: the provider buckets scoreboard days in its own zone
  // (ESPN: US/Eastern), so fetching only the fixture's UTC date can miss its
  // live/final state and silently render the match as still scheduled.
  const { match, degraded, source: liveSource } = await getMatchById(resolveAdapter(args), args.id);
  if (!match) {
    return { text: withDisclaimer(`No match found with id ${args.id}.`), data: { match: null } };
  }
  const opts = fmtOpts(args);
  const now = args.now ?? new Date();
  let marketSignal: MarketSignal | undefined;
  if (marketsEnabled() && marketRelevant(match, now)) {
    const s = (await cachedMarketSignals(args, [match])).get(match.id);
    if (s && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(match, s)) marketSignal = s;
  }
  const base = matchLine(match, opts);
  let text = marketSignal ? `${base}\n${marketBlock(marketSignal, match).join('\n')}` : base;
  // Degraded ⇒ the live overlay failed; this is the static fixture, no live state.
  if (degraded) text += '\n\n(Live state unavailable — showing the scheduled fixture.)';
  return {
    text: withDisclaimer(text, liveSource, args.lang),
    data: {
      degraded,
      source: liveSource ?? null,
      match,
      marketSignal: marketSignal ? marketData(marketSignal) : null,
    },
  };
}

/** standings: one group table, or all of them. */
export async function toolGetStandings(
  args: { group?: string } & CommonOpts,
): Promise<ToolResult> {
  // Authoritative cumulative standings from the provider; fails closed to a
  // roster-at-zero (degraded) rather than a wrong, single-day-window table.
  const { tables, degraded, source } = await getStandings(resolveAdapter(args), args.group);

  // Preserve the structured shape: { group, standings: StandingRow[] }.
  const shaped = tables.map((tb) => ({ group: tb.group, standings: tb.rows }));

  if (shaped.length === 0) {
    const g = args.group?.toUpperCase();
    const msg = g ? `No group "${g}". Groups are A–L.` : 'No standings available.';
    return {
      text: withDisclaimer(degraded ? `${msg} (Live standings unavailable.)` : msg, source, args.lang),
      data: { degraded, source: source ?? null, tables: args.group ? null : [] },
    };
  }

  let text = shaped.map((t) => standingsTable(t.group, t.standings)).join('\n\n');
  if (degraded) text += '\n\n(Live standings unavailable — showing the group roster.)';
  return {
    text: withDisclaimer(text, source, args.lang),
    data: { degraded, source: source ?? null, tables: args.group ? (shaped[0] ?? null) : shaped },
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
      text: withDisclaimer(
        t(args.lang, 'bracket.unknownStage', { stage: args.stage ?? '' }),
        undefined,
        args.lang,
      ),
      data: { view: null },
    };
  }
  const { view, degraded, standingsDegraded, source } = await getBracket(
    resolveAdapter(args),
    filter ? { stage: filter as Stage, lang: args.lang } : { lang: args.lang },
  );
  let text = formatBracketList(view, { footer: false, locale: args.lang, tz: args.tz });
  if (degraded) {
    text += `\n\n(${t(args.lang, 'bracket.degraded')})`;
  } else if (standingsDegraded) {
    text += `\n\n(${t(args.lang, 'bracket.standingsDegraded')})`;
  }
  return {
    text: withDisclaimer(text, source, args.lang),
    data: { degraded, standingsDegraded, source: source ?? null, view },
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
  const g = group.toUpperCase();
  const { tables, degraded, source } = await getStandings(adapter, g);
  const tb = tables[0];
  let text = tb ? standingsTable(tb.group, tb.rows) : `No group ${g}.`;
  if (degraded && tb) text += '\n\n(Live standings unavailable — showing the group roster.)';
  return withDisclaimer(text, source);
}

/** next_fixture: a team's next match, live-resolved across the knockout phase. */
export async function toolGetNextFixture(
  args: { team: string } & CommonOpts,
): Promise<ToolResult> {
  const code = args.team.toUpperCase();
  // Overlay the live knockout window so a confirmed R32+ tie resolves: the
  // bundled knockout slots are placeholders, so a static lookup goes blind once
  // a team's group games pass (it would answer "no upcoming fixture" even after
  // ESPN confirmed the tie). Fails closed to the static result on a feed outage.
  // The caller's clock is still threaded for deterministic tests.
  const { fixture, degraded, source } = await getNextFixtureForTeam(
    resolveAdapter(args),
    code,
    args.now ?? new Date(),
  );
  if (!fixture) {
    const msg = degraded
      ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${code}.`
      : `No upcoming fixture found for ${code}.`;
    return {
      text: withDisclaimer(msg, undefined, args.lang),
      data: { team: code, fixture: null, degraded },
    };
  }
  const opts = fmtOpts(args);
  return {
    text: withDisclaimer(`Next up for ${code}:\n${matchLine(fixture, opts)}`, source, args.lang),
    data: { team: code, fixture, degraded },
  };
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
    const { match } = await getMatchById(resolveAdapter(args), args.matchId);
    const relevant = match ? marketRelevant(match, now) : false;
    const sig = match && relevant ? await getMarketSignal(provider, match) : undefined;
    const shown = match && sig && marketDisplayable(match, sig) ? sig : undefined;
    const text = !match
      ? `No match found with id ${args.matchId}.`
      : shown
        ? marketText(match, shown, args)
        : noSignalText(match, args, now);
    return {
      text: withDisclaimer(text),
      data: {
        matchId: args.matchId,
        informationalOnly: true,
        signal: shown ? marketData(shown) : null,
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
    const { match: fixture, degraded } = await marketFixtureForTeam(resolveAdapter(args), code, now);
    const relevant = fixture ? marketRelevant(fixture, now) : false;
    const sig = fixture && relevant ? await getMarketSignal(provider, fixture) : undefined;
    const shown = fixture && sig && marketDisplayable(fixture, sig) ? sig : undefined;
    const text = !fixture
      ? degraded
        ? `Live feed unavailable — can't resolve ${code}'s next fixture right now.`
        : `No upcoming fixture found for ${code}.`
      : shown
        ? marketText(fixture, shown, args)
        : noSignalText(fixture, args, now);
    return {
      text: withDisclaimer(text),
      data: {
        team: code,
        matchId: fixture?.id ?? null,
        degraded,
        informationalOnly: true,
        signal: shown ? marketData(shown) : null,
      },
    };
  }

  // A date's matches (default: today).
  const date = args.date ?? localDate(now.toISOString(), args.tz);
  const { matches } = await getMatchesForDate(resolveAdapter(args), date);
  const todays = fixturesByDate(date, matches, args.tz).filter((m) => marketRelevant(m, now));
  const { signals } = await getMarketSignals(provider, todays, MARKETS_TOOL_OPTS);
  const shown = todays
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.match, r.signal),
    );
  const text = shown.length
    ? `Market signals on ${date}:\n${shown
        .map(({ match, signal }) => marketText(match, signal, args))
        .join('\n\n')}`
    : `No reliable market signals on ${date}.`;
  return {
    text: withDisclaimer(text),
    data: {
      date,
      informationalOnly: true,
      signals: shown.map(({ signal }) => marketData(signal)),
    },
  };
}

/** Reliable, displayable signals keyed by id for a share snippet. Off → empty. */
async function reliableSignalMap(
  args: CommonOpts,
  matches: Match[],
): Promise<Map<string, MarketSignal>> {
  if (!marketsEnabled()) return new Map();
  const now = args.now ?? new Date();
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return new Map();
  const signals = await cachedMarketSignals(args, relevant);
  const out = new Map<string, MarketSignal>();
  for (const m of relevant) {
    const s = signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now }) && marketDisplayable(m, s)) out.set(m.id, s);
  }
  return out;
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

function shareResult(
  kind: 'today' | 'live' | 'next' | 'match',
  target: string,
  team: string | undefined,
  input: ShareSnippetInput,
  options: ShareSnippetOptions,
): ToolResult {
  const snippet = formatShareSnippet(input, options);
  return {
    // The snippet is self-contained: it carries its own non-affiliation
    // disclaimer (and, for any market line, the "informational only" caveat +
    // attribution), so it is deliberately NOT wrapped with withDisclaimer —
    // that would duplicate the disclaimer inside a paste-ready artifact.
    text: snippet,
    data: {
      kind,
      target,
      ...(team ? { team } : {}),
      source: input.source ?? null,
      degraded: input.degraded ?? false,
      informationalOnly: true,
      style: options.style ?? 'social',
      snippet,
      matches: input.matches,
      marketSignals: Object.fromEntries(
        [...(input.marketSignals ?? new Map<string, MarketSignal>())].map(([id, s]) => [
          id,
          marketData(s),
        ]),
      ),
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
  const signalsFor = (ms: Match[]): Promise<Map<string, MarketSignal>> =>
    args.includeMarkets === false ? Promise.resolve(new Map()) : reliableSignalMap(args, ms);

  // live: matches in play right now (no market enrichment, matching the CLI).
  if (args.live) {
    const { matches, degraded, source } = await getLiveMatches(resolveAdapter(args));
    return shareResult(
      'live',
      'live',
      undefined,
      {
        title: 'Live match pulse',
        matches,
        source,
        degraded,
        // Feed down ⇒ don't let an empty card read as "nothing is on".
        emptyNote: degraded
          ? "Live scores unavailable right now — couldn't reach the data provider."
          : 'No matches in play right now.',
        installLine: 'npx @claudinho/cli live',
        tz: args.tz,
        locale: args.lang,
      },
      { ...options, includeMarkets: false },
    );
  }

  // a group's standings table (facts only; no market lines).
  if (args.group) {
    const group = args.group.toUpperCase();
    const { tables, degraded, source } = await getStandings(resolveAdapter(args), group);
    const snippet = formatShareTable(
      {
        tables,
        // Degraded ⇒ static roster, no live provider: don't attribute one, and
        // surface the not-live notice (the card gets pasted publicly).
        source: degraded ? undefined : source,
        installLine: `npx @claudinho/cli table ${group}`,
        emptyNote: `No group ${group}.`,
        degraded,
      },
      options,
    );
    return {
      text: snippet,
      data: {
        kind: 'table',
        target: 'table',
        group,
        source: degraded ? null : (source ?? null),
        degraded,
        informationalOnly: true,
        snippet,
        tables: tables.map((tb) => ({ group: tb.group, standings: tb.rows })),
      },
    };
  }

  // knockout bracket card (facts only; no market lines).
  if (args.bracket) {
    const stageFilter = args.knockoutStage?.toUpperCase();
    if (stageFilter && !BRACKET_STAGES.has(stageFilter)) {
      return {
        text: withDisclaimer(
          t(args.lang, 'bracket.unknownStage', { stage: args.knockoutStage ?? '' }),
          undefined,
          args.lang,
        ),
        data: { kind: 'bracket', view: null },
      };
    }
    const { view, degraded, source } = await getBracket(
      resolveAdapter(args),
      stageFilter
        ? { stage: stageFilter as Stage, lang: args.lang }
        : { lang: args.lang },
    );
    const snippet = formatShareBracket(
      {
        view,
        source: degraded ? undefined : source,
        installLine: stageFilter
          ? `npx @claudinho/cli bracket ${stageFilter}`
          : 'npx @claudinho/cli bracket',
        emptyNote: t(args.lang, 'bracket.empty'),
      },
      { ...options, locale: args.lang, tz: args.tz },
    );
    return {
      text: snippet,
      data: {
        kind: 'bracket',
        target: 'bracket',
        ...(stageFilter ? { stage: stageFilter } : {}),
        source: degraded ? null : (source ?? null),
        degraded,
        informationalOnly: true,
        snippet,
        view,
      },
    };
  }

  // a single match by id, with live overlay (±1-day window — see toolGetMatch).
  if (args.matchId) {
    const { match, degraded, source } = await getMatchById(resolveAdapter(args), args.matchId);
    const matches = match ? [match] : [];
    return shareResult(
      'match',
      args.matchId,
      undefined,
      {
        title: 'Match pulse',
        matches,
        marketSignals: await signalsFor(matches),
        source,
        degraded,
        emptyNote: `No match found with id ${args.matchId}.`,
        installLine: `npx @claudinho/cli match ${args.matchId}`,
        tz: args.tz,
        locale: args.lang,
      },
      options,
    );
  }

  // a team's next fixture, live-resolved across the knockout phase (+ market read).
  if (args.team) {
    const code = args.team.toUpperCase();
    // Overlay the live knockout window so a confirmed R32+ tie pastes too (see
    // getNextFixtureForTeam / toolGetNextFixture); fail closed on an outage.
    const { fixture, degraded, source } = await getNextFixtureForTeam(
      resolveAdapter(args),
      code,
      args.now ?? new Date(),
    );
    const matches = fixture ? [fixture] : [];
    const teamName = fixture
      ? fixture.home.code === code
        ? fixture.home.name
        : fixture.away.name
      : code;
    return shareResult(
      'next',
      'next',
      code,
      {
        title: `Next up for ${teamName}`,
        matches,
        marketSignals: await signalsFor(matches),
        // Attribute the provider only when the overlay resolved the tie; parity
        // with get_next_fixture (a static group fixture carries no source).
        source,
        degraded,
        emptyNote: degraded
          ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${code}.`
          : `No upcoming fixture found for ${code}.`,
        installLine: `npx @claudinho/cli next ${code}`,
        tz: args.tz,
        locale: args.lang,
      },
      options,
    );
  }

  // a date's matches (default: today).
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches: all, degraded, source } = await getMatchesForDate(resolveAdapter(args), date);
  const todays = fixturesByDate(date, all, args.tz);
  const human = formatDate(`${date}T12:00:00.000Z`, { tz: args.tz, locale: args.lang });
  return shareResult(
    'today',
    date,
    undefined,
    {
      title: args.date ? `Matches · ${human}` : `Today's matches · ${human}`,
      matches: todays,
      marketSignals: await signalsFor(todays),
      source,
      degraded,
      emptyNote: `No matches scheduled for ${human}.`,
      installLine: 'npx @claudinho/cli today',
      tz: args.tz,
      locale: args.lang,
    },
    options,
  );
}
