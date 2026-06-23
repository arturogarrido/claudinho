/**
 * Plain-text formatting for MCP responses. Unlike the CLI, there's no ANSI
 * color — output is optimized for an LLM to read. Tools also return structured
 * JSON alongside the text so agents can consume the raw data.
 */
import {
  countdown,
  formatKickoff,
  matchFlavor,
  matchLocation,
  scoreline,
  stageLabel,
  type FlavorLevel,
  type Match,
  type StandingRow,
} from '@claudinho/core';

const STATUS_LABEL: Record<Match['status'], string> = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  HT: 'half-time',
  FT: 'full-time',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
};

export interface FmtOpts {
  tz?: string;
  locale?: string;
  flavor?: FlavorLevel;
}

export function matchLine(m: Match, opts: FmtOpts = {}): string {
  const head = `${m.home.flag} ${m.home.name} ${scoreline(m)} ${m.away.name} ${m.away.flag}`;
  const stage = stageLabel(m);
  let tail: string;
  if (m.status === 'SCHEDULED') {
    tail = `${formatKickoff(m.kickoff, opts)} (in ${countdown(m.kickoff)})`;
  } else if (m.status === 'LIVE') {
    tail = m.minute ? `LIVE ${m.minute}'` : 'LIVE';
  } else {
    tail = STATUS_LABEL[m.status];
  }
  const flair = matchFlavor(m, { level: opts.flavor, locale: opts.locale });
  const base = `${head} — ${tail} · ${stage} · ${matchLocation(m)}`;
  return (flair ? `${base} — ${flair}` : base).trimEnd();
}

/** A list of matches as a text block (or an empty-state message). */
export function matchList(matches: Match[], empty: string, opts: FmtOpts = {}): string {
  if (matches.length === 0) return empty;
  return matches.map((m) => `• ${matchLine(m, opts)}`).join('\n');
}

/** A group table as a monospace-friendly text block. */
export function standingsTable(group: string, rows: StandingRow[]): string {
  const header = `Group ${group}`;
  const cols = 'Team                     P  W  D  L   GD  Pts';
  const lines = rows.map((r) => {
    const name = `${r.team.flag} ${r.team.name}`.padEnd(24).slice(0, 24);
    const gd = (r.goalDiff > 0 ? `+${r.goalDiff}` : `${r.goalDiff}`).padStart(3);
    return `${name} ${pad(r.played)} ${pad(r.won)} ${pad(r.drawn)} ${pad(r.lost)} ${gd}  ${pad(r.points)}`;
  });
  return [header, cols, ...lines].join('\n');
}

function pad(n: number): string {
  return `${n}`.padStart(2);
}

/** The persistent legal disclaimer appended to responses. */
export const DISCLAIMER =
  'Claudinho is an independent fan project — not affiliated with or endorsed by FIFA or Anthropic.';
