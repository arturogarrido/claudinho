/**
 * Claudinho domain model — the canonical, provider-agnostic shapes.
 * Every data vendor maps INTO these types via a ProviderAdapter.
 */

/** A national team. `flag` is an emoji (no image assets, no copyright). */
export interface Team {
  /** Short code, typically the FIFA/IOC 3-letter abbreviation (e.g. "MEX"). */
  code: string;
  /** Human-readable name (e.g. "Mexico"). */
  name: string;
  /** Emoji flag (e.g. "🇲🇽"). */
  flag: string;
}

/**
 * Tournament stage. "3P" is the third-place play-off. "FRIENDLY" is used for
 * non-tournament fixtures (e.g. international friendlies) surfaced when the
 * adapter points at a non-World-Cup competition.
 */
export type Stage = 'GROUP' | 'R32' | 'R16' | 'QF' | 'SF' | '3P' | 'F' | 'FRIENDLY';

/** Normalized match status across all providers. */
export type Status =
  | 'SCHEDULED'
  | 'LIVE'
  | 'HT'
  | 'FT'
  | 'POSTPONED'
  | 'CANCELLED';

/** Match outcome from the home team's perspective. */
export type Outcome = 'H' | 'D' | 'A';

/** A discrete in-match event (provider-dependent; often absent on free tiers). */
export interface MatchEvent {
  type: 'GOAL' | 'OWN_GOAL' | 'PEN' | 'YELLOW' | 'RED' | 'SUB';
  minute: number;
  teamCode: string;
  player?: string;
}

/** A single fixture/result — the central entity. */
export interface Match {
  /** Stable id (provider id for now; cross-provider keying comes later). */
  id: string;
  stage: Stage;
  /** Group letter "A".."L" for the group stage; undefined for knockouts. */
  group?: string;
  /** Kickoff time, ISO 8601 in UTC (always ends in "Z"). */
  kickoff: string;
  venue: string;
  home: Team;
  away: Team;
  /** Present once the match is no longer purely SCHEDULED. */
  score?: { home: number; away: number };
  /** Live match minute when in progress. */
  minute?: number;
  status: Status;
  /** Goals/cards when the provider supplies them. */
  events?: MatchEvent[];
  /** When this snapshot was produced (ISO 8601). */
  updatedAt: string;
}

/** The AI pundit's prediction for a fixture, localized. */
export interface PunditPick {
  matchId: string;
  lang: string;
  scoreline: { home: number; away: number };
  outcome: Outcome;
  /** One-line rationale, localized. */
  reason: string;
  /** 0..1 self-reported confidence. */
  confidence: number;
  createdAt: string;
}

/** One scored row in the pundit accuracy ledger. */
export interface LedgerRow {
  matchId: string;
  predicted: { home: number; away: number; outcome: Outcome };
  actual: { home: number; away: number; outcome: Outcome };
  exactHit: boolean;
  outcomeHit: boolean;
  /** Brier score component for the outcome prediction. */
  brier: number;
}
