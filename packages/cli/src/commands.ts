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
  modeLine,
  nextFixtureForPin,
  selectedCompetition,
  selectionExtras,
  selectionRefusal,
  selectionVerdict,
  capabilitiesOf,
  listCompetitions,
  SUPPORTED,
  type CompetitionSelection,
  type NextFixtureResult,
  type Pin,
  pinUnder,
  savedSlug,
  competitionLabel,
  type UserConfig,
  type UserConfigRead,
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
import { type CliConfig, edgeSelection, readSavedChoice } from './config';
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
import {
  type AmbientPick,
  FIRST_RUN_LINE,
  flagsEnabled,
  liveMatchesFromCache,
  pickAmbientMatch,
  renderPrompt,
} from './statusline';
import { renderHook } from './hook';
import { refreshWanted, runRefresh, spawnRefresh } from './refresh';
import {
  type CursorStatusLinePayload,
  readCursorPayload,
  renderPromptOutput,
} from './cursorPayload';
import { type InitResult, initCursorStatusline, initHook, initStatusline } from './install';
import { withPersistedBackoff } from './providerBackoff';
import { writeFileAtomic } from './paths';
import { rmSync } from 'node:fs';

/**
 * Command context. `adapter` is an optional injection seam: production leaves
 * it unset (commands build one from `cfg.source` and `cfg.competition`), tests
 * pass a fake so they never touch the network. An injected adapter must serve
 * the config's competition: the selection says what the answer is for and the
 * adapter reads it, so when the two disagree the command refuses before any
 * read (`adapterFor`), and the body and its label can never disagree.
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
function adapterFor(ctx: Ctx): ProviderAdapter {
  return adapterServing(ctx, ctx.cfg.competition);
}

/**
 * {@link adapterFor} for a stated competition: the selection's for every
 * competition-answering command; for `follow --team`, the competition being
 * followed (resolved exactly as the flag would be).
 */
