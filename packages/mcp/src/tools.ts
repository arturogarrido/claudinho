/**
 * Pure tool handlers — the business logic behind each MCP tool, decoupled from
 * the SDK so they can be unit-tested directly. Each returns a `{ text, data }`
 * pair: `text` is the human/LLM-readable summary, `data` is the structured
 * payload embedded as JSON for agents that want to parse it.
 */
import {
  allFixtures,
  asFlavorLevel,
  computeStandings,
  fixturesByDate,
  fixturesByGroup,
  formatDate,
  formatShareSnippet,
  getLiveMatches,
  getMarketSignal,
  getMarketSignals,
  getMatchesForDate,
  groups,
  hasSaneDistribution,
  isReliableMarketSignal,
  liveSourceLabel,
  localDate,
  makeAdapter,
  makeMarketProvider,
  marketBlock,
  type Match,
  type MarketProvider,
  type MarketSignal,
  nextFixtureForTeam,
  type ProviderAdapter,
  resolveCompetition,
  resolveMarketSource,
  type ShareSnippetInput,
  type ShareSnippetOptions,
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
}

function resolveAdapter(args: CommonOpts): ProviderAdapter {
  return args.adapter ?? makeAdapter(args.source);
}

function resolveMarketProvider(args: CommonOpts): MarketProvider {
  return args.marketProvider ?? makeMarketProvider();
}

/** Show a signal only if it maps cleanly and has a determinable favorite. */
function marketDisplayable(sig: MarketSignal): boolean {
  return !sig.ambiguous && sig.favorite != null && hasSaneDistribution(sig.outcomes);
}

function marketHeader(m: Match): string {
  return `${m.home.flag} ${m.home.name} vs ${m.away.name} ${m.away.flag}`;
}

function marketText(m: Match, sig: MarketSignal): string {
  return `${marketHeader(m)}\n${marketBlock(sig, m).join('\n')}`;
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
  const signals = await cachedMarketSignals(args, matches);
  const now = new Date();
  const out: Record<string, ReturnType<typeof marketData>> = {};
  for (const m of matches) {
    const s = signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now })) out[m.id] = marketData(s);
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

