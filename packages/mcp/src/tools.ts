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
  getLiveMatches,
  getMarketSignal,
  getMarketSignals,
  getMatchesForDate,
  groups,
  hasSaneDistribution,
  isReliableMarketSignal,
  localDate,
  makeAdapter,
  makeMarketProvider,
  marketBlock,
  type Match,
  type MarketProvider,
  type MarketSignal,
  nextFixtureForTeam,
  type ProviderAdapter,
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

/** Strict-gated market payloads keyed by matchId, or undefined when none/off. */
async function reliableMarketData(
  args: CommonOpts,
  matches: Match[],
): Promise<Record<string, ReturnType<typeof marketData>> | undefined> {
  if (!marketsEnabled()) return undefined;
  const signals = await getMarketSignals(resolveMarketProvider(args), matches);
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

function withDisclaimer(text: string): string {
  return `${text}\n\n${DISCLAIMER}`;
}

/** today: fixtures for a date (default: today), with live overlay. */
export async function toolGetToday(
  args: { date?: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches, degraded } = await getMatchesForDate(adapter, date);
  const todays = fixturesByDate(date, matches, args.tz);
  const opts = fmtOpts(args);
  const text = `Matches on ${date}:\n${matchList(todays, 'No matches scheduled.', opts)}`;
  const marketSignals = await reliableMarketData(args, todays);
  return {
    text: withDisclaimer(text),
    data: {
      date,
      degraded,
      count: todays.length,
      matches: todays,
      ...(marketSignals ? { marketSignals } : {}),
    },
  };
}

/** live: in-progress matches right now. */
export async function toolGetLive(args: CommonOpts = {}): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const { matches, degraded } = await getLiveMatches(adapter);
  const opts = fmtOpts(args);
  const text = `Live now:\n${matchList(matches, 'No matches in play right now.', opts)}`;
  return {
    text: withDisclaimer(text),
    data: { degraded, count: matches.length, matches },
  };
}

/** match: a single fixture by id, with live overlay for that day. */
export async function toolGetMatch(
  args: { id: string } & CommonOpts,
): Promise<ToolResult> {
  let match = allFixtures().find((m) => m.id === args.id);
  let degraded = false;
  if (match) {
    try {
      const adapter = resolveAdapter(args);
      const live = await adapter.fetchByDate(match.kickoff.slice(0, 10));
      match = live.find((m) => m.id === args.id) ?? match;
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
    const s = await getMarketSignal(resolveMarketProvider(args), match);
    if (s && isReliableMarketSignal(s, { now: new Date() })) marketSignal = s;
  }
  const base = matchLine(match, opts);
  const text = marketSignal ? `${base}\n${marketBlock(marketSignal, match).join('\n')}` : base;
  return {
    text: withDisclaimer(text),
    data: { degraded, match, marketSignal: marketSignal ? marketData(marketSignal) : null },
  };
}

/** standings: one group table, or all of them. */
export async function toolGetStandings(
  args: { group?: string } & CommonOpts,
): Promise<ToolResult> {
  // Overlay today's results so finished games count. getMatchesForDate fetches
  // the UTC window spanning the local day, so a late-UTC result still overlays.
  const { matches, degraded } = await getMatchesForDate(
    resolveAdapter(args),
    localDate(new Date().toISOString(), args.tz),
  );

  const known = groups(matches); // present group letters, e.g. A..L
  if (args.group) {
    const g = args.group.toUpperCase();
    if (!known.includes(g)) {
      return {
        text: withDisclaimer(
          `No group "${g}". Groups are ${known.join(', ')}.`,
        ),
        data: { degraded, tables: null },
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
    text: withDisclaimer(text || `No group found.`),
    data: { degraded, tables: args.group ? (tables[0] ?? null) : tables },
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
  const signals = await getMarketSignals(provider, todays);
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
