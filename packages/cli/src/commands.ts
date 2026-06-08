import {
  allFixtures,
  computeStandings,
  countdown,
  fixturesByDate,
  fixturesByGroup,
  formatKickoff,
  getMarketSignals,
  groups,
  hasSaneDistribution,
  isReliableMarketSignal,
  isValidDate,
  isValidTimeZone,
  localDate,
  makeMarketProvider,
  marketBlock,
  marketLine,
  matchFlavor,
  matchLocation,
  nextFixtureForTeam,
  resolveCompetition,
  resolveMarketSource,
  scoreline,
} from '@claudinho/core';
import Table from 'cli-table3';
import type { CliConfig } from './config';
import type { Translator } from './i18n';
import {
  disclaimer,
  header,
  matchLine,
  type Painter,
  painterFor,
  statusToken,
} from './format';
import {
  getLiveMatches,
  getMatchesForDate,
  makeAdapter,
} from './data';
import { readMarketCache, writeMarketCache } from './marketCache';
import type { Match, MarketProvider, MarketSignal, ProviderAdapter } from '@claudinho/core';
import { readCurrentState } from './cache';
import { renderPrompt } from './statusline';
import { renderHook } from './hook';
import { runRefresh, shouldRefresh, spawnRefresh } from './refresh';
import { initHook, initStatusline } from './install';

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
};

/** The injected adapter, or one constructed from the configured source. */
function adapterFor({ cfg, adapter }: Ctx): ProviderAdapter {
  return adapter ?? makeAdapter(cfg.source);
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
async function marketSignalsFor(
  ctx: Ctx,
  matches: Match[],
  opts: MarketFetchOpts = {},
): Promise<Map<string, MarketSignal>> {
  if (ctx.marketProvider) return getMarketSignals(ctx.marketProvider, matches, opts);
  const source = resolveMarketSource();
  // Dev/demo/no-op providers ('fake'/'none') are free — skip the on-disk cache.
  if (source !== 'polymarket') {
    return getMarketSignals(makeMarketProvider(source), matches, opts);
  }
  const competition = resolveCompetition();
  const { signals: cached, checked } = readMarketCache('polymarket', competition);
  const result = new Map<string, MarketSignal>();
  const miss: Match[] = [];
  for (const m of matches) {
    const hit = cached.get(m.id);
    if (hit) result.set(m.id, hit);
    else if (!checked.has(m.id)) miss.push(m); // negative-cached → skip re-fetch
  }
  if (miss.length > 0) {
    const fetched = await getMarketSignals(makeMarketProvider('polymarket'), miss, opts);
    writeMarketCache(
      'polymarket',
      competition,
      miss.map((m) => m.id),
      fetched,
    );
    for (const [id, s] of fetched) result.set(id, s);
  }
  return result;
}

/** Strict-gated signals for the default-on annotation; empty when markets are off. */
async function reliableMarketSignals(
  ctx: Ctx,
  matches: Match[],
): Promise<Map<string, MarketSignal>> {
  if (ctx.cfg.markets === false) return new Map();
  const raw = await marketSignalsFor(ctx, matches, DEFAULT_ON_MARKET_OPTS);
  const now = new Date();
  const out = new Map<string, MarketSignal>();
  for (const [id, s] of raw) if (isReliableMarketSignal(s, { now })) out.set(id, s);
  return out;
}

async function reliableMarketSignalFor(ctx: Ctx, match: Match): Promise<MarketSignal | undefined> {
  return (await reliableMarketSignals(ctx, [match])).get(match.id);
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
  if (date !== undefined && !isValidDate(date)) {
    throw new InputError(t('err.date', { date }));
  }
}

/** `claudinho today [date]` */
export async function cmdToday(date: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t, date);
  const adapter = adapterFor(ctx);
  const targetDate = date ?? localDate(new Date().toISOString(), cfg.tz);
  const { matches, degraded } = await getMatchesForDate(adapter, targetDate);
  const todays = fixturesByDate(targetDate, matches, cfg.tz);
  const signals = await reliableMarketSignals(ctx, todays);

  if (cfg.json) {
    emitJson({
      date: targetDate,
      degraded,
      matches: todays,
      marketSignals: Object.fromEntries(signals),
    });
    return;
  }

  const c = painterFor(cfg);
  // "Today's matches" only when no explicit date was given; otherwise "Matches".
  const title = date === undefined ? t('today.title') : t('today.on');
  out();
  out(header(`${title} · ${targetDate}`, c));
  out();
  if (todays.length === 0) {
    out(c.dim('  ' + t('today.none')));
  } else {
    for (const m of todays) {
      out(matchLine(m, cfg, t, c));
      const s = signals.get(m.id);
      if (s) out('    ' + c.dim(marketLine(s, m)));
    }
  }
  out();
  out(disclaimer(t, c));
}

