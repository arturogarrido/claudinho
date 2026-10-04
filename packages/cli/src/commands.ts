import {
  allFixtures,
  bundleApplies,
  countdown,
  fixturesByDate,
  humanLabel,
  isTournamentWindowOver,
  formatDate,
  formatKickoff,
  formatShareSnippet,
  formatShareTable,
  formatShareBracket,
  formatBracketList,
  formatBracketTree,
  bracketShareCard,
  dateNoneRead,
  dateShareCard,
  dateUnreached,
  dayAttribution,
  liveNoneRead,
  liveShareCard,
  marketsNoneRead,
  matchNoneReadSentence,
  matchShareCard,
  matchWindowSentence,
  nextHorizonSentence,
  nextNoneReadSentence,
  nextShareCard,
  tableShareCard,
  tableData,
  tableKeyArg,
  tableTitle,
  marketDisplayable,
  servedExtras,
  verdictExtras,
  verdictNotice,
  verdictQualifiers,
  cacheableKeys,
  getMarketSignals,
  resolvedValues,
  getMatchById,
  isFinished,
  isLive,
  isReliableMarketSignal,
  isValidDate,
  isValidTimeZone,
  localDate,
  lookupTeam,
  makeMarketProvider,
  marketBlock,
  marketFixtureForTeam,
  marketLine,
  marketsCoverCompetition,
  marketScopeVerdict,
  MARKETS_SCOPE_NOTE,
  marketSignalRendersFor,
  marketRelevant,
  matchFlavor,
  matchLocation,
  SHARE_HASHTAG,
  resolveMarketSource,
  resolveTz,
  scoreline,
  t as i18n,
  joinSegments,
  stageLabelI18n,
  teamKind,
  withFlag,
  type Stage,
} from '@claudinho/core';
import Table from 'cli-table3';
import type { CliConfig } from './config';
import type { Translator } from './i18n';
import {
  dataSource,
  disclaimer,
  header,
  homeColumn,
  matchLine,
  type Painter,
  painterFor,
  statusToken,
  tableTeamCell,
} from './format';
import {
  getLiveMatches,
  getMatchesForDate,
  getNextFixtureForTeam,
  getStandings,
  getBracket,
  isKnownSource,
  KNOWN_SOURCES,
  makeAdapter,
} from './data';
import { readMarketCache, writeMarketCache } from './marketCache';
import { bumpRunCount, REPO_URL, shouldNudge } from './starNudge';
import { copyToClipboard } from './clipboard';
import type {
  BracketShareCard,
  Match,
  MatchShareCard,
  MarketProvider,
  MarketSignal,
  ProviderAdapter,
  ShareSnippetOptions,
  TableShareCard,
  ShareBracketOptions,
  ShareStyle,
} from '@claudinho/core';
import { readCurrentState } from './cache';
import { flagsEnabled, liveMatchesFromCache, renderPrompt } from './statusline';
import { renderHook } from './hook';
import { refreshWanted, runRefresh, spawnRefresh } from './refresh';
import {
  type CursorStatusLinePayload,
  readCursorPayload,
  renderPromptOutput,
} from './cursorPayload';
import { type InitResult, initCursorStatusline, initHook, initStatusline } from './install';
import { withPersistedBackoff } from './providerBackoff';

/**
 * Command context. `adapter` is an optional injection seam: production leaves
 * it unset (commands build one from `cfg.source`), tests pass a fake so they
 * never touch the network.
 */
type Ctx = {
  cfg: CliConfig;
  t: Translator;
  adapter?: ProviderAdapter;
  marketProvider?: MarketProvider;
  /** Injection seam for `share --copy` so tests never touch the real clipboard. */
  copy?: (text: string) => boolean;
  /** Injection seam for time-dependent gates (market relevance, live windows). */
  now?: Date;
};

/**
 * The injected adapter, or one constructed from the configured source —
 * either way armed from the persisted provider backoff and persisting a
 * throttle it meets (audit A12; see providerBackoff.ts).
 */
function adapterFor({ cfg, adapter, now }: Ctx): ProviderAdapter {
  return withPersistedBackoff(
    adapter ?? makeAdapter(cfg.source, { competition: cfg.competition }),
    cfg.source,
    now,
  );
}

/** Per-fetch budgets so optional market enrichment never blocks core output. */
type MarketFetchOpts = { deadlineMs?: number; timeoutMs?: number };
// Default-on annotation (today/match): tight — must not block render.
const DEFAULT_ON_MARKET_OPTS: MarketFetchOpts = { deadlineMs: 2000, timeoutMs: 2500 };
// The dedicated `markets` command: the user is explicitly waiting, so allow more.
const MARKETS_CMD_OPTS: MarketFetchOpts = { deadlineMs: 12000, timeoutMs: 6000 };

/**
 * Market signals for a set of matches. With an injected provider (tests), use it
 * directly. Otherwise read through a short on-disk cache (positive AND negative)
 * around the default provider so repeated cold commands don't re-hit the data
 * source. NEVER reached from the statusline/hook hot path.
 */
/**
 * Signals, plus whether we actually managed to CHECK every fixture.
 *
 * `complete: false` means at least one fixture was never resolved — a timeout,
 * an unreadable payload, a deadline. It is not the same as "this fixture has no
 * market", and collapsing the two is how an outage renders as the confident
 * "No market signals available", which is the confidently-wrong output this
 * project refuses everywhere else.
 */
interface MarketSignalsResult {
  readonly signals: Map<string, MarketSignal>;
  readonly complete: boolean;
}

type MarketProviderFactory = (source: string | undefined, competition: string) => MarketProvider;

export async function marketSignalsFor(
  ctx: Ctx,
  matches: Match[],
  opts: MarketFetchOpts = {},
  providerFactory: MarketProviderFactory = makeMarketProvider,
): Promise<MarketSignalsResult> {
  if (ctx.marketProvider) {
    const b = await getMarketSignals(ctx.marketProvider, matches, opts);
    return { signals: resolvedValues(b), complete: b.complete };
  }
  const source = resolveMarketSource();
  // Dev/demo/no-op providers ('fake'/'none') are free — skip the on-disk cache.
  if (source !== 'polymarket') {
    const b = await getMarketSignals(providerFactory(source, ctx.cfg.competition), matches, opts);
    return { signals: resolvedValues(b), complete: b.complete };
  }
  const competition = ctx.cfg.competition;
  const { signals: cached, checked: cachedIds } = readMarketCache('polymarket', competition);
  const result = new Map<string, MarketSignal>();
  const miss: Match[] = [];
  for (const m of matches) {
    const hit = cached.get(m.id);
    // A cached signal that would not RENDER for THIS fixture is not a hit. It
    // is keyed by match id, but the fixture behind that id can change (a
    // knockout slot degrading back to a placeholder), and keeping it both hid
    // the market line and suppressed the refetch that could produce a real one.
    if (hit && marketSignalRendersFor(m, hit)) {
      result.set(m.id, hit);
      continue;
    }
    if (!hit && cachedIds.has(m.id)) continue; // definitive negative within TTL
    miss.push(m);
  }
  let complete = true;
  if (miss.length > 0) {
    const batch = await getMarketSignals(providerFactory('polymarket', competition), miss, opts);
    const fetched = resolvedValues(batch);
    // Cache hits and remembered negatives are settled; only the fetched slice
    // can leave us not knowing.
    complete = batch.complete;
    // Negative-cache only ids whose verdict may be REMEMBERED (see
    // `isCacheable`): a conclusion drawn from a payload we READ, which includes
    // a stable ambiguity. A shape we could not read and a deadline that expired
    // are omitted, so neither suppresses the refetch that would recover.
    writeMarketCache('polymarket', competition, [...cacheableKeys(batch)], fetched);
    for (const [id, s] of fetched) result.set(id, s);
  }
  return { signals: result, complete };
}

/** Strict-gated signals for the default-on annotation; empty when markets are off. */
async function reliableMarketSignals(
  ctx: Ctx,
  matches: Match[],
): Promise<MarketSignalsResult> {
  if (ctx.cfg.markets === false) return { signals: new Map(), complete: true };
  const now = ctx.now ?? new Date();
  // Market reads are pre-match/in-play artifacts: never fetch (or show) them
  // for finished matches — "markets favor X" after full time reads as a bug.
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return { signals: new Map(), complete: true };
  const raw = await marketSignalsFor(ctx, relevant, DEFAULT_ON_MARKET_OPTS);
  const out = new Map<string, MarketSignal>();
  for (const [id, s] of raw.signals) {
    const m = relevant.find((x) => x.id === id);
    // Re-check against the fixture being shown: a cached signal must not render
    // against a degraded placeholder that inherited its id (fail closed).
    if (m && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(m, s)) out.set(id, s);
  }
  return { signals: out, complete: raw.complete };
}

