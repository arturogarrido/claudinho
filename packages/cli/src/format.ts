import pc from 'picocolors';
import {
  displayWidth,
  formatKickoff,
  isLive,
  liveSourceLabel,
  matchFlair,
  padVisible,
  scoreline,
  t as i18n,
  teamKind,
  withFlag,
  type Flair,
  type FlairOpts,
  type Match,
} from '@claudinho/core';
import type { CliConfig } from './config';
import type { Translator } from './i18n';

/** picocolors honors its own isColorSupported, but we also gate on config. */
function paint(enabled: boolean) {
  const id = <T,>(s: T) => s as unknown as string;
  if (!enabled) {
    return {
      dim: id,
      bold: id,
      green: id,
      yellow: id,
      red: id,
      cyan: id,
      gray: id,
    };
  }
  return {
    dim: pc.dim,
    bold: pc.bold,
    green: pc.green,
    yellow: pc.yellow,
    red: pc.red,
    cyan: pc.cyan,
    gray: pc.gray,
  };
}

export type Painter = ReturnType<typeof paint>;

/** Team cell for standings tables: the flag beside the name when there is one, the name alone otherwise. */
export function tableTeamCell(team: { flag?: string; name: string }, flags: boolean): string {
  return flags ? withFlag(team.name, team.flag, 'home') : team.name;
}

export function painterFor(cfg: CliConfig): Painter {
  return paint(cfg.color);
}