function adapterServing({ cfg, adapter, now }: Ctx, competition: string): ProviderAdapter {
  // An injected adapter for another competition would answer one competition
  // under another's name: refused before it is wrapped or read.
  if (adapter && adapter.competition !== competition) {
    throw new InputError(
      `The injected adapter serves ${adapter.competition}; the command selected ${competition}.`,
    );
  }
  return withPersistedBackoff(adapter ?? makeAdapter(cfg.source, { competition }), cfg.source, now);
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

/**
 * The mode line: which competition the answer is for, and where that choice
 * came from when it was the flag or the environment (core `modeLine`). ONE
 * dimmed line on every competition-answering TEXT answer, right after its
 * header (first, where the answer has none). Never on `--json`, which carries
 * the `competition` key instead ({@link competitionKey}); never on `share`,
 * whose card names its competition in its title.
 */
function modeOut(cfg: CliConfig, c: Painter): void {
  out(c.dim(`  ${modeLine(cfg.selection, cfg.lang)}`));
}

/** The structured twin of the mode line: `--json`'s `competition` key (core `selectionExtras`). */
function competitionKey(cfg: CliConfig): ReturnType<typeof selectionExtras> {
  return selectionExtras(cfg.selection);
}

/** A command refused input; the caller should stop and exit non-zero. */
export class InputError extends Error {}

/**
 * Validate shared inputs before a command runs:
 *  - an explicit `--tz` that's invalid → warn to stderr (non-fatal; core falls
 *    back to the system zone anyway).
 *  - a refused competition (`--competition foo`) → throw InputError naming it
 *    and the aliases, before any request.
 *  - NO competition chosen (no flag, no environment, no saved choice) → throw
 *    InputError with the one sentence that says how to choose, before any
 *    request or cache read; on `--json` the valid object
 *    `{ competition: null, noCompetition: true }` goes to stdout first. A
 *    command that needs no competition (`team`) passes `{ competition: false }`.
 *  - an explicit date that isn't strict YYYY-MM-DD → throw InputError.
 */
function precheck(
  cfg: CliConfig,
  t: Translator,
  date?: string,
  { competition = true }: { competition?: boolean } = {},
): void {
  if (cfg.langRequestedUnsupported) {
    process.stderr.write(t('warn.lang', { lang: cfg.langRequestedUnsupported }) + '\n');
  }
  if (cfg.tz && !isValidTimeZone(cfg.tz)) {
    process.stderr.write(t('warn.tz', { tz: cfg.tz }) + '\n');
  }
  // A value that is neither an alias nor a slug (from `--competition` or
  // CLAUDINHO_COMPETITION) is refused with the aliases, before any request:
  // an unknown value is never a request. (What a valid one selects is said on
  // stdout, by the mode line; nothing is warned on stderr.) Nothing chosen is
  // the first run: the sentence says `claudinho follow`.
  const refusal = selectionRefusal(cfg.selection, cfg.lang);
  if (refusal !== undefined && (cfg.selection.kind !== 'none' || competition)) {
    // The structured twin of the sentence: what `--json` reads, through core.
    if (cfg.json && cfg.selection.kind === 'none') {
      emitJson({ ...selectionExtras(cfg.selection), ...verdictExtras(selectionVerdict(cfg.selection)) });
    }
    throw new InputError(refusal);
  }
  // An unknown --source/CLAUDINHO_SOURCE used to silently run ESPN — the flag
  // lied. Fail loud with the valid list (core makeAdapter also throws, as
  // defense in depth; this gives the localized, prefix-free message).
  if (!isKnownSource(cfg.source)) {
    throw new InputError(
      t('err.source', { source: cfg.source, sources: KNOWN_SOURCES.join(', ') }),
    );
  }
  if (date !== undefined && !isValidDate(date)) {
    throw new InputError(t('err.date', { date }));
  }
}

/**
 * What a team-taking command (`next`, `share next`, `markets next`) is about,
 * by ONE precedence: the argument, then `CLAUDINHO_TEAM` (an empty one is
 * absent), then the saved pin (`cfg.pin`: a pin belongs to its competition,
 * core `pinUnder`, so it is set whenever the selected competition is the
 * file's, whoever chose it, and never under another). A query is
 * resolved as it always was; the pin is a team already resolved when it was
 * saved, and is never resolved again. Nothing of the three: undefined (the
 * command's usage error).
 */
type TeamAsked = { readonly query: string; readonly from: 'argument' | 'env' } | { readonly pin: Pin };
function teamAsked(team: string | undefined, cfg: CliConfig): TeamAsked | undefined {
  if (team !== undefined) return { query: team, from: 'argument' };
  const env = teamEnvOf();
  // Set with nothing readable in it: it names no team, and says so (it is
  // still the override: never the pin).
  if (env.kind === 'refused') throw new InputError(ENV_TEAM_UNREADABLE);
  if (env.kind === 'set') return { query: env.query, from: 'env' };
  return cfg.pin ? { pin: cfg.pin } : undefined;
}

/**
 * `CLAUDINHO_TEAM` in one of three states, the ONE reading the team-taking
 * commands and `follow`'s report share: unset (or empty); set with a readable
 * label (bounded as a label, 40 columns); set with nothing readable (the
 * bounded label is empty: blanks, a tab, an invisible character, an emoji),
 * which the team-taking commands refuse.
 */
type TeamEnv =
  | { readonly kind: 'unset' }
  | { readonly kind: 'set'; readonly query: string; readonly label: string }
  | { readonly kind: 'refused'; readonly label: string };
function teamEnvOf(): TeamEnv {
  const raw = process.env.CLAUDINHO_TEAM;
  if (!raw) return { kind: 'unset' };
  const label = humanLabel(raw, 40);
  return label ? { kind: 'set', query: raw, label } : { kind: 'refused', label };
}

/** CLAUDINHO_TEAM set with nothing readable in it (English, like the usage sentences). */
const ENV_TEAM_UNREADABLE = "CLAUDINHO_TEAM names no team: pass one as the argument, or set CLAUDINHO_TEAM to a team's name or code.";

/**
 * A team-taking command's usage sentence, TRUE in each state it is said in:
 * a team pinned for ANOTHER competition is named as such (it is not "none
 * pinned": the pin belongs to its competition); otherwise the three ways to
 * give a team.
 */
function teamUsage(command: string, cfg: CliConfig): string {
  const file = cfg.userConfig?.read.kind === 'read' ? cfg.userConfig.read.config : undefined;
  const at = file?.team && !cfg.pin ? savedSlug(file.competition) : undefined;
  if (file?.team && at !== undefined) {
    return `Usage: claudinho ${command} <team> (the pinned team, ${file.team.name}, is ${competitionLabel(at)}'s, not this competition's)`;
  }
  return `Usage: claudinho ${command} <team> (or set CLAUDINHO_TEAM, or pin one: claudinho follow <alias> --team <name>)`;
}

/**
 * Resolve a team query (an argument or CLAUDINHO_TEAM, the same env the
 * statusline/hook honor, so "my team" is configured once) to a FIFA code.
 *
 * Accepts a nation NAME as well as a code — "mexico" / "DR Congo" / "Türkiye" all
 * resolve via {@link lookupTeam}, so `claudinho next mexico` just works. An exact
 * code resolves directly; an ambiguous name errors with the candidates rather than
 * guessing; a raw 3-letter code not in the bundled roster still passes through
 * uppercased (the escape hatch for CLAUDINHO_COMPETITION / other feeds).
 */
function resolveTeamArg(raw: string, usage: string, t: Translator, competition: string): string {
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
  if (matches.length > 1) throw new InputError(ambiguousTeams(t, raw, matches));
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  throw new InputError(t('team.none', { query: raw }));
}

/** "X is ambiguous. Did you mean: A (AAA), B (BBB)", localized via the keys cmdTeam renders. */
function ambiguousTeams(t: Translator, query: string, teams: ReadonlyArray<{ name: string; code: string }>): string {
  // team.ambiguous ends in ":".
  return `${t('team.ambiguous', { query })} ${teams.map((m) => `${m.name} (${m.code})`).join(', ')}`;
}

/**
 * The team a `next` is about. On the bundled competition, a nation resolved as
 * {@link resolveTeamArg} resolves it. Off it, the query AS TYPED, bounded like
 * a human label: core resolves a club against the competition's own roster
 * (by name or code, any case: `Arsenal`, `ars`, `O&M`), and answers with the
 * candidates when several match.
 */
function teamQuery(raw: string, usage: string, t: Translator, competition: string): string {
  if (bundleApplies(competition)) return resolveTeamArg(raw, usage, t, competition);
  const label = humanLabel(raw, 40);
  if (!label) throw new InputError(usage);
  return label;
}

/**
 * The next fixture `next` and `share next` answer with, for the team asked
 * ({@link teamAsked}), and the label the answer is said about: a query through
 * `getNextFixtureForTeam` (core resolves it), the saved pin through
 * `nextFixtureForPin` (by its id, or by code for the World Cup's nations; no
 * roster read). Live-resolved either way: the bundled knockout slots are
 * resultless placeholders, so a static lookup goes blind once a team's group
 * games pass; core overlays the live knockout window (off the bundled
 * competition it reads the schedule ahead).
 */
async function nextAsked(ctx: Ctx, team: string | undefined, usage: string): Promise<{ code: string; next: NextFixtureResult }> {
  const { cfg, t } = ctx;
  const asked = teamAsked(team, cfg);
  if (!asked) throw new InputError(usage);
  const now = ctx.now ?? new Date();
  if ('pin' in asked) {
    // The World Cup's nations are named by code; a club by its name.
    const code = bundleApplies(cfg.competition) ? asked.pin.code : asked.pin.name;
    return { code, next: await nextFixtureForPin(adapterFor(ctx), asked.pin, now) };
  }
  const code = teamQuery(asked.query, usage, t, cfg.competition);
  return { code, next: await getNextFixtureForTeam(adapterFor(ctx), code, now) };
}

/**
 * What `next` says when it has no fixture to show (and no candidates): a
 * verdict first; then the span a whole read searched, or "none read" for one
 * that was not whole; then an outage (never "this team has no upcoming
 * fixture", which reads as eliminated), else "no upcoming fixture". `follow
 * --team` refuses a team with the same sentence.
 */
function nextEmptySentence(next: NextFixtureResult, code: string, label: string, cfg: CliConfig, t: Translator): string {
  return (
    verdictNotice(next, cfg.lang) ??
    nextHorizonSentence(next, code, cfg.lang) ??
    nextNoneReadSentence(next, code, cfg.lang) ??
    (next.degraded ? t('live.degraded') : t('next.none', { team: label }))
  );
}

/**
 * Resolve CLAUDINHO_TEAM for the statusline, the hook and `vibe` to the CODE
 * their one pick prefers (`pickAmbientMatch`: the picked team's match first,
 * the others kept). Same offline lookup as the commands
 * (`CLAUDINHO_TEAM=mexico` picks Mexico, as `MEX` does); an unknown 3-letter
 * value still passes through uppercased (the CLAUDINHO_COMPETITION escape
 * hatch), and anything else yields no code: no preference (see
 * {@link ambientPick}). Pure and offline (bundled roster only), so it's safe
 * on the no-network hot path.
 */
function resolveEnvTeam(raw: string | undefined, competition: string): string | undefined {
  if (!raw) return undefined;
  // Off the bundle the World Cup roster is not this competition's: only a bare
  // code is honoured (`ala` picks ALA, never New Zealand's NZL).
  if (bundleApplies(competition)) {
    const { team } = lookupTeam(raw);
    if (team) return team.code;
  }
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : undefined;
}

/**
 * Whose match the ambient surfaces (the statusline, the hook, `vibe`) prefer,
 * decided at the edge, offline. Three states of `CLAUDINHO_TEAM`:
 *   - absent (unset or empty): the saved pin (`cfg.pin`, only on the saved
 *     competition), or no preference;
 *   - present and readable (a code, through {@link resolveEnvTeam}): that code;
 *   - present and unreadable here (a name off the bundle, which the hot path
 *     cannot resolve without a roster): NO preference, never the pin. The
 *     environment is the override; a value it states is not replaced by the
 *     saved team because this surface cannot read it.
 */
function ambientPick(cfg: CliConfig): AmbientPick {
  const raw = process.env.CLAUDINHO_TEAM;
  if (raw) {
    const code = resolveEnvTeam(raw, cfg.competition);
    return code ? { code } : undefined;
  }
  return cfg.pin ? { team: cfg.pin } : undefined;
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
      ...competitionKey(cfg),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  // "Today's matches" only when no explicit date was given; otherwise "Matches".
  const title = date === undefined ? t('today.title') : t('today.on');
  out();
  out(header(`${title} · ${targetDate}`, c));
  modeOut(cfg, c);
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
    emitJson({ degraded, source: source ?? null, matches, ...verdictExtras(live), ...competitionKey(cfg) });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  out();
  out(header(t('live.title'), c));
  modeOut(cfg, c);
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

/** `claudinho next [team]` (team defaults to CLAUDINHO_TEAM, then the saved pin) */
export async function cmdNext(team: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  // Live-resolved: the bundled knockout slots are resultless placeholders, so a
  // static lookup goes blind once a team's group games pass — overlay the live
  // knockout window so a confirmed R32+ tie (e.g. MEX vs ECU) surfaces here too.
  // Off the bundled competition core resolves the club and reads the schedule
  // ahead (yesterday to 14 days ahead); a saved pin is not resolved again.
  const { code, next } = await nextAsked(ctx, team, teamUsage('next', cfg));
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
      ...competitionKey(cfg),
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
    // No header on an empty answer: the mode line comes first.
    modeOut(cfg, c);
    for (const q of qualifiers) out(c.dim('  ' + q));
    const notice = verdictNotice(next, cfg.lang);
    if (notice === undefined && next.candidates && next.candidates.length > 0) {
      // Two or more teams match: name them, pick none.
      out(c.dim(`  ${ambiguousTeams(t, code, next.candidates)}`));
    } else {
      // Fail-closed honesty: a feed outage must read as "couldn't reach the
      // provider", never as "this team has no upcoming fixture" (= eliminated).
      // A whole read with nothing for the club says the span it searched; one
      // that was not whole says none was READ.
      out(c.dim(`  ${nextEmptySentence(next, code, label, cfg, t)}`));
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
  modeOut(cfg, c);
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

/**
 * `claudinho team <name|code>` — resolve a nation name/code to its FIFA code
 * (offline). It reads the World Cup's roster whatever the selection, so it is
 * not a competition-answering command: no mode line, no `competition` key.
 * Under an EXPLICIT selection of another competition (the flag or the
 * environment) it is refused, saying where a team's name goes (`next`, `share
 * next`) and how to reach the roster (`--competition world-cup`); a saved
 * choice, nothing chosen, and an explicit World Cup answer, the roster named.
 */
export function cmdTeam(query: string | undefined, ctx: Ctx): void {
  const { cfg, t } = ctx;
  // Needs no competition chosen: it reads the World Cup's roster.
  precheck(cfg, t, undefined, { competition: false });
  const selection = cfg.selection;
  if (
    selection.kind === 'selected' &&
    (selection.chosenBy === 'flag' || selection.chosenBy === 'env') &&
    !bundleApplies(selection.slug)
  ) {
    throw new InputError(t('team.worldCupOnly'));
  }
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
  // Which roster answered: the World Cup's, whatever competition is selected
  // (core's sentence, the one MCP `get_team` prints too).
  out(c.dim(`  ${i18n(cfg.lang, 'team.roster')}`));
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
      ...competitionKey(cfg),
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  if (tables.length === 0) {
    out();
    modeOut(cfg, c);
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
  // One line for the answer, before the tables (each has its own title).
  out();
  modeOut(cfg, c);
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
      emitJson({ degraded, standingsDegraded, source: null, view, ...verdictExtras(bracket), ...competitionKey(cfg) });
      return;
    }
    const c = painterFor(cfg);
    out();
    modeOut(cfg, c);
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
      ...competitionKey(cfg),
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
  modeOut(cfg, c);
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
  { cfg, now }: Ctx,
  io: { cursor?: CursorStatusLinePayload } = {},
): void {
  try {
    // The binary pre-drains stdin with a BOUNDED wait and passes the payload in
    // (see index.ts / readCursorPayloadBounded — a writerless open pipe must not
    // hang the statusline; PR #77's 62-min Windows CI hang was this). The sync
    // fallback remains for direct in-process callers (tests mock it).
    const payload = 'cursor' in io ? io.cursor : readCursorPayload();
    // Nothing chosen (the first run): the one command that chooses, instead
    // of a score; no cache read, no refresher, never an error.
    if (cfg.selection.kind === 'none') {
      out(renderPromptOutput(FIRST_RUN_LINE, payload));
      return;
    }
    // A selection that is no competition (an unknown CLAUDINHO_COMPETITION) is
    // contained here: the empty line, no cache read, no refresher, never an
    // error (the statusline must always succeed). (`follow` would not help:
    // the environment wins over a saved choice.)
    if (cfg.selection.kind !== 'selected') {
      out(renderPromptOutput('⚽ —', payload));
      return;
    }
    const compact = !['0', 'false', 'no'].includes(
      (process.env.CLAUDINHO_COMPACT ?? '').toLowerCase(),
    );
    const maxRaw = Number.parseInt(process.env.CLAUDINHO_MAX ?? '', 10);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;
    // Only trust a snapshot fetched for this invocation's source + competition.
    const state = readCurrentState(cfg.source, cfg.competition);
    const scoreLine = renderPrompt(state, {
      // CLAUDINHO_TEAM by code (offline lookup — hot-path safe), else the saved pin.
      pick: ambientPick(cfg),
      compact,
      max,
      flags: flagsEnabled(),
      // The bundled schedule describes the bundled competition only — see the
      // sign-off gate in renderPrompt.
      defaultCompetition: bundleApplies(cfg.competition),
      // The competition's written kind: a nation's flag is generated, a club has none.
      teamKind: teamKind(cfg.competition),
      // The command's clock (a test's; the system's in production).
      now,
    });
    out(renderPromptOutput(scoreLine, payload));
    // Spawn a background refresh for live scores OR stale knockout fixtures (the
    // latter keeps the next-match countdown live outside live windows). Pass the
    // already-read state so the checks add no extra cache read. The no-cache
    // branch is lock-deduped like the others: N concurrent statusline ticks on a
    // fresh install must fork one refresher, not N (and the refresher always
    // writes a snapshot, so this branch fires once, never per-tick forever).
    if (refreshWanted(now?.getTime() ?? Date.now(), state, cfg.competition, cfg.source)) {
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
export function cmdHook({ cfg, now }: Ctx): void {
  try {
    // A selection that is no competition, or nothing chosen: nothing (zero
    // tokens), no cache read, no refresher; never an error that could block
    // the prompt.
    if (cfg.selection.kind !== 'selected') return;
    // Only trust a snapshot fetched for this invocation's source + competition.
    const state = readCurrentState(cfg.source, cfg.competition);
    const ctx = renderHook(state, {
      // CLAUDINHO_TEAM by code (offline lookup — hot-path safe), else the saved pin.
      pick: ambientPick(cfg),
      flags: flagsEnabled(),
      // The bundled roster names World Cup nations only; on another competition
      // a club sharing a nation's code must not be renamed to that nation.
      defaultCompetition: bundleApplies(cfg.competition),
      // The competition's written kind: a nation's flag is generated, a club has none.
      teamKind: teamKind(cfg.competition),
      // The command's clock (a test's; the system's in production).
      now,
    });
    if (ctx) out(ctx);
    // Warm the same cache the statusline reads, for parity (the hook itself shows
    // only live scores). Spawn for live OR stale knockout fixtures; the no-cache
    // branch is lock-deduped (see cmdPrompt).
    if (refreshWanted(now?.getTime() ?? Date.now(), state, cfg.competition, cfg.source)) {
      spawnRefresh(cfg.source, cfg.competition);
    }
  } catch {
    // Never block the prompt — emit nothing on any error.
  }
}

/** `claudinho _refresh` — internal cold-path cache refresher. */
export async function cmdRefresh({ cfg }: Ctx): Promise<void> {
  // Spawned with the slug its parent resolved; a selection that is no
  // competition refreshes nothing.
  if (cfg.selection.kind !== 'selected') return;
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
 * After an install with NO competition chosen: one line saying the statusline
 * reads `claudinho follow` until one is, and how to choose (the first run's
 * one sentence, core's).
 */
function printInitChoose(cfg: CliConfig): void {
  if (cfg.selection.kind !== 'none') return;
  out('');
  out(selectionRefusal(cfg.selection, cfg.lang) ?? '');
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
  printInitChoose(cfg);
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
  printInitChoose(cfg);
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
      ...competitionKey(cfg),
    });
    return;
  }

  const c = painterFor(cfg);
  // What qualifies the answer (a read that was not whole) is said before it.
  const qualifiers = verdictQualifiers(found, cfg.lang);
  out();
  if (!match) {
    // No header on an empty answer: the mode line comes first.
    modeOut(cfg, c);
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
  modeOut(cfg, c);
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
    const usage = teamUsage('markets next', cfg);
    const asked = teamAsked(team, cfg);
    if (!asked) throw new InputError(usage);
    // A saved pin is a team already resolved: its code is what a market read
    // selects by (the World Cup's nations, the sidecar's one competition);
    // off the World Cup the sidecar answers "not available" for it, as for any.
    const code = 'pin' in asked ? asked.pin.code : resolveTeamArg(asked.query, usage, t, cfg.competition);
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
        ...competitionKey(cfg),
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    // No header before the answer's own: the mode line comes first.
    if (!fixture) modeOut(cfg, c);
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
      modeOut(cfg, c);
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
          ...competitionKey(cfg),
        });
        return;
      }
      const c = painterFor(cfg);
      out();
      modeOut(cfg, c);
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
        ...competitionKey(cfg),
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    // No header before the answer's own: the mode line comes first.
    if (!match) modeOut(cfg, c);
    // The fixture read was not whole: said before the answer (as `match` says
    // it), apart from the market's own completeness.
    for (const q of verdictQualifiers(found, cfg.lang)) out(c.dim('  ' + q));
    if (!match) {
      out(c.dim('  ' + (verdictNotice(found, cfg.lang) ?? t('match.none', { id: target }))));
    } else {
      out(header(marketHeaderLine(match, cfg), c));
      modeOut(cfg, c);
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
      ...competitionKey(cfg),
    });
    return;
  }

  const c = painterFor(cfg);
  out();
  out(header(`Market signals · ${date}`, c));
  modeOut(cfg, c);
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
      ...competitionKey(ctx.cfg),
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
      ...competitionKey(ctx.cfg),
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
      ...competitionKey(ctx.cfg),
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

  // The competition goes on the card: its title names it and its run cue
  // selects it (`--competition <alias>`), whatever the recipient follows. No
  // mode line: the card is the artifact, printed and copied as it is.
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
    // Live-resolved (see cmdNext): overlay the knockout window so a confirmed
    // R32+ tie pastes here too, not just group games. A saved pin is not
    // resolved again.
    const { code, next } = await nextAsked(ctx, team, teamUsage('share next', cfg));
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
 * by their codes: "ARS 2–1 CHE 50'"). The picked team's match first (the
 * ambient surfaces' one rule, `pickAmbientMatch`: CLAUDINHO_TEAM by code, else
 * the saved pin), else the first live match; undefined when nothing is live.
 * Pure — exported for tests.
 */
export function vibeLiveSegment(live: readonly Match[], picked?: AmbientPick): string | undefined {
  const pick = pickAmbientMatch(live, picked)[0];
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

/* ──────────────────────────── follow ──────────────────────────── */

/** No saved choice, as the edge would read one that is not there: for resolving a value as the flag would. */
const NO_SAVED: UserConfigRead = { kind: 'none', reason: 'absent' };

/** The CLI catalog's sentence for why there is no saved choice. */
const NO_SAVED_REASON: Readonly<Record<Extract<UserConfigRead, { kind: 'none' }>['reason'], string>> = {
  absent: 'follow.reason.absent',
  symlink: 'follow.reason.symlink',
  unreadable: 'follow.reason.unreadable',
  malformed: 'follow.reason.malformed',
  version: 'follow.reason.version',
  competition: 'follow.reason.competition',
};

/** A pinned team as a person reads it. */
function pinLabel(pin: Pin): string {
  return `${pin.name} (${pin.code})`;
}

/**
 * The selection a saved value makes: the value resolved exactly as the flag
 * would, described as saved. Never asked with an empty value (`follow ""` is
 * refused before: an absent flag would let the environment decide).
 */
function savedSelection(value: string): CompetitionSelection {
  const asFlag = edgeSelection({ competition: value }, NO_SAVED);
  return asFlag.kind === 'selected' ? selectedCompetition(asFlag.slug, 'saved') : asFlag;
}

/**
 * The team `follow <competition> --team <query>` pins, resolved EXACTLY as
 * `next <query>` resolves it, so `follow` never pins what `next` would refuse:
 * on the bundled competition the nations' roster, offline (`{ code, name }`:
 * the bundle's nations carry no id; a name the roster does not resolve is
 * refused, an unknown 3-letter code included: a pin is a team); off it
 * `next`'s own reads (discovery, then the roster where a table is asked for,
 * then `resolveClub` over both), and the pin is the club it resolved
 * (`{ id, code, name }`). Ambiguous: the candidates, refused. Anything else
 * (unknown, an unread roster, an outage, between editions): the sentence
 * `next` would print, refused. A refusal writes nothing.
 */
async function pinFor(ctx: Ctx, competition: string, query: string): Promise<Pin> {
  const { cfg, t } = ctx;
  const label = humanLabel(query, 40);
  if (!label) throw new InputError(t('follow.usage'));
  if (bundleApplies(competition)) {
    const { team, matches } = lookupTeam(query);
    if (team) return { code: team.code, name: team.name };
    if (matches.length > 1) throw new InputError(ambiguousTeams(t, query, matches));
    throw new InputError(t('team.none', { query: label }));
  }
  if (!isKnownSource(cfg.source)) {
    throw new InputError(t('err.source', { source: cfg.source, sources: KNOWN_SOURCES.join(', ') }));
  }
  const next = await getNextFixtureForTeam(adapterServing(ctx, competition), label, ctx.now ?? new Date());
  if (next.team) {
    const { id, code, name } = next.team;
    return id !== undefined ? { id, code, name } : { code, name };
  }
  if (next.candidates && next.candidates.length > 0) throw new InputError(ambiguousTeams(t, label, next.candidates));
  throw new InputError(nextEmptySentence(next, label, next.query ?? label, cfg, t));
}

/**
 * `claudinho follow [competition] [--team <query>] [--list]`, `follow off` —
 * the one writer of the user's config file (`{ version: 1, competition,
 * team? }`), which every surface reads as the saved choice (after the flag and
 * the environment). Needs no competition chosen, and works under any ambient
 * value.
 *   follow <alias|slug> [--team <q>]  resolve the competition as the flag does
 *                                     (refused with the aliases; a raw slug saved
 *                                     as given, said to be experimental), the
 *                                     team as `next` does; write the file
 *                                     atomically, 0600 enforced; print the choice
 *                                     as the mode line shows it, and the path. A
 *                                     competition saved without `--team` saves no
 *                                     pin (a club's id is the same in every
 *                                     competition: a pin never carries over).
 *   follow --team <q>                 pin a team in the competition already saved.
 *   follow                            the current choice and its source, or why
 *                                     there is none; the path.
 *   follow --list                     the supported competitions, the current one
 *                                     marked.
 *   follow off                        remove the file (no error when there is none).
 * A refusal (a competition, a team) writes nothing: the previous file stays.
 */
export async function cmdFollow(
  target: string | undefined,
  opts: { team?: string; list?: boolean },
  ctx: Ctx,
): Promise<void> {
  const { cfg, t } = ctx;
  // An argument that does not belong is refused, nothing written: `--list`
  // with anything else, `off` with a team, and an empty competition (an
  // absent value would let the environment's competition be saved).
  if (opts.list && (target !== undefined || opts.team !== undefined)) throw new InputError(t('follow.usage'));
  if (target === 'off' && opts.team !== undefined) throw new InputError(t('follow.usage'));
  if (target === '') throw new InputError(t('follow.usage'));
  const saved = cfg.userConfig ?? readSavedChoice();
  if (opts.list) return followList(ctx, saved.path);
  if (target === 'off') return followOff(ctx, saved);
  if (target === undefined && opts.team === undefined) {
    followReport(ctx, 'show', {
      effect: cfg.selection,
      saved: saved.read.kind === 'read' ? saved.read.config : null,
      ...(saved.read.kind === 'none' ? { reason: saved.read.reason } : {}),
      path: saved.path,
    });
    return;
  }
  // With `--team` alone, the competition already saved.
  const value = target ?? (saved.read.kind === 'read' ? saved.read.config.competition : undefined);
  if (value === undefined) throw new InputError(t('follow.teamUsage'));
  const choice = savedSelection(value);
  if (choice.kind !== 'selected') throw new InputError(selectionRefusal(choice, cfg.lang) ?? t('follow.usage'));
  const pin = opts.team !== undefined ? await pinFor(ctx, choice.slug, opts.team) : undefined;
  const file: UserConfig = pin ? { version: 1, competition: choice.slug, team: pin } : { version: 1, competition: choice.slug };
  // Written whole or not at all, never through a link, readable by its owner
  // alone (0600 on every write, an existing file's wider mode not kept).
  writeFileAtomic(saved.path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, enforceMode: true, followSymlinks: false });
  // What the NEXT command follows: the environment while it is set, else the file just written.
  followReport(ctx, 'write', { effect: nextSelection({ kind: 'read', config: file }), saved: file, path: saved.path });
}

/**
 * What the NEXT command follows after `follow` changed the file: the
 * environment while it is set (or its refusal), else what the file now says
 * (`read`: the choice written, or nothing after `off`). Never this command's
 * `--competition`: a flag decides the command it is given to, and no other.
 * The edge's own resolution, asked with no flag.
 */
function nextSelection(read: UserConfigRead): CompetitionSelection {
  return edgeSelection({}, read);
}

/** What `follow` reports, in every form (alone, after a write, after `off`). */
interface FollowFacts {
  /**
   * The competition reported: `follow` alone, this command's selection (its
   * `--competition` included: the question asked); after a write or `off`,
   * what the NEXT command follows (`nextSelection`).
   */
  readonly effect: CompetitionSelection;
  /** The file as read (after a write: as written; after `off`: none). */
  readonly saved: UserConfig | null;
  /** Why there is no saved choice, when there is none. */
  readonly reason?: Extract<UserConfigRead, { kind: 'none' }>['reason'];
  readonly path: string;
  /** After `off`: whether there was a file to remove. */
  readonly removed?: boolean;
}

/**
 * The ONE list of what `follow` says, printed as lines or as `--json` keys,
 * in the same order:
 *   - the competition reported (`competition`, through `selectionExtras`):
 *     `follow` alone, this command's selection; after a write or `off`, what
 *     the NEXT command follows. Null, with `noCompetition`, when nothing is
 *     chosen; null, with `refused`, when the value deciding it is refused;
 *   - its source when it is not the saved choice (`override`: `flag` or
 *     `env`, that meaning in every form: after a write under a flag alone it
 *     is absent, since the next command follows the saved choice);
 *   - the sources this command RAN under (`sources: { flag?, env?, team? }`:
 *     the flag's and the environment's resolved slugs, and `CLAUDINHO_TEAM`
 *     with a readable label, bounded as a label), whatever is reported: the
 *     flag decides this command alone, the environment outlives it; absent
 *     when none;
 *   - the values refused (`refused: { flag?, env?, team? }`, which mirrors
 *     `sources`: each the value as given, bounded as a label, under its
 *     source's name; each of the flag, the environment and the team sits in
 *     at most one of `sources` and `refused`). A refused competition is said
 *     in the text by its refusal's sentence: as the headline when it decides
 *     what is reported, else on its own line after it, the flag's before the
 *     environment's (a refused flag on a write: the write done, the saved
 *     choice what the next command follows unless the environment is refused
 *     too). `CLAUDINHO_TEAM` set with nothing readable is `team: ''` (its
 *     bounded label is empty: presence is the signal), which the
 *     team-taking commands refuse, said by its own sentence;
 *   - the pinned team (`saved.team`) WITH the saved choice it belongs to: right
 *     after the competition reported when the pin is the team in effect (the
 *     competition is the file's and no `CLAUDINHO_TEAM` overrides it), else
 *     as the saved team (after the saved choice's line when there is one),
 *     never as if in effect: under another competition, or under
 *     `CLAUDINHO_TEAM`, whose sentence then says so;
 *   - the saved choice (`saved`), its line when another competition (or a
 *     refused value) is reported;
 *   - the sentence TRUE of the next command (`overrideSentence`: a flag that
 *     ran, or was refused, decides this command alone; the environment, when
 *     set, decides the next one before the saved choice; with no believed
 *     saved choice, none is named), then the team override's, by
 *     `CLAUDINHO_TEAM`'s three states: unset (or empty), nothing (the pin, if
 *     it applies, is the `Team:` line); set and readable (in `sources.team`),
 *     the team-taking commands take it as their team (`teamEnv`), or, when
 *     the file holds a pin, it wins over the saved team (`teamEnvWins`, never
 *     without a pin); set with nothing readable (in `refused.team`), the
 *     team-taking commands refuse it, a pin or not (`teamEnvRefused`). The
 *     team-taking commands are `next`, `share next` and `markets next`; the
 *     others read no team. Under either set state the
 *     pin is the saved team, never the team in effect;
 *   - why there is no saved choice (`reason`);
 *   - the path, said as what was done with it (`path`, and `removed` after `off`).
 */
function followReport(ctx: Ctx, mode: 'show' | 'write' | 'off', facts: FollowFacts): void {
  const { cfg, t } = ctx;
  const { effect, saved, reason, path } = facts;
  // The sources this command ran under: its `--competition` (resolved or
  // refused), and the environment, which outlives it, in one of three states:
  // unset, set (resolved) or refused.
  const flag = cfg.selection.kind === 'selected' && cfg.selection.chosenBy === 'flag' ? cfg.selection : undefined;
  const flagRefused = cfg.selection.kind === 'refused' && cfg.selection.chosenBy === 'flag' ? cfg.selection : undefined;
  const env = edgeSelection({}, NO_SAVED);
  const envRefused = env.kind === 'refused' ? env : undefined;
  const envState = env.kind === 'selected' ? 'set' : envRefused ? 'refused' : 'none';
  // CLAUDINHO_TEAM in its three states (an empty one is unset): the team
  // override, which a saved pin never replaces, readable or not.
  const teamEnv = teamEnvOf();
  const sources = {
    ...(flag ? { flag: flag.slug } : {}),
    ...(env.kind === 'selected' ? { env: env.slug } : {}),
    ...(teamEnv.kind === 'set' ? { team: teamEnv.label } : {}),
  };
  // The reported competition's source, when it is not the saved choice.
  const override = effect.kind === 'selected' && (effect.chosenBy === 'flag' || effect.chosenBy === 'env') ? effect.chosenBy : undefined;
  // The refused values, under their sources' names (each as given, bounded).
  const refused = {
    ...(flagRefused ? { flag: humanLabel(flagRefused.value, 40) } : {}),
    ...(envRefused ? { env: humanLabel(envRefused.value, 40) } : {}),
    ...(teamEnv.kind === 'refused' ? { team: teamEnv.label } : {}),
  };
  if (cfg.json) {
    emitJson({
      competition: selectionExtras(effect).competition ?? null,
      ...verdictExtras(selectionVerdict(effect)),
      ...(override ? { override } : {}),
      ...(Object.keys(sources).length > 0 ? { sources } : {}),
      ...(Object.keys(refused).length > 0 ? { refused } : {}),
      saved,
      ...(reason ? { reason } : {}),
      path,
      ...(facts.removed !== undefined ? { removed: facts.removed } : {}),
    });
    return;
  }
  const c = painterFor(cfg);
  // Whether the pin is the team in effect: the competition reported is the
  // file's, and no CLAUDINHO_TEAM overrides it.
  const pinned =
    teamEnv.kind === 'unset' && saved?.team !== undefined && pinUnder(effect.kind === 'selected' ? effect.slug : undefined, saved) !== undefined;
  out();
  if (effect.kind === 'selected') out(`  ${t('follow.following', { competition: modeLine(effect, cfg.lang) })}`);
  else out(`  ${selectionRefusal(effect, cfg.lang)}`);
  // Each refusal that is not the headline, on its own line: this command's
  // flag (on a write, `off`), then the environment's (under a flag that ran,
  // or a refused one, or a write the environment's refusal does not decide).
  if (flagRefused && effect !== flagRefused) out(c.dim(`  ${selectionRefusal(flagRefused, cfg.lang)}`));
  if (envRefused && !(effect.kind === 'refused' && effect.chosenBy === 'env')) out(c.dim(`  ${selectionRefusal(envRefused, cfg.lang)}`));
  if (saved?.team && pinned) out(`  ${t('follow.team', { team: pinLabel(saved.team) })}`);
  // The saved choice, when something else is reported (an override, or a refused value).
  if (saved && !(effect.kind === 'selected' && effect.chosenBy === 'saved')) {
    const kept = savedSelection(saved.competition);
    // Its line when it is another competition than the one reported.
    if (kept.kind === 'selected' && !(effect.kind === 'selected' && effect.slug === kept.slug)) {
      out(c.dim(`  ${t('follow.saved', { competition: modeLine(kept, cfg.lang) })}`));
    }
  }
  // The saved team, when it is not the team in effect.
  if (saved?.team && !pinned) out(c.dim(`  ${t('follow.savedTeam', { team: pinLabel(saved.team) })}`));
  // The sentence true of the next command, from the flag, the environment and
  // whether the file holds a believed choice.
  const sentence = overrideSentence(flag ? 'ran' : flagRefused ? 'refused' : undefined, envState, saved !== null);
  if (sentence) out(c.dim(`  ${t(sentence)}`));
  // The team override's, in its three states: unset, nothing; set and
  // readable, the team-taking commands' team (over the saved team when the
  // file holds a pin); set with nothing readable, refused by the team-taking
  // commands, a pin or not.
  if (teamEnv.kind === 'refused') out(c.dim(`  ${t('follow.teamEnvRefused')}`));
  else if (teamEnv.kind === 'set') out(c.dim(`  ${t(saved?.team ? 'follow.teamEnvWins' : 'follow.teamEnv')}`));
  if (reason && mode === 'show') out(c.dim(`  ${t(NO_SAVED_REASON[reason])}`));
  if (mode === 'write') out(c.dim(`  ${t('follow.path', { path })}`));
  else if (mode === 'off') out(`  ${t(facts.removed ? 'follow.removed' : 'follow.nothingToRemove', { path })}`);
  else out(c.dim(`  ${t('follow.file', { path })}`));
  out();
}

/**
 * The sentence the overrides at work are said with, true of the NEXT command,
 * one per cell of the flag (ran, refused, absent) by the environment (unset,
 * set, refused) by the file (a believed saved choice, or none: no file, a
 * link, an unreadable or malformed one, after `off`). With a file:
 *   - flag ran, environment unset: `flagWins` (it decides this command; the
 *     saved choice the next one);
 *   - flag ran, environment set: `flagEnvWins` (without it the environment
 *     decides, then the saved choice);
 *   - flag ran, environment refused: `flagEnvRefused` (without it the
 *     environment is refused, and nothing is followed while it is set);
 *   - flag refused, environment unset: `flagRefused` (this command only;
 *     without it the saved choice decides);
 *   - flag refused, environment set: `flagRefusedEnv` (without it the
 *     environment decides, then the saved choice);
 *   - flag refused, environment refused: `flagRefusedEnvRefused` (without it
 *     the environment is refused too);
 *   - no flag, environment unset: none;
 *   - no flag, environment set: `envWins` (it wins over the saved choice
 *     while set);
 *   - no flag, environment refused: `envRefused` (nothing is followed while
 *     it is set; its refusal is the headline).
 * With none, no sentence names a saved choice:
 *   - flag ran, environment unset: `flagNone` (without it nothing is chosen);
 *   - flag ran, environment set: `flagEnv` (without it the environment
 *     decides);
 *   - flag ran, environment refused: `flagEnvRefused`, as with a file;
 *   - flag refused, environment unset: `flagRefusedNone` (without it nothing
 *     is chosen);
 *   - flag refused, environment set: `flagRefusedEnvOnly` (without it the
 *     environment decides);
 *   - flag refused, environment refused: `flagRefusedEnvRefused`, as with a
 *     file;
 *   - no flag, environment unset: none (the reason line says why);
 *   - no flag, environment set: `envDecides` (the next command follows it
 *     while it is set);
 *   - no flag, environment refused: `envRefused`, as with a file.
 */
function overrideSentence(flag: 'ran' | 'refused' | undefined, env: 'none' | 'set' | 'refused', file: boolean): string | undefined {
  if (flag === 'ran') {
    if (env === 'refused') return 'follow.flagEnvRefused';
    if (env === 'set') return file ? 'follow.flagEnvWins' : 'follow.flagEnv';
    return file ? 'follow.flagWins' : 'follow.flagNone';
  }
  if (flag === 'refused') {
    if (env === 'refused') return 'follow.flagRefusedEnvRefused';
    if (env === 'set') return file ? 'follow.flagRefusedEnv' : 'follow.flagRefusedEnvOnly';
    return file ? 'follow.flagRefused' : 'follow.flagRefusedNone';
  }
  if (env === 'refused') return 'follow.envRefused';
  if (env === 'set') return file ? 'follow.envWins' : 'follow.envDecides';
  return undefined;
}

/** `follow off`: the file removed (a link removed, never its target); nothing there is no error. */
function followOff(ctx: Ctx, saved: { path: string; read: UserConfigRead }): void {
  const { t } = ctx;
  const there = !(saved.read.kind === 'none' && saved.read.reason === 'absent');
  try {
    rmSync(saved.path, { force: true });
  } catch {
    throw new InputError(t('follow.cannotRemove', { path: saved.path }));
  }
  // What the next command follows now: the environment, if it is set; else nothing.
  followReport(ctx, 'off', {
    effect: nextSelection(NO_SAVED),
    saved: null,
    reason: 'absent',
    path: saved.path,
    removed: there,
  });
}

/**
 * `follow --list`: the supported competitions as `list_competitions` lists
 * them (core `listCompetitions`), one row each (alias · name · nations or
 * clubs · what it offers), the current one marked `›`.
 */
function followList(ctx: Ctx, path: string): void {
  const { cfg, t } = ctx;
  const current = cfg.selection.kind === 'selected' ? cfg.selection.slug : undefined;
  const listed = listCompetitions(SUPPORTED, selectionExtras(cfg.selection).competition ?? null);
  if (cfg.json) {
    emitJson({ ...listed, path });
    return;
  }
  const c = painterFor(cfg);
  const width = Math.max(...listed.competitions.map((e) => e.alias.length));
  out();
  out(c.dim(`  ${t('follow.list.title')}`));
  for (const e of listed.competitions) {
    const caps = capabilitiesOf(e.slug);
    const named = (want: string) =>
      (['scores', 'next', 'standings', 'bracket', 'markets'] as const).filter((k) => caps[k] === want);
    const parts = [named('offered').join(', ')];
    const notYet = named('not-offered-yet');
    const na = named('not-applicable');
    if (notYet.length) parts.push(t('follow.list.notYet', { list: notYet.join(', ') }));
    if (na.length) parts.push(t('follow.list.na', { list: na.join(', ') }));
    const mark = e.slug === current ? '›' : ' ';
    const teams = t(e.teams === 'nation' ? 'follow.list.nations' : 'follow.list.clubs');
    out(`  ${mark} ${e.alias.padEnd(width)} · ${e.name} · ${teams} · ${c.dim(parts.join('; '))}`);
  }
  out();
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
 * Gated on the BUNDLED competition: the bundled schedule describes the World
 * Cup, so with another competition selected its "windows elapsed"
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
    // A selection that is no competition: the line with no live segment, no cache read.
    if (cfg.selection.kind !== 'selected') throw new Error('no competition');
    const state = readCurrentState(cfg.source, cfg.competition);
    liveSeg = vibeLiveSegment(
      // Sealed with the competition's written kind, like the statusline's.
      liveMatchesFromCache(state, (ctx.now ?? new Date()).getTime(), teamKind(cfg.competition)).items,
      // The statusline's and the hook's pick (offline).
      ambientPick(cfg),
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
