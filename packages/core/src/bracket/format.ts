import { isFinished, isLive, scoreline } from '../normalize';
import { t, stageLabelI18n } from '../i18n';
import { formatKickoff, formatTime } from '../time';
import { SHARE_DISCLAIMER, SHARE_HASHTAG } from '../share/format';
import { liveSourceLabel } from '../live';
import type { Stage } from '../types';
import type { BracketMatchView, BracketView, ResolvedParticipant } from './types';

export interface BracketFormatOpts {
  flags?: boolean;
  tz?: string;
  locale?: string;
}

function formatParticipant(p: ResolvedParticipant, flags: boolean, locale?: string): string {
  const suffix = p.status === 'projected' ? ` ${t(locale, 'bracket.projected')}` : '';
  if (flags && p.flag !== '🏳️') return `${p.flag} ${p.label}${suffix}`;
  if (p.code) return `${p.code}${suffix}`;
  return `${p.label}${suffix}`;
}

function statusTail(m: BracketMatchView['match']): string {
  if (m.status === 'LIVE' && m.minute) return `  ${m.minute}'`;
  if (m.status === 'HT') return '  HT';
  if (m.status === 'FT') return '  FT';
  if (isLive(m.status)) return '  LIVE';
  return '';
}

/** One bracket match line for list or tree output. */
export function formatBracketMatchLine(mv: BracketMatchView, opts: BracketFormatOpts = {}): string {
  const flags = opts.flags !== false;
  const home = formatParticipant(mv.home, flags, opts.locale);
  const away = formatParticipant(mv.away, flags, opts.locale);
  const m = mv.match;
  if (isFinished(m.status) || isLive(m.status)) {
    return `  ${home}  ${scoreline(m)}  ${away}${statusTail(m)}`;
  }
  const kickoff = mv.kickoff
    ? formatKickoff(mv.kickoff, { tz: opts.tz, locale: opts.locale })
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

export interface ShareBracketInput {
  view: BracketView;
  source?: string;
  installLine?: string;
  emptyNote?: string;
}

export interface ShareBracketOptions {
  includeHashtag?: boolean;
  includeInstallLine?: boolean;
  stage?: Stage;
  locale?: string;
}

/** Plain-text share card for the knockout bracket. */
export function formatShareBracket(
  input: ShareBracketInput,
  options: ShareBracketOptions = {},
): string {
  const includeHashtag = options.includeHashtag !== false;
  const includeInstall = options.includeInstallLine !== false;
  const locale = options.locale;
  const blocks: string[] = [t(locale, 'bracket.shareTitle'), ''];

  if (input.view.stages.length === 0) {
    blocks.push(input.emptyNote ?? t(locale, 'bracket.empty'));
  } else {
    blocks.push(formatBracketList(input.view, { footer: false, locale }));
    if (input.view.degraded) {
      blocks.push(`(${t(locale, 'bracket.degraded')})`);
    } else if (input.view.standingsDegraded) {
      blocks.push(`(${t(locale, 'bracket.standingsDegraded')})`);
    }
  }

  const footer: string[] = [];
  const src = input.source ?? input.view.source;
  if (src) footer.push(t(locale, 'live.data', { source: liveSourceLabel(src) }));
  footer.push(
    [includeHashtag ? SHARE_HASHTAG : '', SHARE_DISCLAIMER].filter(Boolean).join(' · '),
  );
  if (includeInstall && input.installLine) {
    footer.push(t(locale, 'share.tryIt', { line: input.installLine }));
  }
  blocks.push('', footer.join('\n'));
  return blocks.join('\n');
}

/** Compact one-line-per-match bracket for narrow share contexts. */
export function formatBracketCompactLine(mv: BracketMatchView, opts: BracketFormatOpts = {}): string {
  const flags = opts.flags !== false;
  const home = flags && mv.home.code ? `${mv.home.flag} ${mv.home.code}` : mv.home.label;
  const away = flags && mv.away.code ? `${mv.away.code} ${mv.away.flag}` : mv.away.label;
  const m = mv.match;
  const mid = isFinished(m.status) || isLive(m.status) ? scoreline(m) : 'vs';
  const tail = m.status === 'SCHEDULED' && mv.kickoff
    ? ` · ${formatTime(mv.kickoff, { tz: opts.tz, locale: opts.locale })}`
    : statusTail(m);
  return `${stageLabelI18n(opts.locale, mv.stage)} · ${home} ${mid} ${away}${tail}`;
}
