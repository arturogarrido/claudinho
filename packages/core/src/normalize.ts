import type { Match, Outcome, Status } from './types';

/** Outcome (home perspective) from a final/looking scoreline. */
export function outcomeFromScore(home: number, away: number): Outcome {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

/** Is the match currently in play (including halftime)? */
export function isLive(status: Status): boolean {
  return status === 'LIVE' || status === 'HT';
}

/** Has the match finished in regulation/normal completion? */
export function isFinished(status: Status): boolean {
  return status === 'FT';
}

/** Compact scoreline string, e.g. "1–0" (en dash) or "vs" when unscored. */
export function scoreline(match: Match): string {
  if (!match.score) return 'vs';
  return `${match.score.home}–${match.score.away}`;
}

/**
 * Human-readable location: venue plus city/country when the provider supplies
 * them, e.g. "Estadio Banorte, Mexico City, Mexico". Keeping this in one place
 * means the CLI and MCP surfaces stay consistent — and gives the model an
 * unambiguous city so it never has to guess one.
 */
export function matchLocation(match: Match): string {
  return [match.venue, match.city, match.country].filter(Boolean).join(', ');
}

/** Sort comparator by kickoff time, ascending. */
export function byKickoff(a: Match, b: Match): number {
  return a.kickoff.localeCompare(b.kickoff);
}

/** Human-readable stage for display (group letter when applicable). */
export function stageLabel(m: Pick<Match, 'stage' | 'group'>): string {
  if (m.group) return `Group ${m.group}`;
  switch (m.stage) {
    case 'GROUP':
      return 'Group stage';
    case 'R32':
      return 'Round of 32';
    case 'R16':
      return 'Round of 16';
    case 'QF':
      return 'Quarter-final';
    case 'SF':
      return 'Semi-final';
    case '3P':
      return 'Third-place play-off';
    case 'F':
      return 'Final';
    case 'FRIENDLY':
      return 'Friendly';
    default:
      return '';
  }
}