async function reliableMarketSignalFor(
  ctx: Ctx,
  match: Match,
): Promise<{ signal: MarketSignal | undefined; complete: boolean }> {
  const result = await reliableMarketSignals(ctx, [match]);
  return { signal: result.signals.get(match.id), complete: result.complete };
}

function out(line = ''): void {
  process.stdout.write(line + '\n');
}

function emitJson(data: unknown): void {
  out(JSON.stringify(data, null, 2));
}

/** A command refused input; the caller should stop and exit non-zero. */
export class InputError extends Error {}

/**
 * Validate shared inputs before a command runs:
 *  - an explicit `--tz` that's invalid → warn to stderr (non-fatal; core falls
 *    back to the system zone anyway).
 *  - an explicit date that isn't strict YYYY-MM-DD → throw InputError.
 */
function precheck(cfg: CliConfig, t: Translator, date?: string): void {
  if (cfg.langRequestedUnsupported) {
    process.stderr.write(t('warn.lang', { lang: cfg.langRequestedUnsupported }) + '\n');
  }
  if (cfg.tz && !isValidTimeZone(cfg.tz)) {
    process.stderr.write(t('warn.tz', { tz: cfg.tz }) + '\n');
  }
  // An unknown --source/CLAUDINHO_SOURCE used to silently run ESPN — the flag
  // lied. Fail loud with the valid list (core makeAdapter also throws, as
  // defense in depth; this gives the localized, prefix-free message).
  if (!isKnownSource(cfg.source)) {
    throw new InputError(
      t('err.source', { source: cfg.source, sources: KNOWN_SOURCES.join(', ') }),
    );
  }
  // Config-drift guard: a leftover CLAUDINHO_COMPETITION (e.g. from
  // pre-tournament testing) silently points the live fetch at a different
  // competition than the bundled schedule — fixtures render, scores never
  // arrive. Warn loudly on user-facing commands; never on the statusline/hook
  // hot path (those must stay single-line and silent).
  const competition = cfg.competition;
  if (!bundleApplies(competition)) {
    process.stderr.write(
      `claudinho: CLAUDINHO_COMPETITION=${competition} — live data follows a different competition than the bundled 2026 schedule.\n`,
    );
  }
  if (date !== undefined && !isValidDate(date)) {
    throw new InputError(t('err.date', { date }));
  }
}

/**
 * Resolve an optional team argument to a FIFA code, falling back to CLAUDINHO_TEAM
 * (the same env the statusline/hook honor, so "my team" is configured once).
 *
 * Accepts a nation NAME as well as a code — "mexico" / "DR Congo" / "Türkiye" all
 * resolve via {@link lookupTeam}, so `claudinho next mexico` just works. An exact
 * code resolves directly; an ambiguous name errors with the candidates rather than
 * guessing; a raw 3-letter code not in the bundled roster still passes through
 * uppercased (the escape hatch for CLAUDINHO_COMPETITION / other feeds).
 */
function resolveTeamArg(
  team: string | undefined,
  usage: string,
  t: Translator,
  competition: string,
): string {
  const raw = team ?? process.env.CLAUDINHO_TEAM;
  if (!raw) throw new InputError(usage);
  // The bundled roster names the World Cup's nations and nothing else. Off the
  // bundle it is ANOTHER competition's roster and is never consulted: `ALA`
  // fuzzy-matched New Zealand there, and `RAC` Curaçao. The token passes
  // through (a code uppercased, anything else as a bounded label) to a command
  // that answers "not available for this competition" (the market sidecar);
  // `next` takes the query as typed instead (`teamQuery`).
  if (!bundleApplies(competition)) {
    if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
    const label = humanLabel(raw, 40);
    // Nothing readable to pass through (invisible characters only): that is
    // the same as no team at all.
    if (!label) throw new InputError(usage);
    return label;
  }
  const { team: hit, matches } = lookupTeam(raw);
  if (hit) return hit.code;
  if (matches.length > 1) {
    // Localized via the same keys cmdTeam renders (team.ambiguous ends in ":").
    throw new InputError(
      `${t('team.ambiguous', { query: raw })} ${matches
        .map((m) => `${m.name} (${m.code})`)
        .join(', ')}`,
    );
  }
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  throw new InputError(t('team.none', { query: raw }));
}

/**
 * The team a `next` is about. On the bundled competition, a nation resolved as
 * {@link resolveTeamArg} resolves it. Off it, the query AS TYPED, bounded like
 * a human label: core resolves a club against the competition's own roster
 * (by name or code, any case: `Arsenal`, `ars`, `O&M`), and answers with the
 * candidates when several match.
 */
function teamQuery(team: string | undefined, usage: string, t: Translator, competition: string): string {
  if (bundleApplies(competition)) return resolveTeamArg(team, usage, t, competition);
  const label = humanLabel(team ?? process.env.CLAUDINHO_TEAM ?? '', 40);
  if (!label) throw new InputError(usage);
  return label;
}

/**
 * Resolve CLAUDINHO_TEAM for the statusline/hook. Same offline lookup as the
 * commands (`CLAUDINHO_TEAM=mexico` filters, not just `MEX`); an unknown
 * 3-letter value still passes through uppercased (the CLAUDINHO_COMPETITION
 * escape hatch), and anything unresolvable yields no filter — showing all
 * matches beats a dead filter that blanks the statusline. Pure and offline
 * (bundled roster only), so it's safe on the no-network hot path.
 */
function resolveEnvTeam(raw: string | undefined, competition: string): string | undefined {
  if (!raw) return undefined;
  // Off the bundle the World Cup roster is not this competition's: only a bare
  // code is honoured (`ala` filters ALA, never New Zealand's NZL).
  if (bundleApplies(competition)) {
    const { team } = lookupTeam(raw);
    if (team) return team.code;
  }
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : undefined;
}