/** `claudinho live` */
export async function cmdLive(ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const adapter = adapterFor(ctx);
  const { matches, degraded } = await getLiveMatches(adapter);

  if (cfg.json) {
    emitJson({ degraded, matches });
    return;
  }

  const c = painterFor(cfg);
  out();
  out(header(t('live.title'), c));
  out();
  if (matches.length === 0) {
    out(c.dim('  ' + t('live.none')));
  } else {
    for (const m of matches) out(matchLine(m, cfg, t, c));
  }
  out();
  out(disclaimer(t, c));
}

/** `claudinho next <team>` */
export async function cmdNext(team: string, { cfg, t }: Ctx): Promise<void> {
  precheck(cfg, t);
  const code = team.toUpperCase();
  const fixture = nextFixtureForTeam(code);

  if (cfg.json) {
    emitJson({ team: code, fixture: fixture ?? null });
    return;
  }

  const c = painterFor(cfg);
  out();
  if (!fixture) {
    out(c.dim('  ' + t('next.none', { team: code })));
    out();
    out(disclaimer(t, c));
    return;
  }
  out(header(t('next.label', { team: code }), c));
  out();
  out(matchLine(fixture, cfg, t, c));
  out(
    '  ' +
      c.dim(
        `${formatKickoff(fixture.kickoff, { tz: cfg.tz, locale: cfg.lang })} · ` +
          t('next.in', { countdown: countdown(fixture.kickoff) }),
      ),
  );
  out();
  out(disclaimer(t, c));
}

/** `claudinho table [group]` */
export async function cmdTable(group: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const adapter = adapterFor(ctx);
  // Overlay results so finished games count toward the live table. Group by the
  // user's local "today"; getMatchesForDate fetches the spanning UTC window so a
  // late-UTC result still overlays. Falls back to the static schedule on error.
  const { matches } = await getMatchesForDate(
    adapter,
    localDate(new Date().toISOString(), cfg.tz),
  );

  const wanted = group ? [group.toUpperCase()] : groups(matches);

  if (cfg.json) {
    const tables = wanted.map((g) => ({
      group: g,
      standings: computeStandings(fixturesByGroup(g, matches)),
    }));
    emitJson(group ? tables[0] ?? null : tables);
    return;
  }

  const c = painterFor(cfg);
  for (const g of wanted) {
    const rows = computeStandings(fixturesByGroup(g, matches));
    if (rows.length === 0) {
      out();
      out(c.dim('  ' + t('table.none', { group: g })));
      continue;
    }
    out();
    out(header(t('table.title', { group: g }), c));
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
        `${r.team.flag} ${r.team.name}`,
        r.played,
        r.won,
        r.drawn,
        r.lost,
        r.goalDiff > 0 ? `+${r.goalDiff}` : `${r.goalDiff}`,
        cfg.color ? c.bold(`${r.points}`) : r.points,
      ]);
    }
    out(table.toString());
  }
  out();
  out(disclaimer(t, c));
}

/**
 * `claudinho prompt` — the HOT PATH. Reads the cache, prints one line, and (if
 * warranted) fires a detached refresher. Synchronous, no network, never throws.
 */
