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
  padVisible,
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
  // One template for the column header AND the data rows so they can't drift.
  // Display-width padding (a tag-sequence flag like England's is 14 UTF-16
  // units but 2 columns), and no truncation — never cut a nation mid-name.
  const line = (team: string, p: string, w: string, d: string, l: string, gd: string, pts: string) =>
    `${padVisible(team, 24)} ${p.padStart(2)} ${w.padStart(2)} ${d.padStart(2)} ${l.padStart(2)} ${gd.padStart(3)} ${pts.padStart(3)}`;
  const cols = line('Team', 'P', 'W', 'D', 'L', 'GD', 'Pts');
  const lines = rows.map((r) =>
    line(
      `${r.team.flag} ${r.team.name}`,
      String(r.played),
      String(r.won),
      String(r.drawn),
      String(r.lost),
      r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff),
      String(r.points),
    ),
  );
  return [header, cols, ...lines].join('\n');
}

/** The persistent legal disclaimer appended to responses. */
export const DISCLAIMER =
  'Claudinho is an independent fan project — not affiliated with or endorsed by FIFA or Anthropic.';