/** A short status token, colored and localized. */
export function statusToken(m: Match, t: Translator, c: Painter): string {
  switch (m.status) {
    case 'LIVE':
      return c.green(`${m.minute ? `${m.minute}'` : t('status.live')}`);
    case 'HT':
      return c.yellow(t('status.ht'));
    case 'FT':
      return c.gray(t('status.ft'));
    case 'POSTPONED':
      return c.red(t('status.postponed'));
    case 'CANCELLED':
      return c.red(t('status.cancelled'));
    default:
      return '';
  }
}

/** The home column's width when every shown home cell fits it (and its floor). */
export const HOME_COLUMN = 22;
/** The widest the home column grows to fit a list's widest cell; a wider cell pushes its own row. */
export const HOME_COLUMN_MAX = 32;

/**
 * A match's home CELL, exactly as `matchLine` prints it: the flag, its space
 * and the name when a flag prints (flags on, and the side has one), the name
 * alone otherwise (flags off, or a club, which has no flag).
 */
export function homeCell(m: Match, flags: boolean): string {
  return flags ? withFlag(m.home.name, m.home.flag, 'home') : m.home.name;
}

/**
 * The width a list pads its home cells to, measured ONCE over the rows it
 * shows: `max(22, min(32, the widest cell))` display columns. A list whose
 * widest cell fits 22 columns is laid out as it always was; a wider cell
 * widens every row to it, so the `vs` stays in one column; a cell past 32
 * columns pushes its own row only.
 */
export function homeColumn(matches: readonly Match[], flags: boolean): number {
  let widest = 0;
  for (const m of matches) widest = Math.max(widest, displayWidth(homeCell(m, flags)));
  return Math.max(HOME_COLUMN, Math.min(HOME_COLUMN_MAX, widest));
}

/**
 * A match's away CELL, exactly as `matchLine` prints it: the name, then its
 * space and the flag when a flag prints (flags on, and the side has one), the
 * name alone otherwise.
 */
export function awayCell(m: Match, flags: boolean): string {
  return flags ? withFlag(m.away.name, m.away.flag, 'away') : m.away.name;
}

/**
 * The width a list pads its away cells to, measured ONCE over the rows it
 * shows: the widest cell, at most {@link HOME_COLUMN_MAX} display columns (no
 * floor: a list of short names is not widened). Every row's time and flair
 * then start in one column; a cell past the ceiling pushes its own row only.
 * One row (`next`) is measured on itself, so it is printed as it always was.
 */
export function awayColumn(matches: readonly Match[], flags: boolean): number {
  let widest = 0;
  for (const m of matches) widest = Math.max(widest, displayWidth(awayCell(m, flags)));
  return Math.min(HOME_COLUMN_MAX, widest);
}

/**
 * The flair options of this invocation, ONE place: the level, the language,
 * the competition's team kind (a cry is said in a competition of its kind)
 * and the pin (it decides between two sides that both carry a cry; the pin
 * alone: `CLAUDINHO_TEAM` is not the cry's tiebreak, it is the team-taking
 * commands' query and the ambient pick's preference). A list hands them to
 * core `matchFlairs`, one line to `matchFlair`.
 */
export function flairOpts(cfg: CliConfig): FlairOpts {
  return { level: cfg.flavor, locale: cfg.lang, kind: teamKind(cfg.competition), pin: cfg.pin };
}

/**
 * One match as a single line, e.g.:
 *   🇲🇽 Mexico  1–0  South Africa 🇿🇦   67'
 *   🇧🇷 Brazil   vs  Morocco 🇲🇦        Thu 18:00
 *   Arsenal         2–1  Chelsea          50'   (a club: no flag, nothing in its place)
 *
 * `homeWidth` is the list's home column ({@link homeColumn}) and `awayWidth`
 * its away column ({@link awayColumn}), measured by the caller over the rows
 * it shows (0, the default, pads nothing). `flair` is the row's flair slot when the
 * caller chose it for a list (core `matchFlairs`: the cries, and no phrase
 * twice in one list); without it the line's own (`matchFlair`).
 */
export function matchLine(
  m: Match,
  cfg: CliConfig,
  t: Translator,
  c: Painter,
  flags = true,
  homeWidth = HOME_COLUMN,
  awayWidth = 0,
  flair: Flair = matchFlair(m, flairOpts(cfg)),
): string {
  const home = homeCell(m, flags);
  const away = awayCell(m, flags);
  const mid = isLive(m.status) || m.status === 'FT'
    ? c.bold(scoreline(m))
    : c.dim('vs');

  // Display-width padding: a tag-sequence flag (England 🏴󠁧󠁢󠁥󠁮󠁧󠁿) is 14 UTF-16
  // units but 2 columns — padEnd would push its score ~10 columns out of line.
  // The away cell padded to the list's away column the same way, so the time
  // and the flair line up whatever the away names' lengths.
  const left = `${padVisible(home, homeWidth)} ${mid.padStart(3)}  ${padVisible(away, awayWidth)}`;

  let right = '';
  if (m.status === 'SCHEDULED') {
    right = c.dim(
      `${formatKickoff(m.kickoff, { tz: cfg.tz, locale: cfg.lang })}`,
    );
  } else {
    right = statusToken(m, t, c);
  }
  // The flair slot (core `matchFlairs` / `matchFlair`): a team's rally cry
  // ("¿Y si sí?", "¡Goya!") when a side carries one, in every locale, green so
  // it pops past the dimmed commentary; else the row's phrase. By identity in
  // a competition of the cry's kind, never by the code: a club abbreviated MEX
  // is not Mexico. No cry on a postponed or cancelled line; both silenced by
  // --flavor off.
  const tail = flair.text ? `   ${flair.rally ? c.green(flair.text) : c.dim(flair.text)}` : '';
  return `  ${left}   ${right}${tail}`.trimEnd();
}

/** A section header. */
export function header(text: string, c: Painter): string {
  return c.bold(c.cyan(text));
}

/** The persistent legal disclaimer line. */
export function disclaimer(t: Translator, c: Painter): string {
  return c.dim(t('disclaimer'));
}

/**
 * Attribution for the live-data provider, e.g. "Live data: ESPN" (localized via the
 * `live.data` key, so es → "Datos en vivo: ESPN"). Empty string when there's no live
 * source (static-only output) so callers can skip it.
 */
export function dataSource(source: string | undefined, lang: string, c: Painter): string {
  return source ? c.dim(i18n(lang, 'live.data', { source: liveSourceLabel(source) })) : '';
}