export function cmdPrompt({ cfg }: Ctx): void {
  try {
    const team = process.env.CLAUDINHO_TEAM;
    const compact = !['0', 'false', 'no'].includes(
      (process.env.CLAUDINHO_COMPACT ?? '').toLowerCase(),
    );
    const maxRaw = Number.parseInt(process.env.CLAUDINHO_MAX ?? '', 10);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;
    // Only trust a snapshot fetched for the current source + competition.
    const state = readCurrentState(cfg.source, resolveCompetition());
    out(renderPrompt(state, { team, compact, max }));
    if (!state || shouldRefresh()) spawnRefresh(cfg.source);
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
    const team = process.env.CLAUDINHO_TEAM;
    // Only trust a snapshot fetched for the current source + competition.
    const state = readCurrentState(cfg.source, resolveCompetition());
    const ctx = renderHook(state, { team });
    if (ctx) out(ctx);
    if (!state || shouldRefresh()) spawnRefresh(cfg.source);
  } catch {
    // Never block the prompt — emit nothing on any error.
  }
}

/** `claudinho _refresh` — internal cold-path cache refresher. */
export async function cmdRefresh({ cfg }: Ctx): Promise<void> {
  await runRefresh({ source: cfg.source });
}

/** `claudinho init-statusline` — patch Claude Code settings.json. */
export function cmdInitStatusline(opts: { print?: boolean }, { cfg }: Ctx): void {
  const res = initStatusline({ print: opts.print });
  const c = painterFor(cfg);
  if (res.action === 'printed') {
    out(res.message);
    return;
  }
  const mark =
    res.action === 'written' ? c.green('✓') : res.action === 'already' ? c.cyan('•') : c.yellow('!');
  out(`${mark} ${res.message}`);
}

/** `claudinho init-hook` — wire the live-score UserPromptSubmit hook. */
export function cmdInitHook(opts: { print?: boolean }, { cfg }: Ctx): void {
  const res = initHook({ print: opts.print });
  const c = painterFor(cfg);
  if (res.action === 'printed') {
    out(res.message);
    return;
  }
  const mark =
    res.action === 'written' ? c.green('✓') : res.action === 'already' ? c.cyan('•') : c.yellow('!');
  out(`${mark} ${res.message}`);
}

/** `claudinho match <id>` */
export async function cmdMatch(id: string, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const adapter = adapterFor(ctx);
  let match = allFixtures().find((m) => m.id === id);
  try {
    if (match) {
      const live = await adapter.fetchByDate(match.kickoff.slice(0, 10));
      match = live.find((m) => m.id === id) ?? match;
    }
  } catch {
    /* keep static */
  }

  const marketSignal = match ? await reliableMarketSignalFor(ctx, match) : undefined;

  if (cfg.json) {
    emitJson({ match: match ?? null, marketSignal: marketSignal ?? null });
    return;
  }

  const c = painterFor(cfg);
  out();
  if (!match) {
    out(c.dim('  ' + t('match.none', { id })));
    out();
    out(disclaimer(t, c));
    return;
  }
  const stageLabel = match.group ? `${match.stage} ${match.group}` : match.stage;
  out(header(`${match.home.name} ${scoreline(match)} ${match.away.name}`, c));
  out('  ' + c.dim(`${stageLabel} · ${matchLocation(match)}`));
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
  if (marketSignal) {
    out();
    for (const mline of marketBlock(marketSignal, match)) out('  ' + c.dim(mline));
  }
  out();
  out(disclaimer(t, c));
}

// Market copy is English-only in v1 (the approved legal copy bank); the base
// FIFA/Anthropic disclaimer stays localized via t('disclaimer').
const MARKET_INFO = 'Prediction-market data is informational only.';

/** Show a signal only if it maps cleanly and has a determinable favorite. */
function marketDisplayable(sig: MarketSignal): boolean {
  return !sig.ambiguous && sig.favorite != null && hasSaneDistribution(sig.outcomes);
}

