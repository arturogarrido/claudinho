import {
  allFixtures,
  countdown,
  DEFAULT_COMPETITION,
  fixturesByDate,
  formatDate,
  formatKickoff,
  formatShareSnippet,
  formatShareTable,
  formatShareBracket,
  formatBracketList,
  formatBracketTree,
  getMarketSignals,
  getMatchById,
  hasSaneDistribution,
  isFinished,
  isReliableMarketSignal,
  isValidDate,
  isValidTimeZone,
  localDate,
  makeMarketProvider,
  marketBlock,
  marketFixtureForTeam,
  marketLine,
  marketSignalRendersFor,
  marketRelevant,
  matchFlavor,
  matchLocation,
  resolveCompetition,
  resolveMarketSource,
  scoreline,
  stageLabel,
  t as i18n,
  stageLabelI18n,
  type Stage,
} from '@claudinho/core';
import Table from 'cli-table3';
import type { CliConfig } from './config';
import type { Translator } from './i18n';
import {
  dataSource,
  disclaimer,
  header,
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
  makeAdapter,
} from './data';
import { readMarketCache, writeMarketCache } from './marketCache';
import { copyToClipboard } from './clipboard';
import type {
  GroupStandings,
  Match,
  MarketProvider,
  MarketSignal,
  ProviderAdapter,
  ShareSnippetInput,
  ShareSnippetOptions,
  ShareBracketOptions,
  ShareStyle,
} from '@claudinho/core';
import { readCurrentState } from './cache';
import { flagsEnabled, liveMatchesFromCache, renderPrompt } from './statusline';
import { renderHook } from './hook';
import { runRefresh, shouldRefresh, shouldRefreshFixtures, spawnRefresh } from './refresh';
import { readCursorPayload, renderPromptOutput } from './cursorPayload';
import { type InitResult, initCursorStatusline, initHook, initStatusline } from './install';

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
  if (ctx.marketProvider) return (await getMarketSignals(ctx.marketProvider, matches, opts)).signals;
  const source = resolveMarketSource();
  // Dev/demo/no-op providers ('fake'/'none') are free — skip the on-disk cache.
  if (source !== 'polymarket') {
    return (await getMarketSignals(makeMarketProvider(source), matches, opts)).signals;
  }
  const competition = resolveCompetition();
  const { signals: cached, checked: cachedIds } = readMarketCache('polymarket', competition);
  const result = new Map<string, MarketSignal>();
  const miss: Match[] = [];
  for (const m of matches) {
    const hit = cached.get(m.id);
    if (hit) result.set(m.id, hit);
    else if (!cachedIds.has(m.id)) miss.push(m); // negative-cached → skip re-fetch
  }
  if (miss.length > 0) {
    const { signals: fetched, checked } = await getMarketSignals(
      makeMarketProvider('polymarket'),
      miss,
      opts,
    );
    // Negative-cache only DEFINITIVELY-checked ids; errored/deadline-skipped
    // matches are omitted so a transient failure doesn't suppress a real signal.
    writeMarketCache('polymarket', competition, [...checked], fetched);
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
  const now = ctx.now ?? new Date();
  // Market reads are pre-match/in-play artifacts: never fetch (or show) them
  // for finished matches — "markets favor X" after full time reads as a bug.
  const relevant = matches.filter((m) => marketRelevant(m, now));
  if (relevant.length === 0) return new Map();
  const raw = await marketSignalsFor(ctx, relevant, DEFAULT_ON_MARKET_OPTS);
  const out = new Map<string, MarketSignal>();
  for (const [id, s] of raw) {
    const m = relevant.find((x) => x.id === id);
    // Re-check against the fixture being shown: a cached signal must not render
    // against a degraded placeholder that inherited its id (fail closed).
    if (m && isReliableMarketSignal(s, { now }) && marketSignalRendersFor(m, s)) out.set(id, s);
  }
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
  // Config-drift guard: a leftover CLAUDINHO_COMPETITION (e.g. from
  // pre-tournament testing) silently points the live fetch at a different
  // competition than the bundled schedule — fixtures render, scores never
  // arrive. Warn loudly on user-facing commands; never on the statusline/hook
  // hot path (those must stay single-line and silent).
  const competition = resolveCompetition();
  if (competition !== DEFAULT_COMPETITION) {
    process.stderr.write(
      `claudinho: CLAUDINHO_COMPETITION=${competition} — live data follows a different competition than the bundled 2026 schedule.\n`,
    );
  }
  if (date !== undefined && !isValidDate(date)) {
    throw new InputError(t('err.date', { date }));
  }
}