function withDisclaimer(text: string, source?: string): string {
  // Attribute the live-data provider when live data actually served the result.
  const live = source ? `\nLive data: ${liveSourceLabel(source)}` : '';
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
  const text = `Matches on ${date}:\n${matchList(todays, 'No matches scheduled.', opts)}`;
  const marketSignals = await reliableMarketData(args, todays);
  return {
    text: withDisclaimer(text, source),
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
  const text = `Live now:\n${matchList(matches, 'No matches in play right now.', opts)}`;
  return {
    text: withDisclaimer(text, source),
    data: { degraded, source: source ?? null, count: matches.length, matches },
  };
}

/** match: a single fixture by id, with live overlay for that day. */
export async function toolGetMatch(
  args: { id: string } & CommonOpts,
): Promise<ToolResult> {
  let match = allFixtures().find((m) => m.id === args.id);
  let degraded = false;
  let liveSource: string | undefined;
  if (match) {
    try {
      const adapter = resolveAdapter(args);
      const live = await adapter.fetchByDate(match.kickoff.slice(0, 10));
      match = live.find((m) => m.id === args.id) ?? match;
      liveSource = adapter.name;
    } catch {
      degraded = true;
    }
  }
  if (!match) {
    return { text: withDisclaimer(`No match found with id ${args.id}.`), data: { match: null } };
  }
  const opts = fmtOpts(args);
  let marketSignal: MarketSignal | undefined;
  if (marketsEnabled()) {
    const s = (await cachedMarketSignals(args, [match])).get(match.id);
    if (s && isReliableMarketSignal(s, { now: new Date() })) marketSignal = s;
  }
  const base = matchLine(match, opts);
  const text = marketSignal ? `${base}\n${marketBlock(marketSignal, match).join('\n')}` : base;
  return {
    text: withDisclaimer(text, liveSource),
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
  // Overlay today's results so finished games count. getMatchesForDate fetches
  // the UTC window spanning the local day, so a late-UTC result still overlays.
  const { matches, degraded, source } = await getMatchesForDate(
    resolveAdapter(args),
    localDate(new Date().toISOString(), args.tz),
  );

  const known = groups(matches); // present group letters, e.g. A..L
  if (args.group) {
    const g = args.group.toUpperCase();
    if (!known.includes(g)) {
      return {
        text: withDisclaimer(`No group "${g}". Groups are ${known.join(', ')}.`, source),
        data: { degraded, source: source ?? null, tables: null },
      };
    }
  }

  const wanted = args.group ? [args.group.toUpperCase()] : known;
  const tables = wanted.map((g) => ({
    group: g,
    standings: computeStandings(fixturesByGroup(g, matches)),
  }));
  const text = tables
    .map((t) => standingsTable(t.group, t.standings))
    .join('\n\n');
  return {
    text: withDisclaimer(text || `No group found.`, source),
    data: { degraded, source: source ?? null, tables: args.group ? (tables[0] ?? null) : tables },
  };
}

/** next_fixture: a team's next match (static schedule). */
export async function toolGetNextFixture(
  args: { team: string } & CommonOpts,
): Promise<ToolResult> {
  const code = args.team.toUpperCase();
  const fixture = nextFixtureForTeam(code);
  if (!fixture) {
    return {
      text: withDisclaimer(`No upcoming fixture found for ${code}.`),
      data: { team: code, fixture: null },
    };
  }
  const opts = fmtOpts(args);
  return {
    text: withDisclaimer(`Next up for ${code}:\n${matchLine(fixture, opts)}`),
    data: { team: code, fixture },
  };
}

/**
 * market_signal: read-only prediction-market odds for a single match (by id), a
 * team's next fixture, or all of a date's matches (default: today). Returns
 * market-implied percentages with attribution; never links, never advice.
 */
export async function toolGetMarketSignal(
  args: { matchId?: string; team?: string; date?: string } & CommonOpts,
): Promise<ToolResult> {
  const provider = resolveMarketProvider(args);

  // Most specific: a single match by id.
  if (args.matchId) {
    const match = allFixtures().find((m) => m.id === args.matchId);
    const sig = match ? await getMarketSignal(provider, match) : undefined;
    const shown = match && sig && marketDisplayable(sig) ? sig : undefined;
    const text = !match
      ? `No match found with id ${args.matchId}.`
      : shown
        ? marketText(match, shown)
        : `No reliable market signal for ${marketHeader(match)}.`;
    return {
      text: withDisclaimer(text),
      data: {
        matchId: args.matchId,
        informationalOnly: true,
        signal: shown ? marketData(shown) : null,
      },
    };
  }

  // A team's next fixture.
  if (args.team) {
    const code = args.team.toUpperCase();
    const fixture = nextFixtureForTeam(code);
    const sig = fixture ? await getMarketSignal(provider, fixture) : undefined;
    const shown = fixture && sig && marketDisplayable(sig) ? sig : undefined;
    const text = !fixture
      ? `No upcoming fixture found for ${code}.`
      : shown
        ? marketText(fixture, shown)
        : `No reliable market signal for ${code}'s next fixture.`;
    return {
      text: withDisclaimer(text),
      data: {
        team: code,
        matchId: fixture?.id ?? null,
        informationalOnly: true,
        signal: shown ? marketData(shown) : null,
      },
    };
  }

  // A date's matches (default: today).
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches } = await getMatchesForDate(resolveAdapter(args), date);
  const todays = fixturesByDate(date, matches, args.tz);
  const { signals } = await getMarketSignals(provider, todays, MARKETS_TOOL_OPTS);
  const shown = todays
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.signal),
    );
  const text = shown.length
    ? `Market signals on ${date}:\n${shown
        .map(({ match, signal }) => marketText(match, signal))
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
  const signals = await cachedMarketSignals(args, matches);
  const now = new Date();
  const out = new Map<string, MarketSignal>();
  for (const m of matches) {
    const s = signals.get(m.id);
    if (s && isReliableMarketSignal(s, { now }) && marketDisplayable(s)) out.set(m.id, s);
  }
  return out;
}

interface ShareArgs extends CommonOpts {
  matchId?: string;
  team?: string;
  date?: string;
  live?: boolean;
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
 * share_snippet: a polished, copy-pasteable match card — the same artifact as the
 * CLI `claudinho share`. Routing precedence: live > matchId > team > date
 * (default today). Plain text, no links; the non-affiliation disclaimer and any
 * market caveat are baked into the snippet, so the model can hand `text` to the
 * user verbatim.
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
    const { matches, source } = await getLiveMatches(resolveAdapter(args));
    return shareResult(
      'live',
      'live',
      undefined,
      {
        title: 'Live match pulse',
        matches,
        source,
        emptyNote: 'No matches in play right now.',
        installLine: 'npx @claudinho/cli live',
        tz: args.tz,
        locale: args.lang,
      },
      { ...options, includeMarkets: false },
    );
  }

  // a single match by id, with live overlay for that day.
  if (args.matchId) {
    let match = allFixtures().find((m) => m.id === args.matchId);
    let source: string | undefined;
    if (match) {
      try {
        const adapter = resolveAdapter(args);
        const live = await adapter.fetchByDate(match.kickoff.slice(0, 10));
        match = live.find((m) => m.id === args.matchId) ?? match;
        source = adapter.name;
      } catch {
        /* keep static */
      }
    }
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
        emptyNote: `No match found with id ${args.matchId}.`,
        installLine: `npx @claudinho/cli match ${args.matchId}`,
        tz: args.tz,
        locale: args.lang,
      },
      options,
    );
  }

  // a team's next fixture (static schedule + reliable market read).
  if (args.team) {
    const code = args.team.toUpperCase();
    const fixture = nextFixtureForTeam(code);
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
        emptyNote: `No upcoming fixture found for ${code}.`,
        installLine: `npx @claudinho/cli next ${code}`,
        tz: args.tz,
        locale: args.lang,
      },
      options,
    );
  }

  // a date's matches (default: today).
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches: all, source } = await getMatchesForDate(resolveAdapter(args), date);
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
      emptyNote: `No matches scheduled for ${human}.`,
      installLine: 'npx @claudinho/cli today',
      tz: args.tz,
      locale: args.lang,
    },
    options,
  );
}
