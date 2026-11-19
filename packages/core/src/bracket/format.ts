import { isFinished, isLive, scoreline } from '../normalize';
import { t } from '../i18n';
import { formatKickoff } from '../time';
import { liveSourceLabel } from '../live';
import type { BracketMatchView, BracketView, ResolvedParticipant } from './types';

export interface BracketFormatOpts {
  flags?: boolean;
  tz?: string;
  locale?: string;
}

function formatParticipant(
  p: ResolvedParticipant,
  side: 'home' | 'away',
  flags: boolean,
  locale?: string,
): string {
  const suffix = p.status === 'projected' ? ` ${t(locale, 'bracket.projected')}` : '';
  // Nothing in a flag's place: a slot not yet known (🏳️), or a side with no
  // flag, is printed by its code (or its label), like a flagless terminal.
  if (!flags || !p.flag || p.flag === '🏳️') {
    if (p.code && p.code !== 'TBD') return `${p.code}${suffix}`;
    return `${p.label}${suffix}`;
  }
  if (side === 'home') return `${p.flag} ${p.label}${suffix}`;
  return `${p.label}${suffix} ${p.flag}`;
}

function statusTail(m: BracketMatchView['match']): string {
  if (m.status === 'LIVE' && m.minute) return `  ${m.minute}'`;
  if (m.status === 'HT') return '  HT';
  if (m.status === 'FT') return '  FT';
  if (isLive(m.status)) return '  LIVE';
  return '';
}

function formatBracketKickoff(iso: string, opts: BracketFormatOpts): string {
  return formatKickoff(iso, { tz: opts.tz, locale: opts.locale, date: true });
}

/** One bracket match line for list or tree output. */
export function formatBracketMatchLine(mv: BracketMatchView, opts: BracketFormatOpts = {}): string {
  const flags = opts.flags !== false;
  const home = formatParticipant(mv.home, 'home', flags, opts.locale);
  const away = formatParticipant(mv.away, 'away', flags, opts.locale);
  const m = mv.match;
  if (isFinished(m.status) || isLive(m.status)) {
    return `  ${home}  ${scoreline(m)}  ${away}${statusTail(m)}`;
  }
  const kickoff = mv.kickoff
    ? formatBracketKickoff(mv.kickoff, opts)
    : '';
  return `  ${home} vs ${away}${kickoff ? ` · ${kickoff}` : ''}`;
}

/** Staged list view — default bracket renderer. */
export function formatBracketList(
  view: BracketView,
  opts: BracketFormatOpts & { footer?: boolean } = {},
): string {
  const blocks: string[] = [];
  for (const stage of view.stages) {
    blocks.push(stage.label);
    for (const mv of stage.matches) {
      blocks.push(formatBracketMatchLine(mv, opts));
    }
    blocks.push('');
  }
  if (opts.footer !== false) {
    if (view.degraded) {
      blocks.push(`(${t(opts.locale, 'bracket.degraded')})`);
    } else if (view.standingsDegraded) {
      blocks.push(`(${t(opts.locale, 'bracket.standingsDegraded')})`);
    }
    if (view.source) {
      blocks.push(t(opts.locale, 'live.data', { source: liveSourceLabel(view.source) }));
    }
  }
  return blocks.join('\n').trimEnd();
}

const MIN_TREE_WIDTH = 80;

/**
 * ASCII bracket with stage connectors. Returns null when the terminal is too narrow —
 * callers should fall back to {@link formatBracketList}.
 */
export function formatBracketTree(
  view: BracketView,
  opts: BracketFormatOpts & { width?: number; footer?: boolean } = {},
): string | null {
  const width = opts.width ?? 80;
  if (width < MIN_TREE_WIDTH) return null;

  const blocks: string[] = [];
  for (let i = 0; i < view.stages.length; i++) {
    const stage = view.stages[i]!;
    blocks.push(`━━━ ${stage.label} ━━━`);
    for (const mv of stage.matches) {
      blocks.push(formatBracketMatchLine(mv, opts));
    }
    if (i < view.stages.length - 1) {
      blocks.push('    │');
      blocks.push('    ▼');
    }
    blocks.push('');
  }
  if (opts.footer !== false) {
    if (view.degraded) {
      blocks.push(`(${t(opts.locale, 'bracket.degraded')})`);
    } else if (view.standingsDegraded) {
      blocks.push(`(${t(opts.locale, 'bracket.standingsDegraded')})`);
    }
    if (view.source) {
      blocks.push(t(opts.locale, 'live.data', { source: liveSourceLabel(view.source) }));
    }
  }
  return blocks.join('\n').trimEnd();
}