function marketHeaderLine(m: Match): string {
  return `${m.home.flag} ${m.home.name} vs ${m.away.name} ${m.away.flag}`;
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

  // markets next <team>
  if (target === 'next') {
    precheck(cfg, t);
    if (!team) throw new InputError('Usage: claudinho markets next <team>');
    const code = team.toUpperCase();
    const fixture = nextFixtureForTeam(code);
    const sig = fixture
      ? (await marketSignalsFor(ctx, [fixture], MARKETS_CMD_OPTS)).get(fixture.id)
      : undefined;
    const shown = sig && marketDisplayable(sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({
        team: code,
        matchId: fixture?.id ?? null,
        informationalOnly: true,
        signal: shown ?? null,
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    if (!fixture) {
      out(c.dim('  ' + t('next.none', { team: code })));
    } else {
      out(header(marketHeaderLine(fixture), c));
      out();
      if (shown) printMarketBlock(fixture, shown, c);
      else out(c.dim('    No market signal for this match.'));
    }
    out();
    out(disclaimer(t, c));
    out(c.dim(MARKET_INFO));
    return;
  }

  // markets <id>  (anything that isn't a date or the "today" keyword)
  if (target && target !== 'today' && !isValidDate(target)) {
    precheck(cfg, t);
    const match = allFixtures().find((m) => m.id === target);
    const sig = match
      ? (await marketSignalsFor(ctx, [match], MARKETS_CMD_OPTS)).get(match.id)
      : undefined;
    const shown = sig && marketDisplayable(sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({ matchId: target, informationalOnly: true, signal: shown ?? null });
      return;
    }
    const c = painterFor(cfg);
    out();
    if (!match) {
      out(c.dim('  ' + t('match.none', { id: target })));
    } else {
      out(header(marketHeaderLine(match), c));
      out();
      if (shown) printMarketBlock(match, shown, c);
      else out(c.dim('    No market signal for this match.'));
    }
    out();
    out(disclaimer(t, c));
    out(c.dim(MARKET_INFO));
    return;
  }

  // markets [today | <date>]
  const explicitDate = target && target !== 'today' ? target : undefined;
  precheck(cfg, t, explicitDate);
  const date = explicitDate ?? localDate(new Date().toISOString(), cfg.tz);
  const { matches } = await getMatchesForDate(adapterFor(ctx), date);
  const todays = fixturesByDate(date, matches, cfg.tz);
  const signals = await marketSignalsFor(ctx, todays, MARKETS_CMD_OPTS);
  const rows = todays
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.signal),
    );

  if (cfg.json) {
    const marketSignals: Record<string, MarketSignal> = {};
    for (const r of rows) marketSignals[r.match.id] = r.signal;
    emitJson({ date, informationalOnly: true, marketSignals });
    return;
  }

  const c = painterFor(cfg);
  out();
  out(header(`Market signals · ${date}`, c));
  out();
  if (rows.length === 0) {
    out(c.dim(`  No market signals available for ${date}.`));
  } else {
    for (const { match, signal } of rows) {
      out('  ' + c.bold(marketHeaderLine(match)));
      printMarketBlock(match, signal, c);
      out();
    }
  }
  out(disclaimer(t, c));
  out(c.dim(MARKET_INFO));
}

/**
 * `vibe` — a tiny, offline easter egg. Prints a random matchday-coder one-liner
 * signed with the project's social tag. No network, no cache, no i18n: the
 * Spanglish is the joke. #VibingLaVidaLoca
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

export function cmdVibe(ctx: Ctx): void {
  const { cfg } = ctx;
  const line = VIBES[Math.floor(Math.random() * VIBES.length)];
  if (cfg.json) {
    emitJson({ vibe: line, tag: '#VibingLaVidaLoca' });
    return;
  }
  const c = painterFor(cfg);
  out();
  out('  ⚽ ' + c.bold(line));
  out('  ' + c.cyan('#VibingLaVidaLoca'));
  out();
}
