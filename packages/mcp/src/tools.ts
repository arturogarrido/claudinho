/**
 * Pure tool handlers — the business logic behind each MCP tool, decoupled from
 * the SDK so they can be unit-tested directly. Each returns a `{ text, data }`
 * pair: `text` is the human/LLM-readable summary, `data` is the structured
 * payload embedded as JSON for agents that want to parse it.
 */
import { homedir } from 'node:os';
import {
  asFlavorLevel,
  fixturesByDate,
  formatDate,
  formatShareSnippet,
  formatShareTable,
  formatShareBracket,
  formatBracketList,
  bracketShareCard,
  dateNoneRead,
  dateShareCard,
  dateUnreached,
  dayAttribution,
  liveNoneRead,
  liveShareCard,
  marketsNoneRead,
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
  servedExtras,
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
  listCompetitions,
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
  modeLine,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  resolveCompetition,
  type SelectedCompetition,
  selectionExtras,
  selectionRefusal,
  selectionVerdict,
  configPath,
  nextFixtureForPin,
  type Pin,
  pinUnder,
  readUserConfig,
  savedSlug,
  competitionLabel,
  SUPPORTED,
  humanLabel,
  resolveMarketSource,
  resolveTz,
  t,
  type ShareSnippetOptions,
  type Stage,
  statesPartial,
  teamKind,
  type VerdictSource,
  withFlag,
} from '@claudinho/core';
import {
  boundedRecords,
  capSignals,
  DISCLAIMER,
  headingLine,
  listTruncation,
  type FmtOpts,
  matchLine,
  matchRows,
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
   *
   * Since the cut takes the end of the body first, the rule for every text a
   * cut can reach (a tool's, and a share card's): each sentence that QUALIFIES
   * the body is printed BEFORE it, and nothing follows the body but this
   * footer. First the verdict's qualifiers, then the sentence counting the
   * shown rows a read did not serve, then the rest (a degraded line, a market
   * notice, a list's truncation, a roster note, a bracket's note) in the order
   * they used to follow the body (`qualified`; the standings text and the share
   * formatters keep the same order themselves). A table's own partial line is
   * printed before that table.
   *
   * What a cut keeps of it is {@link cutFooter} when the result names one. The
   * rule, for a DATE's list (`get_today`, the date card) on a read that was not
   * whole: the cut keeps the disclaimer and DROPS the attribution line, because
   * the rows it drops may be every row the provider served (the attribution
   * was decided over the whole bounded list, not over what survives the cut).
   * A whole read keeps the whole footer, and so does a LIVE list: every row it
   * shows was served, so its line is true after any cut, and a provider is
   * attributed where it served. The structured `source` names the provider
   * either way.
   */
  footer: string;
  /** The footer a cut keeps, when it is not the whole footer (see {@link footer}). */
  cutFooter?: string;
}

