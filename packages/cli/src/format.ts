import pc from 'picocolors';
import {
  countdown,
  formatKickoff,
  isLive,
  scoreline,
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
    case 'SCHEDULED':
    default:
      return '';
  }
}

/**
 * One match as a single line, e.g.:
 *   🇲🇽 Mexico  1–0  South Africa 🇿🇦   67'
 *   🇧🇷 Brazil   vs  Morocco 🇲🇦        Thu 18:00
 */
export function matchLine(
  m: Match,
  cfg: CliConfig,
  t: Translator,
  c: Painter,
): string {
  const home = `${m.home.flag} ${m.home.name}`;
  const away = `${m.away.name} ${m.away.flag}`;
  const mid = isLive(m.status) || m.status === 'FT'
    ? c.bold(scoreline(m))
    : c.dim('vs');

  const left = `${home.padEnd(22)} ${mid.padStart(3)}  ${away}`;

  let right = '';
  if (m.status === 'SCHEDULED') {
    right = c.dim(
      `${formatKickoff(m.kickoff, { tz: cfg.tz, locale: cfg.lang })}`,
    );
  } else {
    right = statusToken(m, t, c);
  }
  return `  ${left}   ${right}`.trimEnd();
}

/** A section header. */
export function header(text: string, c: Painter): string {
  return c.bold(c.cyan(text));
}

/** The persistent legal disclaimer line. */
export function disclaimer(t: Translator, c: Painter): string {
  return c.dim(t('disclaimer'));
}
