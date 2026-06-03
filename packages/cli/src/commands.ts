import {
  allFixtures,
  computeStandings,
  countdown,
  fixturesByDate,
  fixturesByGroup,
  formatKickoff,
  groups,
  isValidDate,
  isValidTimeZone,
  localDate,
  nextFixtureForTeam,
  scoreline,
  type Match,
} from '@claudinho/core';
import Table from 'cli-table3';
import type { CliConfig } from './config';
import type { Translator } from './i18n';
import {
  disclaimer,
  header,
  matchLine,
  painterFor,
  statusToken,
} from './format';
import {
  getLiveMatches,
  getMatchesForDate,
  makeAdapter,
  mergeLive,
} from './data';
import type { ProviderAdapter } from '@claudinho/core';
import { readState } from './cache';
import { renderPrompt } from './statusline';
import { hookContext } from './hook';
import { runRefresh, shouldRefresh, spawnRefresh } from './refresh';
import { initHook, initStatusline } from './install';

/**
 * Command context. `adapter` is an optional injection seam: production leaves
 * it unset (commands build one from `cfg.source`), tests pass a fake so they
 * never touch the network.
 */
type Ctx = { cfg: CliConfig; t: Translator; adapter?: ProviderAdapter };

/** The injected adapter, or one constructed from the configured source. */
function adapterFor({ cfg, adapter }: Ctx): ProviderAdapter {
  return adapter ?? makeAdapter(cfg.source);
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
  const todays = fixturesByDate(targetDate, matches);

  if (cfg.json) {
    emitJson({ date: targetDate, degraded, matches: todays });
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
    for (const m of todays) out(matchLine(m, cfg, t, c));
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
  // Overlay results so finished games count toward the live table.
  let matches: Match[] = allFixtures();
  try {
    const live = await adapter.fetchByDate(localDate(new Date().toISOString(), cfg.tz));
    matches = mergeLive(matches, live);
  } catch {
    /* fall back to static schedule */
  }

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
    const state = readState();
    out(renderPrompt(state, { team, compact }));
    if (shouldRefresh()) spawnRefresh(cfg.source);
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
    const ctx = hookContext({ team });
    if (ctx) out(ctx);
    if (shouldRefresh()) spawnRefresh(cfg.source);
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

  if (cfg.json) {
    emitJson({ match: match ?? null });
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
  out('  ' + c.dim(`${stageLabel} · ${match.venue}`));
  out(
    '  ' +
      c.dim(
        `${formatKickoff(match.kickoff, { tz: cfg.tz, locale: cfg.lang })}  ${statusToken(match, t, c)}`.trimEnd(),
      ),
  );
  if (match.events?.length) {
    out();
    for (const e of match.events) {
      out(`  ${e.minute}'  ${e.type}  ${e.teamCode}${e.player ? ` — ${e.player}` : ''}`);
    }
  }
  out();
  out(disclaimer(t, c));
}