/** `claudinho today [date]` */
export async function cmdToday(date: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t, date);
  const adapter = adapterFor(ctx);
  const targetDate = date ?? localDate((ctx.now ?? new Date()).toISOString(), cfg.tz);
  // The viewer's zone, the one the day is filed by below: the read judges
  // "nothing on this date" in it too.
  const day = await getMatchesForDate(adapter, targetDate, resolveTz(cfg.tz));
  const { matches, degraded, source } = day;
  const todays = fixturesByDate(targetDate, matches, cfg.tz);
  const market = await reliableMarketSignals(ctx, todays);

  // `--json` keeps the overlay's provider in `source` and states the verdict;
  // the text names the provider only for a day it served something of.
  if (cfg.json) {
    emitJson({
      date: targetDate,
      degraded,
      source: source ?? null,
      // The day's rows the overlay held (a plain field, not a verdict), beside
      // `partial` only: a shown row not among them is the bundled schedule's.
      ...servedExtras(day, todays),
      matches: todays,
      marketComplete: market.complete,
      marketSignals: Object.fromEntries(market.signals),
      ...verdictExtras(day),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  // "Today's matches" only when no explicit date was given; otherwise "Matches".
  const title = date === undefined ? t('today.title') : t('today.on');
  out();
  out(header(`${title} · ${targetDate}`, c));
  out();
  if (todays.length === 0) {
    // A verdict (between editions) stands instead of the empty note. Where no
    // bundled schedule was merged, a failed read says the provider could not
    // be reached, and a read that was not whole says none was READ.
    out(
      c.dim(
        '  ' +
          (verdictNotice(day, cfg.lang) ??
            dateUnreached(day, targetDate, cfg.lang) ??
            dateNoneRead(day, targetDate, cfg.lang) ??
            t('today.none')),
      ),
    );
  } else {
    // The home column, measured once over the rows shown.
    const homeWidth = homeColumn(todays, flags);
    for (const m of todays) {
      out(matchLine(m, cfg, t, c, flags, homeWidth));
      const s = market.signals.get(m.id);
      if (s) out('    ' + c.dim(marketLine(s, m)));
    }
  }
  if (!market.complete) {
    out(c.dim('  Market data unavailable or incomplete — not all fixtures were checked.'));
  }
  out();
  // Live overlay failed → on the bundle these are static fixtures with no live
  // scores; off it there is no schedule to show, only the provider was missed.
  if (degraded) out(c.dim('  ' + t(day.skeleton ? 'feed.degraded' : 'live.degraded')));
  // The read was not whole: said after the list and before the attribution
  // (where `table` says it), with the count of shown rows it did not serve.
  // A day none of whose shown fixtures it served names no provider.
  const attribution = dayAttribution(day, todays, cfg.lang);
  for (const q of verdictQualifiers(day, cfg.lang)) out(c.dim('  ' + q));
  if (attribution.unserved) out(c.dim('  ' + attribution.unserved));
  const src = attribution.attributed ? dataSource(source, cfg.lang, c) : '';
  if (src) out(src);
  out(disclaimer(t, c));
  endScoreCommand(ctx);
}

/** `claudinho live` */
export async function cmdLive(ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const adapter = adapterFor(ctx);
  const live = await getLiveMatches(adapter, ctx.now ?? new Date());
  const { matches, degraded, source } = live;

  if (cfg.json) {
    emitJson({ degraded, source: source ?? null, matches, ...verdictExtras(live) });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  out();
  out(header(t('live.title'), c));
  out();
  // Degraded ⇒ the live feed failed, NOT "nothing is on". Say so, so the empty
  // state can't be mistaken for "no matches in play right now".
  if (degraded) {
    out(c.dim('  ' + t('live.degraded')));
  } else if (matches.length === 0) {
    // A verdict (between editions) stands instead of the empty note; a read
    // that was not whole says none in play was READ, not that none is.
    out(c.dim('  ' + (verdictNotice(live, cfg.lang) ?? liveNoneRead(live, cfg.lang) ?? t('live.none'))));
  } else {
    // The home column, measured once over the rows shown.
    const homeWidth = homeColumn(matches, flags);
    for (const m of matches) out(matchLine(m, cfg, t, c, flags, homeWidth));
  }
  out();
  // The read was not whole: said after the list and before the attribution,
  // where `table` says its tables are not all of them.
  for (const q of verdictQualifiers(live, cfg.lang)) out(c.dim('  ' + q));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
  endScoreCommand(ctx);
}

/** `claudinho next [team]` (team defaults to CLAUDINHO_TEAM) */
export async function cmdNext(team: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t, now } = ctx;
  precheck(cfg, t);
  const code = teamQuery(
    team,
    'Usage: claudinho next <team> (or set CLAUDINHO_TEAM)',
    t,
    cfg.competition,
  );
  // Live-resolved: the bundled knockout slots are resultless placeholders, so a
  // static lookup goes blind once a team's group games pass — overlay the live
  // knockout window so a confirmed R32+ tie (e.g. MEX vs ECU) surfaces here too.
  // Off the bundled competition core resolves the club and reads the schedule
  // ahead (yesterday to 14 days ahead).
  const next = await getNextFixtureForTeam(adapterFor(ctx), code, now ?? new Date());
  const { fixture, degraded, source } = next;
  // Who the answer is about: the club resolved, else the query, else the nation's code.
  const label = next.team?.name ?? next.query ?? code;

  if (cfg.json) {
    emitJson({
      team: next.team ?? code,
      fixture: fixture ?? null,
      degraded,
      source: source ?? null,
      // The answer's own fields (not verdicts): the candidates of an ambiguous
      // name, the span a whole read searched, the season the read stated.
      ...(next.candidates ? { candidates: next.candidates } : {}),
      ...(next.horizon ? { horizon: next.horizon } : {}),
      ...(next.season ? { season: next.season } : {}),
      ...verdictExtras(next),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  // What qualifies the answer (the window was not whole) is said BEFORE it, on
  // a found fixture and on "none found" alike: absence from a window that was
  // not whole is not elimination.
  const qualifiers = verdictQualifiers(next, cfg.lang);
  out();
  if (!fixture) {
    for (const q of qualifiers) out(c.dim('  ' + q));
    const notice = verdictNotice(next, cfg.lang);
    if (notice === undefined && next.candidates && next.candidates.length > 0) {
      // Two or more teams match: name them, pick none.
      out(
        c.dim(
          `  ${t('team.ambiguous', { query: code })} ${next.candidates
            .map((m) => `${m.name} (${m.code})`)
            .join(', ')}`,
        ),
      );
    } else {
      // Fail-closed honesty: a feed outage must read as "couldn't reach the
      // provider", never as "this team has no upcoming fixture" (= eliminated).
      // A whole read with nothing for the club says the span it searched; one
      // that was not whole says none was READ.
      out(
        c.dim(
          '  ' +
            (notice ??
              nextHorizonSentence(next, code, cfg.lang) ??
              nextNoneReadSentence(next, code, cfg.lang) ??
              (degraded ? t('live.degraded') : t('next.none', { team: label }))),
        ),
      );
    }
    out();
    out(disclaimer(t, c));
    // Post-tournament this is the ONLY branch `next` takes (no team has an
    // upcoming fixture), so the sign-off has to live here too — the early
    // return below would otherwise skip it on the one surface that needs it most.
    endScoreCommand(ctx);
    return;
  }
  out(header(t('next.label', { team: label }), c));
  out();
  for (const q of qualifiers) out(c.dim('  ' + q));
  // One row: its home column is measured on it, like a list's.
  out(matchLine(fixture, cfg, t, c, flags, homeColumn([fixture], flags)));
  // Localized (stageLabelI18n, like cmdBracket) — EN-only stageLabel here made
  // `next MEX --lang es` render "Round of 32" beside otherwise-Spanish copy.
  // A stage with nothing to say (an OTHER with no words) is no segment at all.
  const stage = fixture.stage !== 'GROUP' ? stageLabelI18n(cfg.lang, fixture) : '';
  // A match in play (off the bundle, `next` answers with it) has no countdown.
  const when = formatKickoff(fixture.kickoff, { tz: cfg.tz, locale: cfg.lang });
  out(
    '  ' +
      c.dim(
        joinSegments(
          isLive(fixture.status)
            ? [stage, when]
            : [stage, when, t('next.in', { countdown: countdown(fixture.kickoff) })],
        ),
      ),
  );
  out();
  // Attribute the provider when the live overlay resolved the fixture (a
  // knockout tie); a static group fixture carries no source.
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
  endScoreCommand(ctx);
}

/** `claudinho team <name|code>` — resolve a nation name/code to its FIFA code (offline). */
export function cmdTeam(query: string | undefined, ctx: Ctx): void {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const q = (query ?? '').trim();
  const { team, matches } = lookupTeam(q);

  if (cfg.json) {
    emitJson({ query: q, team: team ?? null, matches, count: matches.length });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  const label = (tm: { code: string; name: string; flag?: string; group?: string }) => {
    // The flag and its space only when there is one: nothing in its place.
    const flag = flags && tm.flag ? `${tm.flag} ` : '';
    const grp = tm.group ? ` · ${t('team.group', { group: tm.group })}` : '';
    return `  ${flag}${c.bold(tm.name)}  ${c.dim(tm.code + grp)}`;
  };
  out();
  if (!q) {
    out('  ' + c.dim(t('team.usage')));
  } else if (team) {
    out(label(team));
  } else if (matches.length > 0) {
    out('  ' + c.dim(t('team.ambiguous', { query: q })));
    for (const m of matches) out(label(m));
  } else {
    out('  ' + c.dim(t('team.none', { query: q })));
  }
  out();
  out(disclaimer(t, c));
  maybeStarNudge(ctx);
}

/** `claudinho table [group]` */
export async function cmdTable(group: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  // A table KEY (a group letter, `A1`, `A-B`, `LEAGUE`); anything that is not
  // one is refused before a request is made.
  const key = tableKeyOrThrow(group, t);
  // Authoritative, cumulative standings from the provider. Fails closed to a
  // degraded bundled roster only for a declared compatible scope; open-scope
  // competitions stay empty rather than borrowing World Cup teams.
  const result = await getStandings(adapterFor(ctx), key);
  const { tables, degraded, source } = result;

  if (cfg.json) {
    // Preserve the prior JSON shape: { group, standings: StandingRow[] } per table.
    const json = tables.map(tableData);
    emitJson({
      degraded,
      source: source ?? null,
      tables: key ? (json[0] ?? null) : json,
      ...verdictExtras(result),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  if (tables.length === 0) {
    out();
    // A degraded empty result means the provider was unavailable and no bundled
    // fallback belongs to this competition. Do not turn that into "no group".
    out(
      c.dim(
        '  ' +
          (degraded
            ? t('table.unavailable')
            : key
              ? t('table.none', { group: key })
              : t('table.empty')),
      ),
    );
    out();
    const src = dataSource(source, cfg.lang, c);
    if (src) out(src);
    out(disclaimer(t, c));
    return;
  }
  for (const { group: g, label, rows, partial } of tables) {
    out();
    // A lettered group keeps its localized title; any other table is the
    // provider's label and the key that selects it.
    out(header(label ? tableTitle({ group: g, label }) : t('table.title', { group: g }), c));
    const table = new Table({
      head: [
        t('col.team'),
        t('col.p'),
        t('col.w'),
        t('col.d'),
        t('col.l'),
        t('col.gd'),
        t('col.pts'),
      ],
      colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: cfg.color ? ['cyan'] : [], border: cfg.color ? ['gray'] : [] },
    });
    for (const r of rows) {
      table.push([
        tableTeamCell(r.team, flags),
        r.played,
        r.won,
        r.drawn,
        r.lost,
        r.goalDiff > 0 ? `+${r.goalDiff}` : `${r.goalDiff}`,
        cfg.color ? c.bold(`${r.points}`) : r.points,
      ]);
    }
    out(table.toString());
    // A table the provider served but we could not read in full says so (A01).
    if (partial) out(c.dim('  ' + t('table.partial', { n: String(partial.omitted) })));
  }
  out();
  // Degraded ⇒ rows are a static roster, not real results — say so, don't imply zeros are live.
  if (degraded) out(c.dim('  ' + t('table.degraded')));
  // Tables are missing: what is shown is not the whole competition. (After the
  // tables here, where it always was; the surfaces that learned a qualifier
  // later print it before the body.)
  for (const q of verdictQualifiers(result, cfg.lang)) out(c.dim('  ' + q));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
  maybeStarNudge(ctx);
}

/**
 * The table key an argument asks for (upper-cased), or undefined when none was
 * given. A string that is not a key at all is a usage error, like a date that
 * is not a date: it must not reach the provider or come back as "no group".
 */
function tableKeyOrThrow(raw: string | undefined, t: Ctx['t']): string | undefined {
  if (raw === undefined) return undefined;
  const key = tableKeyArg(raw);
  if (!key) throw new InputError(t('table.badKey', { key: humanLabel(raw, 24) }));
  return key;
}

const BRACKET_STAGES = new Set(['R32', 'R16', 'QF', 'SF', '3P', 'F']);

/** `claudinho bracket [stage]` */
export async function cmdBracket(
  stage: string | undefined,
  opts: { tree?: boolean },
  ctx: Ctx,
): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const filter = stage?.toUpperCase();
  if (filter && !BRACKET_STAGES.has(filter)) {
    throw new InputError(i18n(cfg.lang, 'bracket.invalidStage'));
  }
  const bracket = await getBracket(
    adapterFor(ctx),
    filter ? { stage: filter as Stage, lang: cfg.lang } : { lang: cfg.lang },
  );
  const { view, degraded, standingsDegraded, source } = bracket;
  // A verdict that REPLACES the tree; one that qualifies it is printed beside it (below).
  const notice = verdictNotice(bracket, cfg.lang);
  if (notice !== undefined) {
    // No World Cup topology off the bundle: the notice, nothing else (A03).
    if (cfg.json) {
      emitJson({ degraded, standingsDegraded, source: null, view, ...verdictExtras(bracket) });
      return;
    }
    const c = painterFor(cfg);
    out();
    out(c.dim(`  ${notice}`));
    out();
    out(disclaimer(t, c));
    return;
  }

  if (cfg.json) {
    emitJson({
      degraded,
      standingsDegraded,
      source: source ?? null,
      view,
      ...verdictExtras(bracket),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  const formatOpts = { flags, tz: cfg.tz, locale: cfg.lang, footer: false };
  let body: string;
  if (opts.tree) {
    const tree = formatBracketTree(view, {
      ...formatOpts,
      width: process.stdout.columns ?? 80,
    });
    body = tree ?? formatBracketList(view, formatOpts);
    if (!tree) {
      out();
      out(c.dim(`  ${i18n(cfg.lang, 'bracket.treeFallback')}`));
    }
  } else {
    body = formatBracketList(view, formatOpts);
  }

  out();
  out(header(
    filter
      ? i18n(cfg.lang, 'bracket.stageTitle', { stage: stageLabelI18n(cfg.lang, { stage: filter as Stage }) })
      : i18n(cfg.lang, 'bracket.title'),
    c,
  ));
  // The window was not whole: said before the tree it qualifies, which is kept.
  for (const q of verdictQualifiers(bracket, cfg.lang)) out(c.dim(`  ${q}`));
  out(body);
  out();
  if (degraded) out(c.dim(`  ${i18n(cfg.lang, 'bracket.degraded')}`));
  else if (standingsDegraded) out(c.dim(`  ${i18n(cfg.lang, 'bracket.standingsDegraded')}`));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
  maybeStarNudge(ctx);
}

/**
 * `claudinho prompt` — the HOT PATH. Reads the cache, prints one line, and (if
 * warranted) fires a detached refresher. Synchronous, no network, never throws.
 */
export function cmdPrompt(
  { cfg }: Ctx,
  io: { cursor?: CursorStatusLinePayload } = {},
): void {
  try {
    // The binary pre-drains stdin with a BOUNDED wait and passes the payload in
    // (see index.ts / readCursorPayloadBounded — a writerless open pipe must not
    // hang the statusline; PR #77's 62-min Windows CI hang was this). The sync
    // fallback remains for direct in-process callers (tests mock it).
    const payload = 'cursor' in io ? io.cursor : readCursorPayload();
    // Name-or-code, like the commands (offline lookup — hot-path safe).
    const team = resolveEnvTeam(process.env.CLAUDINHO_TEAM, cfg.competition);
    const compact = !['0', 'false', 'no'].includes(
      (process.env.CLAUDINHO_COMPACT ?? '').toLowerCase(),
    );
    const maxRaw = Number.parseInt(process.env.CLAUDINHO_MAX ?? '', 10);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;
    // Only trust a snapshot fetched for this invocation's source + competition.
    const state = readCurrentState(cfg.source, cfg.competition);
    const scoreLine = renderPrompt(state, {
      team,
      compact,
      max,
      flags: flagsEnabled(),
      // The bundled schedule describes the bundled competition only — see the
      // sign-off gate in renderPrompt.
      defaultCompetition: bundleApplies(cfg.competition),
      // The competition's written kind: a nation's flag is generated, a club has none.
      teamKind: teamKind(cfg.competition),
    });
    out(renderPromptOutput(scoreLine, payload));
    // Spawn a background refresh for live scores OR stale knockout fixtures (the
    // latter keeps the next-match countdown live outside live windows). Pass the
    // already-read state so the checks add no extra cache read. The no-cache
    // branch is lock-deduped like the others: N concurrent statusline ticks on a
    // fresh install must fork one refresher, not N (and the refresher always
    // writes a snapshot, so this branch fires once, never per-tick forever).
    if (refreshWanted(Date.now(), state, cfg.competition, cfg.source)) {
      spawnRefresh(cfg.source, cfg.competition);
    }
  } catch {
    // The statusline must always succeed; print nothing rather than error.
    out('');
  }
}

/**
 * `claudinho hook` — UserPromptSubmit hook. Prints live-score context (only
 * during matches) for Claude Code to inject; silent otherwise. Like the
 * statusline, it reads the cache only and triggers a background refresh, and
 * MUST never fail (a non-zero exit could block the user's prompt).
 */
export function cmdHook({ cfg }: Ctx): void {
  try {
    // Name-or-code, like the commands (offline lookup — hot-path safe).
    const team = resolveEnvTeam(process.env.CLAUDINHO_TEAM, cfg.competition);
    // Only trust a snapshot fetched for this invocation's source + competition.
    const state = readCurrentState(cfg.source, cfg.competition);
    const ctx = renderHook(state, {
      team,
      flags: flagsEnabled(),
      // The bundled roster names World Cup nations only; on another competition
      // a club sharing a nation's code must not be renamed to that nation.
      defaultCompetition: bundleApplies(cfg.competition),
      // The competition's written kind: a nation's flag is generated, a club has none.
      teamKind: teamKind(cfg.competition),
    });
    if (ctx) out(ctx);
    // Warm the same cache the statusline reads, for parity (the hook itself shows
    // only live scores). Spawn for live OR stale knockout fixtures; the no-cache
    // branch is lock-deduped (see cmdPrompt).
    if (refreshWanted(Date.now(), state, cfg.competition, cfg.source)) {
      spawnRefresh(cfg.source, cfg.competition);
    }
  } catch {
    // Never block the prompt — emit nothing on any error.
  }
}

/** `claudinho _refresh` — internal cold-path cache refresher. */
export async function cmdRefresh({ cfg }: Ctx): Promise<void> {
  await runRefresh({ source: cfg.source, competition: cfg.competition });
}

function printInitResult(res: InitResult, cfg: CliConfig): void {
  const c = painterFor(cfg);
  if (res.action === 'printed') {
    out(res.message);
    return;
  }
  const mark =
    res.action === 'written' ? c.green('✓') : res.action === 'already' ? c.cyan('•') : c.yellow('!');
  out(`${mark} ${res.message}`);
}

/** `claudinho init-statusline` — patch Claude Code settings.json. */
export function cmdInitStatusline(
  opts: { print?: boolean; command?: string },
  { cfg }: Ctx,
): void {
  const res = initStatusline({ print: opts.print, command: opts.command });
  printInitResult(res, cfg);
  if (!opts.print && res.action === 'written') printInitStarCta(cfg);
}

/** `claudinho init-hook` — wire the live-score UserPromptSubmit hook. */
export function cmdInitHook(opts: { print?: boolean; command?: string }, { cfg }: Ctx): void {
  const res = initHook({ print: opts.print, command: opts.command });
  printInitResult(res, cfg);
  if (!opts.print && res.action === 'written') printInitStarCta(cfg);
}

/** `claudinho init-cursor-statusline` — patch ~/.cursor/cli-config.json. */
export function cmdInitCursorStatusline(
  opts: { print?: boolean; command?: string },
  { cfg }: Ctx,
): void {
  const res = initCursorStatusline({ print: opts.print, command: opts.command });
  printInitResult(res, cfg);
  if (!opts.print && res.action === 'written') printInitStarCta(cfg);
}

/**
 * MCP config for Cursor — a paste (Cursor has no `mcp add` CLI, unlike Claude
 * Code). Exported so a test can pin it to the same `npx -y @claudinho/mcp`
 * command as the plugin's root `mcp.json` (drift guard — see init.test.ts).
 */
export const CURSOR_MCP_SNIPPET = `{
  "mcpServers": {
    "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] }
  }
}`;

/** The Claude Code MCP install one-liner (the `claude` CLI writes the config). */
const CLAUDE_MCP_ONELINER = 'claude mcp add claudinho -- npx -y @claudinho/mcp';

/**
 * `claudinho init cursor` — one-step Cursor CLI setup: wire the statusline, then
 * surface the MCP config (a paste — Cursor has no `mcp add`) and the restart cue.
 * `--print` emits the raw snippets only (manual install, no file writes).
 */
export function cmdInitCursor(opts: { print?: boolean }, { cfg }: Ctx): void {
  if (opts.print) {
    out('# 1) Cursor CLI statusline  →  ~/.cursor/cli-config.json');
    printInitResult(initCursorStatusline({ print: true }), cfg);
    out('');
    out('# 2) MCP tools (optional)  →  ~/.cursor/mcp.json  (or project .cursor/mcp.json)');
    out(CURSOR_MCP_SNIPPET);
    return;
  }
  const res = initCursorStatusline();
  printInitResult(res, cfg);
  out('');
  out('Optional — live MCP tools in Cursor: add to ~/.cursor/mcp.json (or project .cursor/mcp.json):');
  out(CURSOR_MCP_SNIPPET);
  out('');
  out('Tip: export CLAUDINHO_CURSOR_META=auto for a model + context line below the score.');
  out('');
  out('→ Restart your agent session to see it.');
  if (res.action === 'written') printInitStarCta(cfg);
}

/**
 * `claudinho init claude` — one-step Claude Code setup, parity with `init cursor`:
 * wire the statusline AND the live-score hook, then print the MCP add one-liner.
 * `--print` emits the raw snippets + the one-liner only (no file writes).
 */
export function cmdInitClaude(opts: { print?: boolean }, { cfg }: Ctx): void {
  if (opts.print) {
    out('# 1) Claude Code statusline  →  ~/.claude/settings.json');
    printInitResult(initStatusline({ print: true }), cfg);
    out('');
    out('# 2) Live-score hook  →  ~/.claude/settings.json');
    printInitResult(initHook({ print: true }), cfg);
    out('');
    out('# 3) MCP tools (run this):');
    out(CLAUDE_MCP_ONELINER);
    return;
  }
  const statusRes = initStatusline();
  const hookRes = initHook();
  printInitResult(statusRes, cfg);
  printInitResult(hookRes, cfg);
  out('');
  out('Next — add the MCP server:');
  out(`  ${CLAUDE_MCP_ONELINER}`);
  out('');
  out('→ Restart Claude Code to see it.');
  if (statusRes.action === 'written' || hookRes.action === 'written') printInitStarCta(cfg);
}

/** `claudinho match <id>` */
export async function cmdMatch(id: string, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  // ±1-day window fetch: the provider buckets scoreboard days in its own zone,
  // so fetching only the fixture's UTC date can miss its live/final state.
  // Off the bundled competition the id is looked for in the schedule ahead.
  const found = await getMatchById(adapterFor(ctx), id, ctx.now);
  const { match, degraded, source: liveSource } = found;

  const market = match
    ? await reliableMarketSignalFor(ctx, match)
    : { signal: undefined, complete: true };

  if (cfg.json) {
    emitJson({
      degraded,
      match: match ?? null,
      source: liveSource ?? null,
      // The match, if the overlay held it (a plain field, not a verdict), beside `partial` only.
      ...servedExtras(found, match ? [match] : []),
      marketComplete: market.complete,
      marketSignal: market.signal ?? null,
      // The span a whole read searched for an id it did not hold (a plain field).
      ...(found.window ? { window: found.window } : {}),
      ...verdictExtras(found),
    });
    return;
  }

  const c = painterFor(cfg);
  // What qualifies the answer (a read that was not whole) is said before it.
  const qualifiers = verdictQualifiers(found, cfg.lang);
  out();
  if (!match) {
    for (const q of qualifiers) out(c.dim('  ' + q));
    // An outage is never "no such match"; a verdict, then the span a whole
    // read searched (or "none read" for one that was not whole), then "no match found".
    out(
      c.dim(
        '  ' +
          (degraded
            ? t('live.degraded')
            : (verdictNotice(found, cfg.lang) ??
              matchWindowSentence(found, id, cfg.lang) ??
              matchNoneReadSentence(found, id, cfg.lang) ??
              t('match.none', { id }))),
      ),
    );
    out();
    out(disclaimer(t, c));
    return;
  }
  for (const q of qualifiers) out(c.dim('  ' + q));
  // The day's rule over the one record shown: on a read that was not whole, a
  // record the window did not hold is the bundle's row, its live state unconfirmed.
  const attribution = dayAttribution(found, [match], cfg.lang);
  if (attribution.unserved) out(c.dim('  ' + attribution.unserved));
  out(header(`${match.home.name} ${scoreline(match)} ${match.away.name}`, c));
  // The stage and the location, joined with the empty ones dropped: an OTHER
  // with no words, or a record with no venue, leaves no dangling separator.
  const where = joinSegments([stageLabelI18n(cfg.lang, match), matchLocation(match)]);
  if (where) out('  ' + c.dim(where));
  out(
    '  ' +
      c.dim(
        `${formatKickoff(match.kickoff, { tz: cfg.tz, locale: cfg.lang })}  ${statusToken(match, t, c)}`.trimEnd(),
      ),
  );
  const flair = matchFlavor(match, { level: cfg.flavor, locale: cfg.lang });
  if (flair) out('  ' + c.cyan(flair));
  if (match.events?.length) {
    out();
    for (const e of match.events) {
      out(`  ${e.minute}'  ${e.type}  ${e.teamCode}${e.player ? ` — ${e.player}` : ''}`);
    }
  }
  if (market.signal) {
    out();
    for (const mline of marketBlock(market.signal, match)) out('  ' + c.dim(mline));
  }
  if (!market.complete) {
    out();
    out(c.dim('  Market data unavailable or incomplete — this match could not be checked.'));
  }
  out();
  // Live overlay failed → this is the static fixture with no live state. Say
  // so. Off the bundled competition there is no static fixture: it is the
  // provider's own earlier record, whose state could not be refreshed.
  if (degraded) out(c.dim('  ' + t(found.earlierRecord ? 'feed.earlierRecord' : 'feed.degraded')));
  const src = dataSource(liveSource, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
  maybeStarNudge(ctx);
}

// Market copy is English-only in v1 (the approved legal copy bank); the base
// FIFA/Anthropic disclaimer stays localized via t('disclaimer').
const MARKET_INFO = 'Prediction-market data is informational only.';

/**
 * Header for a market read. Includes the kickoff date — "South Korea (Jun 18)"
 * and "South Africa (today)" are one skim apart, and a dated header is what
 * stops a reader (or an agent) conflating a future fixture's read with the
 * match being played right now.
 */
function marketHeaderLine(m: Match, cfg: CliConfig): string {
  const when = formatDate(m.kickoff, { tz: cfg.tz, locale: cfg.lang });
  return `${withFlag(m.home.name, m.home.flag, 'home')} vs ${withFlag(m.away.name, m.away.flag, 'away')} · ${when}`;
}

/** Null-signal line, specific about finished matches (market reads are pre-match). */
function noSignalLine(m: Match, now: Date, competition: string): string {
  if (!marketsCoverCompetition(competition)) return MARKETS_SCOPE_NOTE;
  if (marketRelevant(m, now)) return 'No market signal for this match.';
  // "has finished" only when a live overlay confirmed it; a static fixture
  // whose window merely lapsed gets the honest, hedged variant.
  return isFinished(m.status)
    ? 'Match has finished — market signals are pre-match and in-play reads.'
    : 'Match appears to have finished — market signals are pre-match and in-play reads.';
}

function printMarketBlock(m: Match, sig: MarketSignal, c: Painter): void {
  for (const line of marketBlock(sig, m)) out('    ' + c.dim(line));
}

/**
 * `claudinho markets [target] [team]` — read-only prediction-market signals.
 *   markets              → today's signals
 *   markets today        → today's signals
 *   markets 2026-06-11   → that date's signals
 *   markets 760415       → one match's signal
 *   markets next MEX     → a team's next fixture
 * This dedicated surface is always opt-in, so it shows any cleanly-mapped signal
 * (with a stale caveat when applicable) rather than the strict default-on gate.
 */
export async function cmdMarkets(
  target: string | undefined,
  team: string | undefined,
  ctx: Ctx,
): Promise<void> {
  const { cfg, t } = ctx;

  // markets next <team> — prefers the team's IN-PLAY match when one is live:
  // mid-match, "what do markets say about MEX" means the match being played,
  // not next week's (whose thin market would gate to an empty answer).
  if (target === 'next') {
    precheck(cfg, t);
    const code = resolveTeamArg(
      team,
      'Usage: claudinho markets next <team> (or set CLAUDINHO_TEAM)',
      t,
      cfg.competition,
    );
    const now = ctx.now ?? new Date();
    // Live-confirmed selection: handles extra time past the static window AND
    // early FTs inside it (the static fixture's status is forever SCHEDULED).
    const picked = await marketFixtureForTeam(adapterFor(ctx), code, now);
    const { match: fixture, degraded } = picked;
    const market =
      fixture && marketRelevant(fixture, now)
        ? await marketSignalsFor(ctx, [fixture], MARKETS_CMD_OPTS)
        : { signals: new Map<string, MarketSignal>(), complete: true };
    const sig = fixture ? market.signals.get(fixture.id) : undefined;
    const shown =
      market.complete && fixture && sig && marketDisplayable(fixture, sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({
        team: code,
        matchId: fixture?.id ?? null,
        degraded,
        informationalOnly: true,
        complete: market.complete,
        signal: shown ?? null,
        // Review P2 on #129: a JSON consumer must tell "not available for this
        // competition" from a successful empty result; the text branch already did.
        ...verdictExtras(picked),
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    // The fixture read was not whole (either of the two reads the pick was
    // made from): said before the answer, apart from the market's own
    // completeness, which is about the market requests.
    for (const q of verdictQualifiers(picked, cfg.lang)) out(c.dim('  ' + q));
    if (!fixture) {
      // Feed unavailable can't resolve a knockout tie — say so, vs "no fixture".
      out(
        c.dim(
          '  ' +
            (verdictNotice(picked, cfg.lang) ??
              (degraded ? t('live.degraded') : t('next.none', { team: code }))),
        ),
      );
    } else {
      out(header(marketHeaderLine(fixture, cfg), c));
      out();
      if (shown) printMarketBlock(fixture, shown, c);
      else if (!market.complete) {
        out(c.dim('    Market data unavailable or incomplete — this match could not be checked.'));
      } else out(c.dim('    ' + noSignalLine(fixture, now, cfg.competition)));
    }
    out();
    out(disclaimer(t, c));
    out(c.dim(MARKET_INFO));
    return;
  }

  // markets <id>  (anything that isn't a date or the "today" keyword)
  if (target && target !== 'today' && !isValidDate(target)) {
    precheck(cfg, t);
    const now = ctx.now ?? new Date();
    // The market's scope is asked BEFORE any match lookup: off it nothing is
    // read for this competition, so no request is made to find the match.
    const scope = marketScopeVerdict(cfg.competition, 0);
    const outOfScope = verdictNotice(scope, cfg.lang);
    if (outOfScope !== undefined) {
      if (cfg.json) {
        emitJson({
          matchId: target,
          informationalOnly: true,
          complete: true,
          signal: null,
          ...verdictExtras(scope),
        });
        return;
      }
      const c = painterFor(cfg);
      out();
      out(c.dim('  ' + outOfScope));
      out();
      out(disclaimer(t, c));
      out(c.dim(MARKET_INFO));
      return;
    }
    // Live overlay (±1-day window) so FT gates the resolved market correctly.
    const found = await getMatchById(adapterFor(ctx), target);
    const { match } = found;
    const market =
      match && marketRelevant(match, now)
        ? await marketSignalsFor(ctx, [match], MARKETS_CMD_OPTS)
        : { signals: new Map<string, MarketSignal>(), complete: true };
    const sig = match ? market.signals.get(match.id) : undefined;
    const shown = market.complete && match && sig && marketDisplayable(match, sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({
        matchId: target,
        informationalOnly: true,
        complete: market.complete,
        signal: shown ?? null,
        ...verdictExtras(found),
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    // The fixture read was not whole: said before the answer (as `match` says
    // it), apart from the market's own completeness.
    for (const q of verdictQualifiers(found, cfg.lang)) out(c.dim('  ' + q));
    if (!match) {
      out(c.dim('  ' + (verdictNotice(found, cfg.lang) ?? t('match.none', { id: target }))));
    } else {
      out(header(marketHeaderLine(match, cfg), c));
      out();
      if (shown) printMarketBlock(match, shown, c);
      else if (!market.complete) {
        out(c.dim('    Market data unavailable or incomplete — this match could not be checked.'));
      } else out(c.dim('    ' + noSignalLine(match, now, cfg.competition)));
    }
    out();
    out(disclaimer(t, c));
    out(c.dim(MARKET_INFO));
    return;
  }

  // markets [today | <date>]
  const explicitDate = target && target !== 'today' ? target : undefined;
  precheck(cfg, t, explicitDate);
  const now = ctx.now ?? new Date();
  const date = explicitDate ?? localDate(now.toISOString(), cfg.tz);
  const day = await getMatchesForDate(adapterFor(ctx), date, resolveTz(cfg.tz));
  const todays = fixturesByDate(date, day.matches, cfg.tz);
  const relevant = todays.filter((m) => marketRelevant(m, now));
  const { signals, complete } = await marketSignalsFor(ctx, relevant, MARKETS_CMD_OPTS);
  const rows = relevant
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.match, r.signal),
    );
  // The fixture read's verdict is part of the answer where markets are read
  // (off their scope the scope verdict is the whole answer, as before).
  const fixtureRead = marketsCoverCompetition(cfg.competition) ? day : {};

  if (cfg.json) {
    const marketSignals: Record<string, MarketSignal> = {};
    for (const r of rows) marketSignals[r.match.id] = r.signal;
    // `complete` distinguishes "checked everything, found none" from "could not
    // check". Without it a consumer of `--json` cannot tell an outage from a
    // quiet day, which is the same gap the text branch had. It describes the
    // market requests; the fixture read's own verdict rides beside it.
    emitJson({
      date,
      informationalOnly: true,
      complete,
      marketSignals,
      // Off the markets' scope, "none" means "not read for this competition".
      ...verdictExtras(marketScopeVerdict(cfg.competition, rows.length)),
      ...verdictExtras(fixtureRead),
    });
    return;
  }

  const c = painterFor(cfg);
  out();
  out(header(`Market signals · ${date}`, c));
  out();
  // The fixture read was not whole: said before the answer, apart from the
  // market's own completeness.
  for (const q of verdictQualifiers(fixtureRead, cfg.lang)) out(c.dim('  ' + q));
  if (rows.length === 0) {
    out(
      c.dim(
        !marketsCoverCompetition(cfg.competition)
          ? `  ${MARKETS_SCOPE_NOTE}`
          : complete
            ? `  ${marketsNoneRead(day, date) ?? `No market signals available for ${date}.`}`
            : `  Market data unavailable or incomplete for ${date} — not all fixtures could be checked.`,
      ),
    );
  } else {
    for (const { match, signal } of rows) {
      out('  ' + c.bold(marketHeaderLine(match, cfg)));
      printMarketBlock(match, signal, c);
      out();
    }
    if (!complete) {
      out(c.dim(`  Market data unavailable or incomplete for ${date} — not all fixtures could be checked.`));
      out();
    }
  }
  out(disclaimer(t, c));
  out(c.dim(MARKET_INFO));
}

/* ──────────────────────────── share ──────────────────────────── */

type ShareCliOpts = {
  style?: string;
  /** false when --no-hashtag is passed (commander negatable). */
  hashtag?: boolean;
  /** false when --no-install-line is passed (commander negatable). */
  installLine?: boolean;
  /** true when --copy is passed. */
  copy?: boolean;
};

/** Only `social`/`compact` ship in v1; anything else falls back to `social`. */
function pickShareStyle(v: string | undefined): ShareStyle {
  return v === 'compact' ? 'compact' : 'social';
}

/**
 * Reliable signals for a shareable snippet. Snippets are public artifacts, so
 * this fails closed via the strict default-on gate (`reliableMarketSignals`,
 * which also honors `--no-markets`). The `marketDisplayable` pass is a defensive
 * re-assert — the reliability gate already implies it (unambiguous + has a
 * favorite + sane distribution) — kept so the two gates can diverge safely.
 */
async function reliableShareSignals(
  ctx: Ctx,
  matches: Match[],
): Promise<MarketSignalsResult> {
  const raw = await reliableMarketSignals(ctx, matches);
  const out = new Map<string, MarketSignal>();
  for (const [id, s] of raw.signals) {
    const m = matches.find((x) => x.id === id);
    if (m && marketDisplayable(m, s)) out.set(id, s);
  }
  return { signals: out, complete: raw.complete };
}

/**
 * Emit one share card — the snippet as text, or the snippet plus its structured
 * twin as JSON — then best-effort copy the snippet to the clipboard.
 *
 * ONE emitter for every kind of card. Three near-copies used to differ only in
 * which fields their JSON carried, and each had to remember the card's verdict
 * for itself (a review found `share --json` dropping one twice). The cards come
 * assembled from core (`*ShareCard`), verdict included; the JSON builders below
 * only fix the key order `--json` has always had.
 */
function emitCard(ctx: Ctx, snippet: string, json: Record<string, unknown>, copy: boolean): void {
  if (ctx.cfg.json) emitJson(json);
  else out(snippet);
  // Clipboard is additive and orthogonal to the output mode; its status goes to
  // stderr so stdout stays a clean, pasteable artifact (and clean JSON).
  if (copy) {
    const ok = (ctx.copy ?? copyToClipboard)(snippet);
    process.stderr.write(
      (ok
        ? 'Copied share snippet to clipboard.'
        : 'Clipboard unavailable; printed snippet instead.') + '\n',
    );
  }
}

/** A match card: today's fixtures, live matches, a team's next fixture, one match. */
function emitMatchCard(
  ctx: Ctx,
  card: MatchShareCard,
  options: ShareSnippetOptions,
  copy: boolean,
): void {
  const snippet = formatShareSnippet(card.input, options);
  emitCard(
    ctx,
    snippet,
    {
      kind: card.kind,
      target: card.target,
      ...(card.team ? { team: card.team } : {}),
      ...(card.candidates ? { candidates: card.candidates } : {}),
      source: card.input.source ?? null,
      // The card's read's plain fields (the ids it held, beside `partial` only).
      ...card.readFields,
      degraded: card.input.degraded ?? false,
      informationalOnly: true,
      style: options.style ?? 'social',
      snippet,
      matches: card.input.matches,
      marketComplete: card.input.marketComplete ?? true,
      marketSignals: Object.fromEntries(card.input.marketSignals ?? new Map()),
      // The span an empty card says was searched (horizon, window): plain fields.
      ...card.span,
      // The structured card keeps the verdict the snippet's note carries.
      ...card.verdict,
    },
    copy,
  );
}

/** A standings card. */
function emitTableCard(
  ctx: Ctx,
  card: TableShareCard,
  options: ShareSnippetOptions,
  copy: boolean,
): void {
  const snippet = formatShareTable(card.input, options);
  emitCard(
    ctx,
    snippet,
    {
      kind: 'table',
      target: 'table',
      ...(card.group ? { group: card.group } : {}),
      source: card.source ?? null,
      degraded: card.degraded,
      informationalOnly: true,
      snippet,
      // The structured card keeps the verdict the snippet warns about (A01).
      tables: card.tables,
      ...card.verdict,
    },
    copy,
  );
}

/** A knockout bracket card. */
function emitBracketCard(
  ctx: Ctx,
  card: BracketShareCard,
  options: ShareBracketOptions,
  copy: boolean,
): void {
  const snippet = formatShareBracket(card.input, options);
  emitCard(
    ctx,
    snippet,
    {
      kind: 'bracket',
      target: 'bracket',
      ...(card.stage ? { stage: card.stage } : {}),
      source: card.source ?? null,
      degraded: card.degraded,
      informationalOnly: true,
      snippet,
      view: card.input.view,
      // Top-level, like `bracket --json`.
      ...card.verdict,
    },
    copy,
  );
}

/**
 * `claudinho share [target] [team]` — a polished, copy-pasteable match snippet
 * for chats, social posts, READMEs, and issues.
 *   share / share today      → today's fixtures
 *   share live               → matches in play
 *   share 2026-06-11         → that date's fixtures
 *   share 760415             → one match
 *   share next MEX           → a team's next fixture
 * Market lines come from the approved copy bank and use the same reliable gate
 * as default views; the non-affiliation disclaimer is always included. Snippets
 * are plain text (no ANSI) so they paste cleanly everywhere.
 */
export async function cmdShare(
  target: string | undefined,
  team: string | undefined,
  opts: ShareCliOpts,
  ctx: Ctx,
): Promise<void> {
  const { cfg, t } = ctx;
  const baseOptions: ShareSnippetOptions = {
    style: pickShareStyle(opts.style),
    includeMarkets: cfg.markets !== false,
    includeHashtag: opts.hashtag !== false,
    includeInstallLine: opts.installLine !== false,
  };
  const copy = opts.copy === true;

  // The competition goes on the card: off the bundle its run cue names it.
  const where = { tz: cfg.tz, locale: cfg.lang, competition: cfg.competition };

  // share live — lean: no market enrichment (and no extra fetch).
  if (target === 'live') {
    precheck(cfg, t);
    const live = await getLiveMatches(adapterFor(ctx), ctx.now ?? new Date());
    emitMatchCard(ctx, liveShareCard(live, where), { ...baseOptions, includeMarkets: false }, copy);
    return;
  }

  // share table [group] — a standings card (facts only; no market lines)
  if (target === 'table') {
    precheck(cfg, t);
    const group = tableKeyOrThrow(team, t);
    emitTableCard(
      ctx,
      tableShareCard(await getStandings(adapterFor(ctx), group), group, undefined, cfg.lang, cfg.competition),
      baseOptions,
      copy,
    );
    return;
  }

  // share bracket [stage] — knockout bracket card
  if (target === 'bracket') {
    precheck(cfg, t);
    const stageFilter = team?.toUpperCase();
    if (stageFilter && !BRACKET_STAGES.has(stageFilter)) {
      throw new InputError(i18n(cfg.lang, 'bracket.invalidStage'));
    }
    const bracket = await getBracket(
      adapterFor(ctx),
      stageFilter
        ? { stage: stageFilter as Stage, lang: cfg.lang }
        : { lang: cfg.lang },
    );
    emitBracketCard(
      ctx,
      bracketShareCard(bracket, stageFilter, cfg.lang, cfg.competition),
      {
        includeHashtag: baseOptions.includeHashtag,
        includeInstallLine: baseOptions.includeInstallLine,
        locale: cfg.lang,
        style: baseOptions.style,
        tz: cfg.tz,
      },
      copy,
    );
    return;
  }

  // share next <team>
  if (target === 'next') {
    precheck(cfg, t);
    const code = teamQuery(
      team,
      'Usage: claudinho share next <team> (or set CLAUDINHO_TEAM)',
      t,
      cfg.competition,
    );
    // Live-resolved (see cmdNext): overlay the knockout window so a confirmed
    // R32+ tie pastes here too, not just group games.
    const next = await getNextFixtureForTeam(adapterFor(ctx), code, ctx.now ?? new Date());
    const market = await reliableShareSignals(ctx, next.fixture ? [next.fixture] : []);
    emitMatchCard(ctx, nextShareCard(next, code, market, where), baseOptions, copy);
    return;
  }

  // share <id>  (anything that isn't a date or the "today" keyword)
  if (target && target !== 'today' && !isValidDate(target)) {
    precheck(cfg, t);
    // ±1-day window fetch (see cmdMatch): the provider's scoreboard day can
    // differ from the fixture's UTC date.
    const found = await getMatchById(adapterFor(ctx), target, ctx.now);
    const market = await reliableShareSignals(ctx, found.match ? [found.match] : []);
    emitMatchCard(ctx, matchShareCard(found, target, market, where), baseOptions, copy);
    return;
  }

  // share [today | <date>]
  const explicitDate = target && target !== 'today' ? target : undefined;
  precheck(cfg, t, explicitDate);
  const date = explicitDate ?? localDate((ctx.now ?? new Date()).toISOString(), cfg.tz);
  const day = await getMatchesForDate(adapterFor(ctx), date, resolveTz(cfg.tz));
  const { matches: all, degraded, source } = day;
  const todays = fixturesByDate(date, all, cfg.tz);
  const market = await reliableShareSignals(ctx, todays);
  emitMatchCard(
    ctx,
    dateShareCard(
      {
        date,
        explicit: explicitDate !== undefined,
        matches: todays,
        degraded,
        source,
        // The read decides what an empty day says (whether it merged the
        // bundled schedule) and the card's attribution (what it served).
        read: day,
      },
      market,
      where,
    ),
    baseOptions,
    copy,
  );
}

/**
 * `vibe` — a tiny easter egg. Prints a random matchday-coder one-liner signed
 * with the project's social tag. No network and no i18n (the Spanglish is the
 * joke); a best-effort COLD cache read (never the hot path) lets the line nod
 * to a live score, and the static schedule flavors opening/final day.
 * #VibingLaVidaLoca
 */
const VIBES = [
  'Shipping code, watching goals.',
  'Green tests, green pitch.',
  'Pelota al pie, manos al teclado.',
  'Refactoring through the group stage.',
  'Merge conflicts can wait — it’s matchday.',
  'One feed for the world, one vibe for the dev.',
  'Stoppage time and a clean stack trace.',
  'Coding into extra time.',
];
const VIBES_OPENER = [
  'Day one of the tournament. Save your work — it’s about to get loud.',
  'Opening day: fresh bracket, fresh branch.',
];
const VIBES_FINAL = [
  'Final day. One last build, one last whistle.',
  'Ship it before the trophy does.',
];

/**
 * The live-score segment for a vibe line, e.g. "🇰🇷 1–1 🇨🇿 69'" (a club's sides
 * by their codes: "ARS 2–1 CHE 50'"). Prefers the
 * CLAUDINHO_TEAM match, else the first live match; undefined when nothing is
 * live. Pure — exported for tests.
 */
export function vibeLiveSegment(live: readonly Match[], team?: string): string | undefined {
  const code = team?.toUpperCase();
  const pick =
    (code && live.find((m) => m.home.code === code || m.away.code === code)) ?? live[0];
  if (!pick) return undefined;
  const minute = pick.status === 'HT' ? 'HT' : pick.minute ? `${pick.minute}'` : 'LIVE';
  // A side's flag, or its code when it has none (a club): nothing in its place.
  const tok = (side: Match['home']) => side.flag || side.code;
  return `${tok(pick.home)} ${scoreline(pick)} ${tok(pick.away)} ${minute}`;
}

/** The vibe pool for a local date: opener/final days mix in themed lines. */
export function vibePool(todayLocal: string, fixtures: Match[] = allFixtures()): string[] {
  let first: string | undefined;
  let last: string | undefined;
  for (const m of fixtures) {
    const d = m.kickoff.slice(0, 10);
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  if (todayLocal === first) return [...VIBES, ...VIBES_OPENER];
  if (todayLocal === last) return [...VIBES, ...VIBES_FINAL];
  return VIBES;
}

/**
 * `claudinho star` — how to support the project. Pure copy + a link, no network.
 * The interactive commands also surface a one-line nudge occasionally (see
 * `maybeStarNudge`); this is the explicit, always-available version.
 */
export function cmdStar(ctx: Ctx): void {
  const { cfg } = ctx;
  if (cfg.json) {
    emitJson({ repo: REPO_URL, hashtag: '#VibingLaVidaLoca' });
    return;
  }
  const c = painterFor(cfg);
  out();
  out('  ' + c.bold('⭐ Star Claudinho on GitHub'));
  out('  ' + c.cyan(REPO_URL));
  out();
  out('  ' + c.dim('Built for devs & fans · #VibingLaVidaLoca ⚽'));
  out('  ' + c.dim('Live World Cup scores in your terminal, Claude Code & Cursor — no API keys.'));
  out();
}

/**
 * A one-line, color-dimmed star nudge appended to interactive human commands on
 * every Nth TTY run. NEVER on the hot path (statusline/hook never call this), in
 * `--json`, when piped (not a TTY), or when CLAUDINHO_NO_STAR is set.
 */
function maybeStarNudge(ctx: Ctx): void {
  if (ctx.cfg.json || !process.stdout.isTTY || process.env.CLAUDINHO_NO_STAR) return;
  const n = bumpRunCount();
  if (n === undefined || !shouldNudge(n)) return;
  const c = painterFor(ctx.cfg);
  out();
  out(c.dim(`  ⭐ Enjoying Claudinho? Star it → ${REPO_URL}   (claudinho star)`));
}

/**
 * Tail for the three score commands (`today`/`live`/`next`). Once the bundled
 * schedule is spent they'd print an unexplained empty result, so sign off
 * instead — and never alongside the every-Nth nudge, so a run shows one CTA,
 * not two.
 *
 * Gated on the DEFAULT competition: the bundled schedule describes the World
 * Cup, so with `CLAUDINHO_COMPETITION` pointing elsewhere its "windows elapsed"
 * answer says nothing about that feed, and appending a World Cup goodbye to a
 * live alternate competition would simply be wrong.
 */
function endScoreCommand(ctx: Ctx): void {
  const over =
    bundleApplies(ctx.cfg.competition) &&
    isTournamentWindowOver(ctx.now?.getTime() ?? Date.now());
  if (over) printTournamentSignOff(ctx);
  else maybeStarNudge(ctx);
}

/**
 * Post-tournament sign-off for the interactive score commands — it both EXPLAINS
 * why they're now empty and says goodbye.
 *
 * Split by intent, so the CTA rule still holds:
 *  - the informational line is LOCALIZED and prints on any non-`--json` run
 *    (product state, not marketing — a piped run still deserves the explanation);
 *  - the ⭐ star block is a CTA, so it takes the standard gates (TTY, non-JSON,
 *    no CLAUDINHO_NO_STAR) exactly like `maybeStarNudge`.
 *
 * The hashtag stays EN as a fixed tag (same treatment as the share disclaimer),
 * and reuses `SHARE_HASHTAG` so there's one source for it. The statusline/hook
 * never call this — their sign-off is CTA-free by design.
 */
function printTournamentSignOff(ctx: Ctx): void {
  const { cfg, t } = ctx;
  if (cfg.json) return;
  const c = painterFor(cfg);
  out();
  out(`${t('signoff.complete')} ${SHARE_HASHTAG}`);
  if (!process.stdout.isTTY || process.env.CLAUDINHO_NO_STAR) return;
  out();
  out(c.dim(`⭐ ${t('signoff.star')}`));
  out(c.cyan(REPO_URL));
}

/**
 * Star CTA after a successful interactive init — the highest-intent moment.
 * Same gates as `maybeStarNudge` (AGENTS.md: CTAs never in `--json`, piped
 * output, or with CLAUDINHO_NO_STAR set); callers additionally gate on a
 * `written` result so "already configured" / errors don't get a victory lap.
 */
function printInitStarCta(cfg: CliConfig): void {
  if (cfg.json || !process.stdout.isTTY || process.env.CLAUDINHO_NO_STAR) return;
  const c = painterFor(cfg);
  out('');
  out(c.dim(`⭐ If this keeps you in the flow during the match, star the repo → ${REPO_URL}`));
}

export function cmdVibe(ctx: Ctx): void {
  const { cfg } = ctx;
  const pool = vibePool(localDate((ctx.now ?? new Date()).toISOString(), cfg.tz));
  const line = pool[Math.floor(Math.random() * pool.length)];
  let liveSeg: string | undefined;
  try {
    const state = readCurrentState(cfg.source, cfg.competition);
    liveSeg = vibeLiveSegment(
      // Sealed with the competition's written kind, like the statusline's.
      liveMatchesFromCache(state, (ctx.now ?? new Date()).getTime(), teamKind(cfg.competition)).items,
      // Name-or-code, matching the statusline/hook (offline lookup).
      resolveEnvTeam(process.env.CLAUDINHO_TEAM, cfg.competition),
    );
  } catch {
    // The easter egg stays harmless: any cache problem → plain vibe.
  }
  if (cfg.json) {
    emitJson({ vibe: line, tag: '#VibingLaVidaLoca', ...(liveSeg ? { live: liveSeg } : {}) });
    return;
  }
  const c = painterFor(cfg);
  out();
  out('  ⚽ ' + (liveSeg ? `${liveSeg} — ` : '') + c.bold(line ?? ''));
  out('  ' + c.cyan('#VibingLaVidaLoca'));
  out();
}