export interface CommonOpts {
  tz?: string;
  lang?: string;
  source?: string;
  /**
   * The tool call's `competition` argument: an alias (`premier-league`) or an
   * ESPN slug (`eng.1`); wins over the server's `CLAUDINHO_COMPETITION`.
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
 * Server-lifetime adapters, keyed by source and competition (`source::slug`).
 * A stdio MCP session serves many tool calls, and constructing a fresh adapter
 * per call re-fetched the group map (a standings request) every time.
 * Freshness is bounded inside the adapter itself: the standings fetch is
 * shared for ~30s, then re-fetched, so a long-lived session never serves stale
 * tables. A `Map` keeps insertion order, which is the recency order here: a
 * hit is moved to the end, and past {@link KEPT_ADAPTERS_MAX} the first key is
 * evicted.
 */
const adapters = new Map<string, ProviderAdapter>();

/**
 * How many adapters the server keeps, at most. Fifteen supported competitions
 * and room for as many raw slugs again, so a client walking
 * `list_competitions` never evicts a supported one, while a client asking
 * distinct raw slugs cannot grow the server without limit. An evicted adapter
 * loses no throttle window: the window is remembered per source.
 */
export const KEPT_ADAPTERS_MAX = 32;

/** How many adapters the server keeps now. A test seam: nothing in the server reads it. */
export function keptAdapterCount(): number {
  return adapters.size;
}

/**
 * The provider's throttle window, per SOURCE: the latest deadline (epoch ms)
 * any adapter of that source met. The window is the provider's answer to this
 * server, not to one competition, so every adapter of the source honours it.
 */
const sourceWindows = new Map<string, number>();

/** The cooldown seam an adapter may expose (the real one does; `ProviderAdapter` has neither method). */
type Throttleable = {
  onCooldown(listener: (untilMs: number) => void): () => void;
  armCooldown(untilMs: number): void;
};
function throttleable(adapter: ProviderAdapter): adapter is ProviderAdapter & Throttleable {
  const t = adapter as Partial<Throttleable>;
  return typeof t.onCooldown === 'function' && typeof t.armCooldown === 'function';
}

/**
 * Every adapter built for a source that may still be alive, kept or not, held
 * WEAKLY: the map above forgets an adapter for the NEXT request, but a tool
 * call that resolved it before the eviction still holds it and may still ask
 * the provider (an off-bundle match refreshing its day after its discovery).
 * A throttle arms every adapter this set still reaches; a ref whose adapter
 * was collected arms nothing and is dropped when the set is walked. The set
 * holds no adapter alive: the map stays the one bound on what is kept.
 */
const builtAdapters = new Map<string, Set<WeakRef<Throttleable>>>();

/** How many refs a source's set holds now (a dropped one is gone). A test seam: nothing in the server reads it. */
export function builtAdapterRefs(source = 'espn'): number {
  return builtAdapters.get(source)?.size ?? 0;
}

/** The adapters of a source still alive; a ref whose adapter was collected is dropped here. */
function aliveAdapters(source: string): Throttleable[] {
  const refs = builtAdapters.get(source);
  if (!refs) return [];
  const alive: Throttleable[] = [];
  for (const ref of refs) {
    const adapter = ref.deref();
    if (adapter === undefined) refs.delete(ref);
    else alive.push(adapter);
  }
  return alive;
}

/** The sources whose throttle is being broadcast right now (see {@link broadcast}). */
const broadcasting = new Set<string>();

/**
 * Arm every adapter of `source` still alive, but the one that met the
 * throttle, with the source's deadline: ONE walk per throttle. Arming an
 * adapter fires its own listener synchronously, which would walk the set again,
 * one level deeper per adapter it arms first: with thousands of adapters held
 * by requests in flight (the set is bounded by liveness, not by the map) that
 * recursion exhausted the stack after the deadline was remembered and left the
 * adapters past it unarmed, and it was quadratic. So the walk is NON-REENTRANT
 * per source: a listener fired from inside it has already recorded the deadline
 * (latest wins) and returns here without walking. An adapter whose arming
 * throws is passed over and the walk goes on to the next: the window is the
 * provider's, and one adapter's failure must not leave the rest asking inside
 * it. The guard is cleared in a `finally`: a guard left set would silence every
 * later throttle of the source.
 */
function broadcast(source: string, met: Throttleable, deadline: number): void {
  if (broadcasting.has(source)) return;
  broadcasting.add(source);
  try {
    for (const other of aliveAdapters(source)) {
      if (other === met) continue;
      try {
        other.armCooldown(deadline);
      } catch {
        // Passed over: the rest of the source's adapters are still armed.
      }
    }
  } finally {
    broadcasting.delete(source);
  }
}

/**
 * Build and keep the adapter for a source and competition, joined to its
 * source's ONE throttle window: built inside a remembered window it is armed
 * at construction (the remembered deadline is compared with the adapter's
 * clock: a past one arms nothing; the deadline is remembered per source
 * because every adapter that met it may since have been collected), and a
 * throttle it meets is remembered for the source and arms every other adapter
 * of the source still alive, kept or evicted (`builtAdapters`), in ONE
 * non-reentrant walk ({@link broadcast}): arming an adapter fires its own
 * listener, which records the deadline and returns while the walk runs. An
 * adapter with neither method (a fake) is kept as it is: feature-detected,
 * never an error, and never in the set.
 */
function keepAdapter(source: string, competition: string, key: string): ProviderAdapter {
  const adapter = makeAdapter(source, { competition });
  if (throttleable(adapter)) {
    const until = sourceWindows.get(source);
    const nowMs = typeof adapter.now === 'function' ? adapter.now() : Date.now();
    if (until !== undefined && until > nowMs) adapter.armCooldown(until);
    adapter.onCooldown((untilMs) => {
      const deadline = Math.max(sourceWindows.get(source) ?? untilMs, untilMs);
      sourceWindows.set(source, deadline);
      broadcast(source, adapter, deadline);
    });
    // Drop the refs whose adapters were collected, then add this one.
    aliveAdapters(source);
    const refs = builtAdapters.get(source) ?? new Set<WeakRef<Throttleable>>();
    builtAdapters.set(source, refs);
    refs.add(new WeakRef(adapter));
  }
  adapters.set(key, adapter);
  while (adapters.size > KEPT_ADAPTERS_MAX) {
    const oldest = adapters.keys().next().value;
    if (oldest === undefined) break;
    adapters.delete(oldest);
  }
  return adapter;
}

/** The adapter already resolved for a request, keyed by that request's args object. */
const perRequest = new WeakMap<object, ProviderAdapter>();

/** A request's choice: the competition it is for (or none chosen), and the team a team-taking tool defaults to. */
interface RequestChoice {
  readonly selection: SelectedCompetition | { readonly kind: 'none' };
  /** The server's `CLAUDINHO_TEAM` (an empty one is absent): a query, before the pin. */
  readonly envTeam?: string;
  /** The user's saved team, only when the request is for its competition (whoever chose it). */
  readonly pin?: Pin;
  /** The saved team when it is ANOTHER competition's: named by the no-team error, never applied. */
  readonly elsewhere?: { readonly competition: string; readonly team: Pin };
}

/** The choice already resolved for a request, keyed by that request's args object. */
const perRequestChoice = new WeakMap<object, RequestChoice>();

/**
 * THE SERVER'S EDGE: the competition a request is for, from its `competition`
 * argument, then the server's `CLAUDINHO_COMPETITION`, then the user's saved
 * choice (the config file `claudinho follow` writes, read through core's one
 * no-follow bounded reader; core reads no environment and no file: the edge
 * hands them in); with none of the three, NOTHING is chosen, and the tool
 * answers the `noCompetition` verdict ({@link said}).
 *
 * This is the one place the server decides the competition, and it decides
 * ONCE per request (the file read once with it): the answer is remembered
 * against the request's args, so every helper a tool calls gets the same
 * selection, and the same pin, however many times it asks. A value that is
 * neither an alias nor a slug is a TOOL ERROR naming the value and the
 * aliases, thrown here, before any adapter is built or any request made. The
 * selection and the pin are the request's, never a shared adapter's; an
 * adapter injected for a test must serve it (see {@link resolveAdapter}).
 */
function choiceOf(args: CommonOpts): RequestChoice {
  const known = perRequestChoice.get(args);
  if (known) return known;
  const saved = readUserConfig(configPath(process.env, process.platform, homedir()));
  const config = saved.kind === 'read' ? saved.config : undefined;
  const selection = resolveCompetition(args.competition, process.env.CLAUDINHO_COMPETITION, config?.competition);
  if (selection.kind === 'refused') throw new Error(selectionRefusal(selection, args.lang));
  // The pin belongs to its competition, not to the source that chose it: it
  // applies to a request for the file's competition, however that request
  // chose it (core `pinUnder`, the CLI's rule too).
  const pin = pinUnder(selection.kind === 'selected' ? selection.slug : undefined, config);
  // The server's team, read here with its competition, once.
  const envTeam = process.env.CLAUDINHO_TEAM || undefined;
  // A saved team that does not apply here, for the error to name truthfully.
  const savedAt = config ? savedSlug(config.competition) : undefined;
  const elsewhere = !pin && config?.team && savedAt !== undefined ? { competition: competitionLabel(savedAt), team: config.team } : undefined;
  const choice: RequestChoice = {
    selection,
    ...(envTeam !== undefined ? { envTeam } : {}),
    ...(pin ? { pin } : {}),
    ...(elsewhere ? { elsewhere } : {}),
  };
  perRequestChoice.set(args, choice);
  return choice;
}

/** The request's selection (see {@link choiceOf}): a competition, or none chosen. A refused value throws. */
export function selectionOf(args: CommonOpts): SelectedCompetition | { readonly kind: 'none' } {
  return choiceOf(args).selection;
}

/** The request's competition, for a reader that can only run with one (a tool's answer, after `said`). */
function selectedOf(args: CommonOpts): SelectedCompetition {
  const selection = selectionOf(args);
  // An invariant, not an answer: `said` answers a request with none chosen
  // (the `noCompetition` verdict) before any answer runs.
  if (selection.kind !== 'selected') throw new Error('invariant: a competition-reading answer ran with no competition chosen');
  return selection;
}

/**
 * The adapter for a request: the injected one (tests), else the
 * server-lifetime adapter for its source and its selection's competition.
 * The selection is resolved first, so a refused value never builds one. An
 * injected adapter that serves another competition than the request selected
 * is refused here, before it is returned and so before any read: the selection
 * says what the answer is for and the adapter reads it, and the two must never
 * disagree (the body would be one competition's under another's name).
 */
export function resolveAdapter(args: CommonOpts): ProviderAdapter {
  const { slug: competition } = selectedOf(args);
  if (args.adapter) {
    if (args.adapter.competition !== competition) {
      throw new Error(`The injected adapter serves ${args.adapter.competition}; the request selected ${competition}.`);
    }
    return args.adapter;
  }
  const resolved = perRequest.get(args);
  if (resolved) return resolved;
  const source = args.source ?? 'espn';
  // Keyed by source AND competition: an adapter serves exactly one
  // competition, so a cache keyed by source alone would pin the first
  // competition seen for the whole session. The throttle window is the
  // SOURCE's, shared by every adapter of it still alive (`keepAdapter`): an
  // evicted adapter a running tool call still holds is armed too, since
  // eviction forgets an adapter for the next request, not for the one in
  // flight. The CLI keeps a per-scope note on disk instead, a different design
  // for one process per command.
  const key = `${source}::${competition}`;
  let adapter = adapters.get(key);
  if (adapter) {
    // Most recently used: moved to the end of the eviction order.
    adapters.delete(key);
    adapters.set(key, adapter);
  } else {
    adapter = keepAdapter(source, competition, key);
  }
  perRequest.set(args, adapter);
  return adapter;
}

/** The competition a request READS: its adapter's (the selection's, unless a test injected one). */
function competitionOf(args: CommonOpts): string {
  return resolveAdapter(args).competition;
}

/**
 * A competition-answering tool's result, said for its selection: the mode line
 * FIRST in its text (core `modeLine`; a tool's argument reads "from the
 * request") and the `competition` key in its data (core `selectionExtras`).
 * The selection is resolved BEFORE the answer is computed: a refused value is
 * a tool error with no adapter built and no request made. `line: false` for a
 * share card, which names its competition in its own title (the card is the
 * artifact, handed over verbatim).
 *
 * With NOTHING chosen, the answer is not computed at all: no adapter is built
 * and nothing is read. The tool answers the `noCompetition` verdict (the first
 * replacing one): its text the one sentence (core `verdictNotice`) and the
 * disclaimer, its data the tool's OWN empty healthy shape (`refusal`, written
 * beside each answer, so no shape is guessed here) plus `competition: null`
 * and `noCompetition: true` (core `selectionExtras`, `verdictExtras`).
 */
async function said<A extends CommonOpts>(
  args: A,
  answer: (args: A) => Promise<ToolResult>,
  refusal: (args: A, sentence: string) => Record<string, unknown>,
  { line }: { line: boolean } = { line: true },
): Promise<ToolResult> {
  const selection = selectionOf(args);
  if (selection.kind !== 'selected') {
    const verdict = selectionVerdict(selection);
    const sentence = verdictNotice(verdict, args.lang) ?? '';
    return {
      ...disclaimed(sentence, undefined, args.lang),
      data: { ...refusal(args, sentence), ...selectionExtras(selection), ...verdictExtras(verdict) },
    };
  }
  const r = await answer(args);
  return {
    ...r,
    text: line ? `${modeLine(selection, args.lang, 'request')}\n${r.text}` : r.text,
    data: { ...(r.data as Record<string, unknown>), ...selectionExtras(selection) },
  };
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
  return `${withFlag(m.home.name, m.home.flag, 'home')} vs ${withFlag(m.away.name, m.away.flag, 'away')} (${when})`;
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

/**
 * Flavor from the call arg, else the server env, else the default (full); the
 * team kind of the competition the adapter serves (a rally cry's kind); the
 * request's pin (its saved team, when it applies to the request's
 * competition), which decides between two cries on every line.
 */
function fmtOpts(args: CommonOpts, competition: string): FmtOpts {
  const pin = choiceOf(args).pin;
  return {
    tz: args.tz,
    locale: args.lang,
    flavor: asFlavorLevel(args.flavor ?? process.env.CLAUDINHO_FLAVOR),
    teamKind: teamKind(competition),
    ...(pin ? { pin } : {}),
  };
}

/**
 * A tool's text: the body, then its footer (the attribution, when live data
 * actually served the result, and the disclaimer). The footer is returned on
 * its own too, so a text cut at a length keeps it (`toContent`).
 */
function disclaimed(
  body: string,
  source?: string,
  lang?: string,
  /** A date's read, for its list: on one that was not whole a cut drops the attribution (see `ToolResult.footer`). Never a live list's. */
  read?: VerdictSource,
): { text: string; footer: string; cutFooter?: string } {
  const live = source
    ? `\n${t(lang, 'live.data', { source: liveSourceLabel(source) })}`
    : '';
  const footer = `${live}\n\n${DISCLAIMER}`;
  const cut = live && read && statesPartial(read) ? { cutFooter: `\n\n${DISCLAIMER}` } : {};
  return { text: `${body}${footer}`, footer, ...cut };
}

/**
 * A tool's text with the sentences that QUALIFY it said FIRST, the body kept
 * (the rule on `ToolResult.footer`). First, because a tool's text is cut at a
 * fixed length from the end: a sentence at the tail would be the first thing
 * a long answer lost. In this order: the verdict's (core `verdictQualifiers`:
 * the read was not whole), then `also`, in the order given: the sentence core
 * built beside the verdict's (a day's count of shown rows the read did not
 * serve) first, then the tool's own notes (a degraded line, a market notice,
 * the list's truncation), in the order they used to follow the body. An absent
 * one is skipped. Nothing is added when there is none; a result that states a
 * replacement states no qualifier (it stands instead of the body).
 */
function qualified(body: string, result: VerdictSource, lang?: string, ...also: Array<string | undefined>): string {
  const qualifiers = [...verdictQualifiers(result, lang), ...also.filter((s): s is string => !!s)];
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
export function toolGetToday(args: { date?: string } & CommonOpts): Promise<ToolResult> {
  return said(args, todayAnswer, (a) => ({
    date: a.date ?? localDate((a.now ?? new Date()).toISOString(), a.tz),
    degraded: false,
    source: null,
    count: 0,
    truncated: false,
    matches: [],
  }));
}
async function todayAnswer(
  args: { date?: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const date = args.date ?? localDate((args.now ?? new Date()).toISOString(), args.tz);
  // The viewer's zone, the one the day is filed by below: the read judges
  // "nothing on this date" in it too.
  const day = await getMatchesForDate(adapter, date, resolveTz(args.tz));
  const { matches, degraded, source } = day;
  const todays = fixturesByDate(date, matches, args.tz);
  // ONE bounded view: what the text lists, what `data` carries, and what the
  // day's attribution is decided over.
  const shownToday = boundedRecords(todays);
  const opts = fmtOpts(args, adapter.competition);
  // A verdict (between editions) stands instead of the empty line. Where no
  // bundled schedule was merged, a failed read says the provider could not be
  // reached, and a read that was not whole says none was READ.
  const empty =
    verdictNotice(day, args.lang) ??
    dateUnreached(day, date, args.lang) ??
    dateNoneRead(day, date, args.lang) ??
    'No matches scheduled.';
  const text = `${headingLine(args.lang, t(args.lang, 'today.onDate', { date }))}\n${matchRows(todays, empty, opts)}`;
  // Degraded ⇒ the live overlay failed: on the bundle these are static fixtures
  // with no live scores; off it there is no schedule to show.
  const degradedLine = degraded
    ? day.skeleton
      ? '(Live scores unavailable — showing the bundled schedule.)'
      : "(Live scores unavailable — couldn't reach the data provider.)"
    : undefined;
  const market = await reliableMarketData(args, todays);
  const marketLine = market.complete
    ? undefined
    : '(Market data unavailable or incomplete — not all fixtures were checked.)';
  // On a read that was not whole: the verdict first (kept by a cut), with the
  // count of shown rows it did not serve; the footer names the provider only
  // for a day it served something of. `data.source` keeps the provider. Then
  // the list's own notes, before the rows too (in the order they used to
  // follow them: the truncation, the outage, the markets).
  const attribution = dayAttribution(day, shownToday.items, args.lang);
  return {
    ...disclaimed(
      qualified(text, day, args.lang, attribution.unserved, listTruncation(todays), degradedLine, marketLine),
      attribution.attributed ? source : undefined,
      args.lang,
      day,
    ),
    data: {
      date,
      degraded,
      source: source ?? null,
      // The shown (bounded) rows the overlay held (a plain field, not a
      // verdict), beside `partial` only: a shown row not among them is the
      // bundled schedule's.
      ...servedExtras(day, shownToday.items),
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
export function toolGetLive(args: CommonOpts = {}): Promise<ToolResult> {
  return said(args, liveAnswer, () => ({ degraded: false, source: null, count: 0, truncated: false, matches: [] }));
}
async function liveAnswer(args: CommonOpts): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const live = await getLiveMatches(adapter, args.now ?? new Date());
  const { matches, degraded, source } = live;
  const opts = fmtOpts(args, adapter.competition);
  // Degraded ⇒ the live feed failed, NOT "nothing is on". Distinguish them so the
  // agent doesn't tell the user no matches are live when the provider is unreachable.
  // A verdict (between editions) stands instead of the empty line; a read that
  // was not whole says none in play was READ. The read's own verdict is said
  // first (kept by a cut).
  const text = degraded
    ? 'Live scores unavailable right now — could not reach the data provider.'
    : `${headingLine(args.lang, t(args.lang, 'live.title'))}\n${matchRows(matches, verdictNotice(live, args.lang) ?? liveNoneRead(live, args.lang) ?? 'No matches in play right now.', opts)}`;
  const shownLive = boundedRecords(matches);
  return {
    // Every row a live list shows was served: a cut keeps its attribution
    // (`ToolResult.footer`). The list's truncation is said before its rows.
    ...disclaimed(qualified(text, live, args.lang, degraded ? undefined : listTruncation(matches)), source, args.lang),
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
export function toolGetMatch(args: { id: string } & CommonOpts): Promise<ToolResult> {
  return said(args, matchAnswer, () => ({ match: null, source: null }));
}
async function matchAnswer(
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
  const opts = fmtOpts(args, adapter.competition);
  const now = args.now ?? new Date();
  let marketSignal: MarketSignal | undefined;
  let marketComplete = true;
  if (marketsEnabled() && marketRelevant(match, now)) {
    const market = await cachedMarketSignals(args, [match]);
    marketComplete = market.complete;
    const s = market.signals.get(match.id);
    if (s && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(match, s)) marketSignal = s;
  }
  // The day's rule over the one record shown: on a read that was not whole, a
  // record the window did not hold is the bundle's row, its live state unconfirmed.
  const attribution = dayAttribution(found, [match], args.lang);
  const base = matchLine(match, opts);
  const text = marketSignal ? `${base}\n${marketBlock(marketSignal, match).join('\n')}` : base;
  // Degraded ⇒ the live overlay failed; this is the static fixture, no live
  // state. Off the bundled competition there is no static fixture: it is the
  // provider's own earlier record, whose state could not be refreshed.
  const degradedLine = degraded
    ? found.earlierRecord
      ? EARLIER_RECORD_NOTE
      : '(Live state unavailable — showing the scheduled fixture.)'
    : undefined;
  const marketLine = marketComplete
    ? undefined
    : '(Market data unavailable or incomplete — this match was not checked.)';
  return {
    // Every sentence that qualifies the match before it (`qualified`): the
    // verdict, the unserved count, then the outage and the markets.
    ...disclaimed(qualified(text, found, args.lang, attribution.unserved, degradedLine, marketLine), liveSource, args.lang),
    data: {
      degraded,
      source: liveSource ?? null,
      // The match, if the overlay held it (a plain field, not a verdict), beside `partial` only.
      ...servedExtras(found, [match]),
      match,
      marketComplete,
      marketSignal: marketSignal ? marketData(marketSignal) : null,
      ...verdictExtras(found),
    },
  };
}

/** standings: one group table, or all of them. */
export function toolGetStandings(args: { group?: string } & CommonOpts): Promise<ToolResult> {
  // The empty healthy shape: one key's table is `null`, every table `[]`.
  return said(args, standingsAnswer, (a) => ({ degraded: false, source: null, tables: a.group ? null : [] }));
}
async function standingsAnswer(
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
  const text = shaped
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
  // Before the tables too, after the verdict, in the order they used to
  // follow them: the list's truncation (stated, not silent — the same rule the
  // match lists follow; its own line here, not the tail of the last table),
  // then the roster note.
  const before = [
    ...qualifiers.map((q) => `(${q})`),
    ...(boundedTables.truncated ? [truncationNote(boundedTables)] : []),
    ...(degraded ? ['(Live standings unavailable — showing the group roster.)'] : []),
  ];
  return {
    ...disclaimed(before.length > 0 ? `${before.join('\n')}\n\n${text}` : text, source, args.lang),
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
export function toolGetBracket(args: { stage?: string } & CommonOpts): Promise<ToolResult> {
  return said(args, bracketAnswer, () => ({ view: null }));
}
async function bracketAnswer(
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
  const text = formatBracketList(view, { footer: false, locale: args.lang, tz: args.tz });
  // The tree is structure only, or its group slots wait on standings: said
  // before the tree, after the verdict (`qualified`).
  const note = degraded
    ? `(${t(args.lang, 'bracket.degraded')})`
    : standingsDegraded
      ? `(${t(args.lang, 'bracket.standingsDegraded')})`
      : undefined;
  return {
    ...disclaimed(qualified(text, bracket, args.lang, note), source, args.lang),
    data: { degraded, standingsDegraded, source: source ?? null, view, ...verdictExtras(bracket) },
  };
}

/**
 * Text body for the `standings://{group}` resource. Shares the `get_standings`
 * path so it carries the SAME provider attribution + disclaimer — a resource that
 * served live ESPN data must still say `Live data: ESPN` (provider-attribution
 * constraint). Pure given an adapter and the selection, so it's unit-testable.
 *
 * Like a tool's text it begins with the mode line (core `modeLine`, English: a
 * resource takes no language), on every branch: a table, no such table, an
 * outage, and a key that is not one. The caller resolves the selection before
 * it builds the adapter.
 */
export async function standingsResourceText(
  group: string,
  adapter: ProviderAdapter,
  selection: SelectedCompetition,
): Promise<string> {
  const named = (text: string) => `${modeLine(selection, undefined)}\n${text}`;
  // A resource URI is typed by anyone: what is not a table key is refused
  // here, before a request, with the grammar a key has.
  const g = tableKeyArg(group);
  if (!g) {
    return named(
      disclaimed(
        'Not a table. Use standings://A for a group, or a key such as standings://A1, standings://A-B or standings://LEAGUE.',
        undefined,
      ).text,
    );
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
  return named(disclaimed(text, source).text);
}

/**
 * The `standings://{group}` resource with nothing chosen: the `noCompetition`
 * verdict's sentence and the disclaimer, nothing read (English: a resource
 * takes no language).
 */
export function noCompetitionText(selection: { readonly kind: 'none' }): string {
  return disclaimed(verdictNotice(selectionVerdict(selection)) ?? '').text;
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

/** What `get_next_fixture` with no `team` says when there is no team to default to, and none pinned anywhere. */
const NO_TEAM =
  'No team given and none pinned: pass `team`, or the user runs `claudinho follow <alias> --team <name>`.';

/**
 * Why `get_next_fixture` has no team, TRUE in each state: a team pinned for
 * another competition is named as such (it is not "none pinned"); otherwise
 * none is pinned at all.
 */
function noTeamError(choice: RequestChoice): Error {
  if (choice.elsewhere) {
    const { competition, team } = choice.elsewhere;
    return new Error(
      `No team given, and the pinned team is ${competition}'s (${team.name}), not this competition's: pass \`team\`, or the user runs \`claudinho follow <alias> --team <name>\`.`,
    );
  }
  return new Error(NO_TEAM);
}

/** The server's CLAUDINHO_TEAM, set with nothing readable in it: named as such. */
const ENV_TEAM_UNREADABLE =
  "The server's CLAUDINHO_TEAM names no team: pass `team`, or set CLAUDINHO_TEAM to a team's name or code.";

/**
 * The team `get_next_fixture` is about, by the CLI's precedence: the argument,
 * then the server's `CLAUDINHO_TEAM` (both a query, resolved alike), then the
 * user's saved pin (a team already resolved). None of the three: undefined.
 */
function nextAsked(
  args: { team?: string } & CommonOpts,
): { query: string; from: 'argument' | 'env' } | { pin: Pin } | undefined {
  if (args.team !== undefined) return { query: args.team, from: 'argument' };
  const choice = choiceOf(args);
  if (choice.envTeam !== undefined) return { query: choice.envTeam, from: 'env' };
  return choice.pin ? { pin: choice.pin } : undefined;
}

export function toolGetNextFixture(args: { team?: string } & CommonOpts): Promise<ToolResult> {
  return said(args, nextAnswer, (a) => {
    // The team as asked, bounded: the argument, the server's, or the pin's label.
    const asked = nextAsked(a);
    return {
      team: asked === undefined ? '' : 'query' in asked ? humanLabel(asked.query, 40) : asked.pin.name,
      fixture: null,
      degraded: false,
      source: null,
    };
  });
}
async function nextAnswer(
  args: { team?: string } & CommonOpts,
): Promise<ToolResult> {
  // The argument, then the server's CLAUDINHO_TEAM (a query, as an argument
  // is), then the user's saved pin: a team already resolved when it was saved
  // (by its id; by code for the World Cup's nations), never resolved again;
  // only for a request for its competition, however that was chosen (another
  // competition does not apply it). None: a tool error.
  const teamAsked = nextAsked(args);
  if (teamAsked === undefined) throw noTeamError(choiceOf(args));
  // The server's CLAUDINHO_TEAM with nothing readable in it names no team (it
  // is not schema-checked, unlike the argument): said so, before any read.
  if ('from' in teamAsked && teamAsked.from === 'env' && !humanLabel(teamAsked.query, 40)) throw new Error(ENV_TEAM_UNREADABLE);
  const pin = 'pin' in teamAsked ? teamAsked.pin : undefined;
  const adapter = resolveAdapter(args);
  // The World Cup: a nation's code, or a name resolved against the bundled
  // roster (`nationArg`); a name that is no single nation is answered without
  // a request (the candidates, or no such team). Off the bundled competition
  // the query goes through as asked: core resolves the club against the
  // competition's roster and the schedule ahead. Never the RAW argument: a
  // direct call bypasses the input schema, and what is carried into the text,
  // a card or a run cue is the bounded label.
  const query = pin
    ? bundleApplies(adapter.competition)
      ? pin.code
      : pin.name
    : humanLabel('query' in teamAsked ? teamAsked.query : '', 40);
  // An argument with nothing readable in it (a direct call, past the schema) names no team.
  if (!query) throw new Error(NO_TEAM);
  const asked = pin
    ? { code: query }
    : bundleApplies(adapter.competition)
      ? nationArg(query)
      : { code: query };
  const code = 'code' in asked ? asked.code : query;
  // Overlay the live knockout window so a confirmed R32+ tie resolves: the
  // bundled knockout slots are placeholders, so a static lookup goes blind once
  // a team's group games pass (it would answer "no upcoming fixture" even after
  // ESPN confirmed the tie). Fails closed to the static result on a feed outage.
  // The caller's clock is still threaded for deterministic tests.
  const now = args.now ?? new Date();
  const next = pin
    ? await nextFixtureForPin(adapter, pin, now)
    : 'code' in asked
      ? await getNextFixtureForTeam(adapter, code, now)
      : asked.answer;
  const { fixture, degraded, source } = next;
  const label = nextTeamLabel(next, code);
  // Who the answer is about, found or not: "Next up for Mexico:" (core's
  // catalog, in the request's language), then the fixture or the sentence.
  const heading = headingLine(args.lang, t(args.lang, 'next.label', { team: label }));
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
      ...disclaimed(qualified(`${heading}\n${msg}`, next, args.lang), undefined, args.lang),
      data: { ...about, fixture: null, degraded, source: source ?? null, ...verdictExtras(next) },
    };
  }
  const opts = fmtOpts(args, adapter.competition);
  return {
    // `source` in data mirrors the text's "Live data: …" attribution (parity
    // with CLI `next --json`); null for a static group fixture (no live source).
    ...disclaimed(qualified(`${heading}\n${matchLine(fixture, opts)}`, next, args.lang), source, args.lang),
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
    text = `${team.code} — ${withFlag(team.name, team.flag, 'home')}${team.group ? ` · Group ${team.group}` : ''}`;
  } else if (matches.length > 0) {
    text = `"${args.query}" is ambiguous. Did you mean: ${matches
      .map((t) => `${t.name} (${t.code})`)
      .join(', ')}?`;
  } else {
    text = `No team found for "${args.query}". Use a nation name or 3-letter code (e.g. Mexico, MEX).`;
  }
  // Which roster answered: the World Cup's, whatever competition is selected
  // (get_team takes no competition and its data carries none). Core's
  // sentence, the one CLI `team` prints too; English, like this tool's text.
  return { ...disclaimed(`${t('en', 'team.roster')}\n${text}`), data };
}

/**
 * list_competitions: the supported table, offline. Every row with its alias,
 * name, teams, kind and capabilities, and the request's selection as
 * `current` (null when nothing is chosen: no argument, no server environment,
 * no saved choice). No edition state: whether an edition is
 * in season is a fact of a read (`betweenEditions`), not of the table.
 */
export function toolListCompetitions(args: { competition?: string; lang?: string } = {}): ToolResult {
  const selection = selectionOf(args);
  const data = listCompetitions(SUPPORTED, selectionExtras(selection).competition ?? null);
  const rows = data.competitions.map((c) => {
    const caps = [c.capabilities.scores, c.capabilities.next, c.capabilities.standings, c.capabilities.bracket, c.capabilities.markets];
    return `${c.alias} · ${c.name} · ${c.teams} · ${caps.join('/')}`;
  });
  const text = [
    'Competitions (alias · name · teams · scores/next/standings/bracket/markets):',
    ...rows,
    '',
    // With none chosen, the verdict's sentence says how to choose.
    `Current: ${selection.kind === 'selected' ? modeLine(selection, args.lang, 'request') : (verdictNotice(selectionVerdict(selection), args.lang) ?? '')}`,
  ].join('\n');
  return { ...disclaimed(text), data };
}

/**
 * market_signal: read-only prediction-market signals for a single match (by id), a
 * team's next fixture, or all of a date's matches (default: today). Returns
 * market-implied percentages with attribution; never links, never advice.
 */
export function toolGetMarketSignal(
  args: { matchId?: string; team?: string; date?: string } & CommonOpts,
): Promise<ToolResult> {
  return said(args, marketAnswer, () => ({ informationalOnly: true, signal: null }));
}
async function marketAnswer(
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
      // The fixture read was not whole: said first, apart from `complete`
      // (the market requests' own completeness).
      ...disclaimed(qualified(text, found, args.lang)),
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
      // Either read the pick was made from was not whole: said first, apart
      // from `complete` (the market requests' own completeness).
      ...disclaimed(qualified(text, picked, args.lang)),
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
  const day = await getMatchesForDate(resolveAdapter(args), date, resolveTz(args.tz));
  // The fixture read's verdict is part of the answer where markets are read
  // (off their scope the scope verdict is the whole answer, as before).
  const fixtureRead = marketsCoverCompetition(competitionOf(args)) ? day : {};
  const todays = fixturesByDate(date, day.matches, args.tz).filter((m) => marketRelevant(m, now));
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
  const text = shown.shown
    ? `Market signals on ${date}:\n${shown.items
        .map(({ match, signal }) => marketText(match, signal, args))
        .join('\n\n')}`
    : // An empty result and an INCOMPLETE one are different answers. The batch
      // knows which it was — a provider outage or an expired deadline leaves it
      // `complete: false` — and collapsing to `resolvedValues` threw that away,
      // so "we could not reach the market data" rendered as the confident
      // "there is none", which is the failure this project refuses everywhere
      // else.
      // A fixture read that was not whole: none among the fixtures READ.
      !marketsCoverCompetition(competitionOf(args))
        ? `${MARKETS_SCOPE_NOTE} (${date})`
        : batch.complete
          ? (marketsNoneRead(day, date) ?? `No reliable market signals on ${date}.`)
          : `Market data unavailable or incomplete for ${date} — not all fixtures could be checked.`;
  // Before the signals, after the fixture read's verdict (`qualified`), in the
  // order they used to have: the list's truncation (it was on the title line),
  // then the notice that the batch did not finish.
  const truncated = shown.truncated ? truncationNote(shown) : undefined;
  const incomplete =
    shown.shown > 0 && !batch.complete
      ? `Market data unavailable or incomplete for ${date} — not all fixtures could be checked.`
      : undefined;
  return {
    ...disclaimed(qualified(text, fixtureRead, args.lang, truncated, incomplete)),
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
      ...verdictExtras(fixtureRead),
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
  /** A date's card: on a read that was not whole a cut drops the attribution (see `ToolResult.footer`). Never the live card. */
  date = false,
): ToolResult {
  const { input } = card;
  const snippet = formatShareSnippet(input, options);
  // The footer a cut keeps: the same card's footer with no provider line (one
  // extra render, only for a date's card on a read that was not whole).
  const cut =
    date && input.source && statesPartial(card.verdict)
      ? { cutFooter: snippetFooter(formatShareSnippet({ ...input, source: undefined }, options)) }
      : {};
  return {
    // The snippet is self-contained: it carries its own non-affiliation
    // disclaimer (and, for any market line, the "informational only" caveat +
    // attribution), so it is deliberately NOT wrapped with `disclaimed` —
    // that would duplicate the disclaimer inside a paste-ready artifact.
    text: snippet,
    footer: snippetFooter(snippet),
    ...cut,
    data: {
      kind: card.kind,
      target: card.target,
      ...(card.team ? { team: card.team } : {}),
      ...(card.candidates ? { candidates: card.candidates } : {}),
      source: input.source ?? null,
      // The card's read's plain fields (the ids it held, beside `partial` only).
      ...card.readFields,
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
export function toolGetShareSnippet(args: ShareArgs): Promise<ToolResult> {
  // The card names its competition in its title: no mode line before it.
  // With nothing chosen, the kind asked (the routing precedence below) and the sentence as its snippet.
  return said(args, shareAnswer, (a, sentence) => ({ kind: shareKindAsked(a), snippet: sentence }), { line: false });
}

/** The card a request asks for, by `shareAnswer`'s routing precedence: live > group > bracket > matchId > team > date. */
function shareKindAsked(args: ShareArgs): string {
  if (args.live) return 'live';
  if (args.group) return 'table';
  if (args.bracket) return 'bracket';
  if (args.matchId) return 'match';
  if (args.team) return 'next';
  return 'today';
}
async function shareAnswer(args: ShareArgs): Promise<ToolResult> {
  const options = shareOptions(args);
  // Per-call opt-out: `includeMarkets: false` skips the provider ENTIRELY (no
  // fetch) and yields no market data — not merely suppressed rendering. The env
  // opt-out (CLAUDINHO_MARKETS=off) is handled inside reliableSignalMap.
  const signalsFor = (ms: readonly Match[]): Promise<MarketSignalsResult> =>
    args.includeMarkets === false
      ? Promise.resolve({ signals: new Map(), complete: true })
      : reliableSignalMap(args, ms);

  // The competition goes on the card: its title names it and its run cue
  // selects it. The SELECTION's (what the answer is said to be for), like the
  // mode line and the `competition` key.
  const competition = selectedOf(args).slug;
  const where = { tz: args.tz, locale: args.lang, competition };

  // live: matches in play right now (no market enrichment, matching the CLI).
  if (args.live) {
    const live = await getLiveMatches(resolveAdapter(args), args.now ?? new Date());
    // Bounded like the date branch: a share card is returned through MCP
    // before a human ever sees it. The count is STATED, not silently lost.
    const shownLive = boundedRecords(live.matches);
    return shareResult(
      liveShareCard(live, where, {
        matches: shownLive.items,
        // The cap qualifies the list: in the card's note, after the verdict.
        cap: truncationNote(shownLive),
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
    const card = tableShareCard(standings, group, boundedRecords(standings.tables).items, args.lang, competition);
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
    const card = bracketShareCard(bracket, stageFilter, args.lang, competition);
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
    // bundle the query goes through as asked (core resolves the club). The
    // bounded label, never the raw argument: it is pasted into the run cue.
    const query = humanLabel(args.team, 40);
    const asked = bundleApplies(adapter.competition) ? nationArg(query) : { code: query };
    const code = 'code' in asked ? asked.code : query;
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
        // The cap qualifies the list: in the card's note, after the verdict.
        cap: truncationNote(shownToday),
        // The read decides what an empty day says (whether it merged the
        // bundled schedule) and the card's attribution, over the bounded list.
        read: day,
      },
      market,
      where,
    ),
    options,
    todays.length,
    true,
  );
}