/**
 * Resolve an optional team argument, falling back to CLAUDINHO_TEAM — the same
 * env the statusline/hook already honor, so "my team" is configured once.
 */
function resolveTeamArg(team: string | undefined, usage: string): string {
  const code = team ?? process.env.CLAUDINHO_TEAM;
  if (!code) throw new InputError(usage);
  return code.toUpperCase();
}

/** `claudinho today [date]` */
export async function cmdToday(date: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t, date);
  const adapter = adapterFor(ctx);
  const targetDate = date ?? localDate(new Date().toISOString(), cfg.tz);
  const { matches, degraded, source } = await getMatchesForDate(adapter, targetDate);
  const todays = fixturesByDate(targetDate, matches, cfg.tz);
  const signals = await reliableMarketSignals(ctx, todays);

  if (cfg.json) {
    emitJson({
      date: targetDate,
      degraded,
      source: source ?? null,
      matches: todays,
      marketSignals: Object.fromEntries(signals),
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
    out(c.dim('  ' + t('today.none')));
  } else {
    for (const m of todays) {
      out(matchLine(m, cfg, t, c, flags));
      const s = signals.get(m.id);
      if (s) out('    ' + c.dim(marketLine(s, m)));
    }
  }
  out();
  // Live overlay failed → these are static fixtures with no live scores. Say so.
  if (degraded) out(c.dim('  ' + t('feed.degraded')));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
}

/** `claudinho live` */
export async function cmdLive(ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  const adapter = adapterFor(ctx);
  const { matches, degraded, source } = await getLiveMatches(adapter);

  if (cfg.json) {
    emitJson({ degraded, source: source ?? null, matches });
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
    out(c.dim('  ' + t('live.none')));
  } else {
    for (const m of matches) out(matchLine(m, cfg, t, c, flags));
  }
  out();
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
}

/** `claudinho next [team]` (team defaults to CLAUDINHO_TEAM) */
export async function cmdNext(team: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t, now } = ctx;
  precheck(cfg, t);
  const code = resolveTeamArg(team, 'Usage: claudinho next <team> (or set CLAUDINHO_TEAM)');
  // Live-resolved: the bundled knockout slots are resultless placeholders, so a
  // static lookup goes blind once a team's group games pass — overlay the live
  // knockout window so a confirmed R32+ tie (e.g. MEX vs ECU) surfaces here too.
  const { fixture, degraded, source } = await getNextFixtureForTeam(
    adapterFor(ctx),
    code,
    now ?? new Date(),
  );

  if (cfg.json) {
    emitJson({ team: code, fixture: fixture ?? null, degraded, source: source ?? null });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  out();
  if (!fixture) {
    // Fail-closed honesty: a feed outage must read as "couldn't reach the
    // provider", never as "this team has no upcoming fixture" (= eliminated).
    out(c.dim('  ' + (degraded ? t('live.degraded') : t('next.none', { team: code }))));
    out();
    out(disclaimer(t, c));
    return;
  }
  out(header(t('next.label', { team: code }), c));
  out();
  out(matchLine(fixture, cfg, t, c, flags));
  const stage = fixture.stage !== 'GROUP' ? `${stageLabel(fixture)} · ` : '';
  out(
    '  ' +
      c.dim(
        `${stage}${formatKickoff(fixture.kickoff, { tz: cfg.tz, locale: cfg.lang })} · ` +
          t('next.in', { countdown: countdown(fixture.kickoff) }),
      ),
  );
  out();
  // Attribute the provider when the live overlay resolved the fixture (a
  // knockout tie); a static group fixture carries no source.
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
}

/** `claudinho table [group]` */
export async function cmdTable(group: string | undefined, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  // Authoritative, cumulative standings from the provider. Fails closed to a
  // roster-at-zero (degraded) rather than a wrong table computed from a single
  // day's window — see core getStandings.
  const { tables, degraded, source } = await getStandings(adapterFor(ctx), group);

  if (cfg.json) {
    // Preserve the prior JSON shape: { group, standings: StandingRow[] } per table.
    const json = tables.map((tb) => ({ group: tb.group, standings: tb.rows }));
    emitJson({
      degraded,
      source: source ?? null,
      tables: group ? (json[0] ?? null) : json,
    });
    return;
  }

  const c = painterFor(cfg);
  const flags = flagsEnabled();
  if (tables.length === 0) {
    out();
    // A specific group that isn't there → "no group X"; no group asked (e.g. the
    // group stage is over and only knockout brackets remain) → "no standings".
    out(
      c.dim(
        '  ' + (group ? t('table.none', { group: group.toUpperCase() }) : t('table.empty')),
      ),
    );
    out();
    if (degraded) out(c.dim('  ' + t('table.degraded')));
    out(disclaimer(t, c));
    return;
  }
  for (const { group: g, rows } of tables) {
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
  }
  out();
  // Degraded ⇒ rows are a static roster, not real results — say so, don't imply zeros are live.
  if (degraded) out(c.dim('  ' + t('table.degraded')));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
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
  const { view, degraded, standingsDegraded, source } = await getBracket(
    adapterFor(ctx),
    filter ? { stage: filter as Stage, lang: cfg.lang } : { lang: cfg.lang },
  );

  if (cfg.json) {
    emitJson({
      degraded,
      standingsDegraded,
      source: source ?? null,
      view,
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
      ? i18n(cfg.lang, 'bracket.stageTitle', { stage: stageLabelI18n(cfg.lang, filter) })
      : i18n(cfg.lang, 'bracket.title'),
    c,
  ));
  out(body);
  out();
  if (degraded) out(c.dim(`  ${i18n(cfg.lang, 'bracket.degraded')}`));
  else if (standingsDegraded) out(c.dim(`  ${i18n(cfg.lang, 'bracket.standingsDegraded')}`));
  const src = dataSource(source, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
}

/**
 * `claudinho prompt` — the HOT PATH. Reads the cache, prints one line, and (if
 * warranted) fires a detached refresher. Synchronous, no network, never throws.
 */
export function cmdPrompt({ cfg }: Ctx): void {
  try {
    // Always drain stdin so Cursor's statusline pipe never blocks (meta optional).
    const payload = readCursorPayload();
    const team = process.env.CLAUDINHO_TEAM;
    const compact = !['0', 'false', 'no'].includes(
      (process.env.CLAUDINHO_COMPACT ?? '').toLowerCase(),
    );
    const maxRaw = Number.parseInt(process.env.CLAUDINHO_MAX ?? '', 10);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;
    // Only trust a snapshot fetched for the current source + competition.
    const state = readCurrentState(cfg.source, resolveCompetition());
    const scoreLine = renderPrompt(state, { team, compact, max, flags: flagsEnabled() });
    out(renderPromptOutput(scoreLine, payload));
    // Spawn a background refresh for live scores OR stale knockout fixtures (the
    // latter keeps the next-match countdown live outside live windows). Pass the
    // already-read state so the fixtures check adds no extra cache read.
    if (!state || shouldRefresh() || shouldRefreshFixtures(Date.now(), state)) {
      spawnRefresh(cfg.source);
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
    const team = process.env.CLAUDINHO_TEAM;
    // Only trust a snapshot fetched for the current source + competition.
    const state = readCurrentState(cfg.source, resolveCompetition());
    const ctx = renderHook(state, { team, flags: flagsEnabled() });
    if (ctx) out(ctx);
    // Warm the same cache the statusline reads, for parity (the hook itself shows
    // only live scores). Spawn for live OR stale knockout fixtures.
    if (!state || shouldRefresh() || shouldRefreshFixtures(Date.now(), state)) {
      spawnRefresh(cfg.source);
    }
  } catch {
    // Never block the prompt — emit nothing on any error.
  }
}

/** `claudinho _refresh` — internal cold-path cache refresher. */
export async function cmdRefresh({ cfg }: Ctx): Promise<void> {
  await runRefresh({ source: cfg.source });
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
  printInitResult(initStatusline({ print: opts.print, command: opts.command }), cfg);
}

/** `claudinho init-hook` — wire the live-score UserPromptSubmit hook. */
export function cmdInitHook(opts: { print?: boolean; command?: string }, { cfg }: Ctx): void {
  printInitResult(initHook({ print: opts.print, command: opts.command }), cfg);
}

/** `claudinho init-cursor-statusline` — patch ~/.cursor/cli-config.json. */
export function cmdInitCursorStatusline(
  opts: { print?: boolean; command?: string },
  { cfg }: Ctx,
): void {
  printInitResult(initCursorStatusline({ print: opts.print, command: opts.command }), cfg);
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
  printInitResult(initCursorStatusline(), cfg);
  out('');
  out('Optional — live MCP tools in Cursor: add to ~/.cursor/mcp.json (or project .cursor/mcp.json):');
  out(CURSOR_MCP_SNIPPET);
  out('');
  out('Tip: export CLAUDINHO_CURSOR_META=auto for a model + context line below the score.');
  out('');
  out('→ Restart your agent session to see it.');
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
  printInitResult(initStatusline(), cfg);
  printInitResult(initHook(), cfg);
  out('');
  out('Next — add the MCP server:');
  out(`  ${CLAUDE_MCP_ONELINER}`);
  out('');
  out('→ Restart Claude Code to see it.');
}

/** `claudinho match <id>` */
export async function cmdMatch(id: string, ctx: Ctx): Promise<void> {
  const { cfg, t } = ctx;
  precheck(cfg, t);
  // ±1-day window fetch: the provider buckets scoreboard days in its own zone,
  // so fetching only the fixture's UTC date can miss its live/final state.
  const { match, degraded, source: liveSource } = await getMatchById(adapterFor(ctx), id);

  const marketSignal = match ? await reliableMarketSignalFor(ctx, match) : undefined;

  if (cfg.json) {
    emitJson({
      degraded,
      match: match ?? null,
      source: liveSource ?? null,
      marketSignal: marketSignal ?? null,
    });
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
  const stageLabelText = stageLabel(match);
  out(header(`${match.home.name} ${scoreline(match)} ${match.away.name}`, c));
  out('  ' + c.dim(`${stageLabelText} · ${matchLocation(match)}`));
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
  // Live overlay failed → this is the static fixture with no live state. Say so.
  if (degraded) out(c.dim('  ' + t('feed.degraded')));
  const src = dataSource(liveSource, cfg.lang, c);
  if (src) out(src);
  out(disclaimer(t, c));
}

// Market copy is English-only in v1 (the approved legal copy bank); the base
// FIFA/Anthropic disclaimer stays localized via t('disclaimer').
const MARKET_INFO = 'Prediction-market data is informational only.';

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
 * Header for a market read. Includes the kickoff date — "South Korea (Jun 18)"
 * and "South Africa (today)" are one skim apart, and a dated header is what
 * stops a reader (or an agent) conflating a future fixture's read with the
 * match being played right now.
 */
function marketHeaderLine(m: Match, cfg: CliConfig): string {
  const when = formatDate(m.kickoff, { tz: cfg.tz, locale: cfg.lang });
  return `${m.home.flag} ${m.home.name} vs ${m.away.name} ${m.away.flag} · ${when}`;
}

/** Null-signal line, specific about finished matches (market reads are pre-match). */
function noSignalLine(m: Match, now: Date): string {
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
    const code = resolveTeamArg(team, 'Usage: claudinho markets next <team> (or set CLAUDINHO_TEAM)');
    const now = ctx.now ?? new Date();
    // Live-confirmed selection: handles extra time past the static window AND
    // early FTs inside it (the static fixture's status is forever SCHEDULED).
    const { match: fixture, degraded } = await marketFixtureForTeam(adapterFor(ctx), code, now);
    const sig =
      fixture && marketRelevant(fixture, now)
        ? (await marketSignalsFor(ctx, [fixture], MARKETS_CMD_OPTS)).get(fixture.id)
        : undefined;
    const shown = fixture && sig && marketDisplayable(fixture, sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({
        team: code,
        matchId: fixture?.id ?? null,
        degraded,
        informationalOnly: true,
        signal: shown ?? null,
      });
      return;
    }
    const c = painterFor(cfg);
    out();
    if (!fixture) {
      // Feed unavailable can't resolve a knockout tie — say so, vs "no fixture".
      out(c.dim('  ' + (degraded ? t('live.degraded') : t('next.none', { team: code }))));
    } else {
      out(header(marketHeaderLine(fixture, cfg), c));
      out();
      if (shown) printMarketBlock(fixture, shown, c);
      else out(c.dim('    ' + noSignalLine(fixture, now)));
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
    // Live overlay (±1-day window) so FT gates the resolved market correctly.
    const { match } = await getMatchById(adapterFor(ctx), target);
    const sig =
      match && marketRelevant(match, now)
        ? (await marketSignalsFor(ctx, [match], MARKETS_CMD_OPTS)).get(match.id)
        : undefined;
    const shown = match && sig && marketDisplayable(match, sig) ? sig : undefined;
    if (cfg.json) {
      emitJson({ matchId: target, informationalOnly: true, signal: shown ?? null });
      return;
    }
    const c = painterFor(cfg);
    out();
    if (!match) {
      out(c.dim('  ' + t('match.none', { id: target })));
    } else {
      out(header(marketHeaderLine(match, cfg), c));
      out();
      if (shown) printMarketBlock(match, shown, c);
      else out(c.dim('    ' + noSignalLine(match, now)));
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
  const { matches } = await getMatchesForDate(adapterFor(ctx), date);
  const todays = fixturesByDate(date, matches, cfg.tz);
  const relevant = todays.filter((m) => marketRelevant(m, now));
  const signals = await marketSignalsFor(ctx, relevant, MARKETS_CMD_OPTS);
  const rows = relevant
    .map((m) => ({ match: m, signal: signals.get(m.id) }))
    .filter(
      (r): r is { match: Match; signal: MarketSignal } =>
        !!r.signal && marketDisplayable(r.match, r.signal),
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
      out('  ' + c.bold(marketHeaderLine(match, cfg)));
      printMarketBlock(match, signal, c);
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
): Promise<Map<string, MarketSignal>> {
  const raw = await reliableMarketSignals(ctx, matches);
  const out = new Map<string, MarketSignal>();
  for (const [id, s] of raw) {
    const m = matches.find((x) => x.id === id);
    if (m && marketDisplayable(m, s)) out.set(id, s);
  }
  return out;
}

type ShareEmit = {
  kind: 'today' | 'live' | 'next' | 'match';
  target: string;
  team?: string;
  input: ShareSnippetInput;
  options: ShareSnippetOptions;
};

/** Render + emit a snippet (text or JSON), then best-effort copy to clipboard. */
function emitShare(ctx: Ctx, e: ShareEmit, copy: boolean): void {
  const snippet = formatShareSnippet(e.input, e.options);
  if (ctx.cfg.json) {
    emitJson({
      kind: e.kind,
      target: e.target,
      ...(e.team ? { team: e.team } : {}),
      source: e.input.source ?? null,
      degraded: e.input.degraded ?? false,
      informationalOnly: true,
      style: e.options.style ?? 'social',
      snippet,
      matches: e.input.matches,
      marketSignals: Object.fromEntries(e.input.marketSignals ?? new Map()),
    });
  } else {
    out(snippet);
  }
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

interface ShareTableEmit {
  group?: string;
  tables: GroupStandings[];
  source?: string;
  degraded: boolean;
  installLine: string;
  emptyNote: string;
  options: ShareSnippetOptions;
}

function emitShareTable(ctx: Ctx, e: ShareTableEmit, copy: boolean): void {
  const snippet = formatShareTable(
    {
      tables: e.tables,
      source: e.source,
      installLine: e.installLine,
      emptyNote: e.emptyNote,
      degraded: e.degraded,
    },
    e.options,
  );
  if (ctx.cfg.json) {
    emitJson({
      kind: 'table',
      target: 'table',
      ...(e.group ? { group: e.group } : {}),
      source: e.source ?? null,
      degraded: e.degraded,
      informationalOnly: true,
      snippet,
      tables: e.tables.map((tb) => ({ group: tb.group, standings: tb.rows })),
    });
  } else {
    out(snippet);
  }
  if (copy) {
    const ok = (ctx.copy ?? copyToClipboard)(snippet);
    process.stderr.write(
      (ok
        ? 'Copied share snippet to clipboard.'
        : 'Clipboard unavailable; printed snippet instead.') + '\n',
    );
  }
}

interface ShareBracketEmit {
  stage?: string;
  view: import('@claudinho/core').BracketView;
  source?: string;
  degraded: boolean;
  installLine: string;
  emptyNote: string;
  options: ShareBracketOptions;
}

/** Emit a `share bracket` snippet. */
function emitShareBracket(ctx: Ctx, e: ShareBracketEmit, copy: boolean): void {
  const snippet = formatShareBracket(
    {
      view: e.view,
      source: e.source,
      installLine: e.installLine,
      emptyNote: e.emptyNote,
    },
    e.options,
  );
  if (ctx.cfg.json) {
    emitJson({
      kind: 'bracket',
      target: 'bracket',
      ...(e.stage ? { stage: e.stage } : {}),
      source: e.source ?? null,
      degraded: e.degraded,
      informationalOnly: true,
      snippet,
      view: e.view,
    });
  } else {
    out(snippet);
  }
  if (copy) {
    const ok = (ctx.copy ?? copyToClipboard)(snippet);
    process.stderr.write(
      (ok
        ? 'Copied share snippet to clipboard.'
        : 'Clipboard unavailable; printed snippet instead.') + '\n',
    );
  }
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

  // share live
  if (target === 'live') {
    precheck(cfg, t);
    const { matches, degraded, source } = await getLiveMatches(adapterFor(ctx));
    emitShare(
      ctx,
      {
        kind: 'live',
        target: 'live',
        input: {
          title: 'Live match pulse',
          matches,
          source,
          degraded,
          // Degraded ⇒ feed down, not "nothing's on" — say so on the public card.
          emptyNote: degraded
            ? "Live scores unavailable right now — couldn't reach the data provider."
            : 'No matches in play right now.',
          installLine: 'npx @claudinho/cli live',
          tz: cfg.tz,
          locale: cfg.lang,
        },
        // Live snippets stay lean: no market enrichment (and no extra fetch).
        options: { ...baseOptions, includeMarkets: false },
      },
      copy,
    );
    return;
  }

  // share table [group] — a standings card (facts only; no market lines)
  if (target === 'table') {
    precheck(cfg, t);
    const group = team?.toUpperCase();
    const { tables, degraded, source } = await getStandings(adapterFor(ctx), group);
    emitShareTable(
      ctx,
      {
        group,
        tables,
        // Degraded ⇒ a static roster, served by no live provider: no attribution.
        source: degraded ? undefined : source,
        degraded,
        installLine: group ? `npx @claudinho/cli table ${group}` : 'npx @claudinho/cli table',
        emptyNote: group ? `No group ${group}.` : 'No standings available.',
        options: baseOptions,
      },
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
    const { view, degraded, source } = await getBracket(
      adapterFor(ctx),
      stageFilter
        ? { stage: stageFilter as Stage, lang: cfg.lang }
        : { lang: cfg.lang },
    );
    emitShareBracket(
      ctx,
      {
        stage: stageFilter,
        view,
        source: degraded ? undefined : source,
        degraded,
        installLine: stageFilter
          ? `npx @claudinho/cli bracket ${stageFilter}`
          : 'npx @claudinho/cli bracket',
        emptyNote: i18n(cfg.lang, 'bracket.empty'),
        options: {
          includeHashtag: baseOptions.includeHashtag,
          includeInstallLine: baseOptions.includeInstallLine,
          locale: cfg.lang,
          style: baseOptions.style,
          tz: cfg.tz,
        },
      },
      copy,
    );
    return;
  }

  // share next <team>
  if (target === 'next') {
    precheck(cfg, t);
    const code = resolveTeamArg(team, 'Usage: claudinho share next <team> (or set CLAUDINHO_TEAM)');
    // Live-resolved (see cmdNext): overlay the knockout window so a confirmed
    // R32+ tie pastes here too, not just group games.
    const { fixture, degraded, source } = await getNextFixtureForTeam(
      adapterFor(ctx),
      code,
      ctx.now ?? new Date(),
    );
    const matches = fixture ? [fixture] : [];
    const signals = await reliableShareSignals(ctx, matches);
    const teamName = fixture
      ? fixture.home.code === code
        ? fixture.home.name
        : fixture.away.name
      : code;
    emitShare(
      ctx,
      {
        kind: 'next',
        target: 'next',
        team: code,
        input: {
          title: `Next up for ${teamName}`,
          matches,
          marketSignals: signals,
          // Attribute the provider when the overlay resolved the tie (knockout);
          // undefined for a static group fixture — parity with CLI `next`.
          source,
          degraded,
          // Fail-closed: an outage must never paste as "no fixture" (eliminated).
          emptyNote: degraded
            ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${code}.`
            : `No upcoming fixture found for ${code}.`,
          installLine: `npx @claudinho/cli next ${code}`,
          tz: cfg.tz,
          locale: cfg.lang,
        },
        options: baseOptions,
      },
      copy,
    );
    return;
  }

  // share <id>  (anything that isn't a date or the "today" keyword)
  if (target && target !== 'today' && !isValidDate(target)) {
    precheck(cfg, t);
    // ±1-day window fetch (see cmdMatch): the provider's scoreboard day can
    // differ from the fixture's UTC date.
    const { match, degraded, source } = await getMatchById(adapterFor(ctx), target);
    const matches = match ? [match] : [];
    const signals = await reliableShareSignals(ctx, matches);
    emitShare(
      ctx,
      {
        kind: 'match',
        target,
        input: {
          title: 'Match pulse',
          matches,
          marketSignals: signals,
          source,
          degraded,
          emptyNote: `No match found with id ${target}.`,
          installLine: `npx @claudinho/cli match ${target}`,
          tz: cfg.tz,
          locale: cfg.lang,
        },
        options: baseOptions,
      },
      copy,
    );
    return;
  }

  // share [today | <date>]
  const explicitDate = target && target !== 'today' ? target : undefined;
  precheck(cfg, t, explicitDate);
  const date = explicitDate ?? localDate(new Date().toISOString(), cfg.tz);
  const { matches: all, degraded, source } = await getMatchesForDate(adapterFor(ctx), date);
  const todays = fixturesByDate(date, all, cfg.tz);
  const signals = await reliableShareSignals(ctx, todays);
  // Human date label from a stable midday-UTC instant (avoids tz day flips).
  const human = formatDate(`${date}T12:00:00.000Z`, { tz: cfg.tz, locale: cfg.lang });
  const title = explicitDate ? `Matches · ${human}` : `Today's matches · ${human}`;
  emitShare(
    ctx,
    {
      kind: 'today',
      target: date,
      input: {
        title,
        matches: todays,
        marketSignals: signals,
        source,
        degraded,
        emptyNote: `No matches scheduled for ${human}.`,
        installLine: 'npx @claudinho/cli today',
        tz: cfg.tz,
        locale: cfg.lang,
      },
      options: baseOptions,
    },
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
 * The live-score segment for a vibe line, e.g. "🇰🇷 1–1 🇨🇿 69'". Prefers the
 * CLAUDINHO_TEAM match, else the first live match; undefined when nothing is
 * live. Pure — exported for tests.
 */
export function vibeLiveSegment(live: Match[], team?: string): string | undefined {
  const code = team?.toUpperCase();
  const pick =
    (code && live.find((m) => m.home.code === code || m.away.code === code)) ?? live[0];
  if (!pick) return undefined;
  const minute = pick.status === 'HT' ? 'HT' : pick.minute ? `${pick.minute}'` : 'LIVE';
  return `${pick.home.flag} ${scoreline(pick)} ${pick.away.flag} ${minute}`;
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

export function cmdVibe(ctx: Ctx): void {
  const { cfg } = ctx;
  const pool = vibePool(localDate((ctx.now ?? new Date()).toISOString(), cfg.tz));
  const line = pool[Math.floor(Math.random() * pool.length)];
  let liveSeg: string | undefined;
  try {
    const state = readCurrentState(cfg.source, resolveCompetition());
    liveSeg = vibeLiveSegment(
      liveMatchesFromCache(state, (ctx.now ?? new Date()).getTime()),
      process.env.CLAUDINHO_TEAM,
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
