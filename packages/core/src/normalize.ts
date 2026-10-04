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

/**
 * Compact scoreline string, e.g. "1–0" (en dash), or "vs" when unscored. A
 * knockout decided on penalties appends each side's shootout score in parens —
 * "1(3)–1(4)" — so the level regulation result still reads while showing who
 * advanced.
 */
export function scoreline(match: Match): string {
  if (!match.score) return 'vs';
  const { home, away } = match.score;
  if (match.shootout) {
    return `${home}(${match.shootout.home})–${away}(${match.shootout.away})`;
  }
  return `${home}–${away}`;
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

/**
 * Human-readable stage for display, in English (the group letter under the
 * group stage). An `OTHER` stage prints the provider's own words it carries,
 * untranslated, or NOTHING when it carries none: a caller that joins a stage
 * into a line drops an empty one with its separator.
 */
export function stageLabel(m: Pick<Match, 'stage' | 'group' | 'stageLabel'>): string {
  // A group letter belongs to the group stage (the seal drops one elsewhere).
  if (m.group && m.stage === 'GROUP') return `Group ${m.group}`;
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
    case 'REGULAR':
      return 'League';
    case 'LEAGUE':
      return 'League phase';
    case 'PO':
      return 'Play-offs';
    case 'OTHER':
      return m.stageLabel ?? '';
    default:
      return '';
  }
}

/**
 * The segments of a line that are joined with ` · ` (a stage, a location, a
 * time), with the EMPTY ones dropped: an OTHER stage with no words, or a
 * record with no venue, prints no segment and no separator, never a dangling
 * ` ·` or a `· ·`.
 */
export function joinSegments(segments: readonly (string | undefined)[]): string {
  return segments.filter((s): s is string => typeof s === 'string' && s !== '').join(' · ');
}
