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

/** Sort comparator by kickoff time, ascending. */
export function byKickoff(a: Match, b: Match): number {
  return a.kickoff.localeCompare(b.kickoff);
}
