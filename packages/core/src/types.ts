/**
 * Claudinho domain model — the canonical, provider-agnostic shapes.
 * Every data vendor maps INTO these types via a ProviderAdapter.
 */

/** A team. `flag` is an emoji (no image assets, no copyright), and a nation's only. */
export interface Team {
  /**
   * Short code as the provider abbreviates it (e.g. "MEX", "ARS", "O&M"). A
   * DISPLAY LABEL, not an identity: two clubs in one competition can share one
   * (`CAR` is both Carabobo and Always Ready in the Libertadores).
   */
  code: string;
  /** Human-readable name (e.g. "Mexico"). */
  name: string;
  /**
   * Emoji flag (e.g. "🇲🇽"), GENERATED from a NATION's name (`sealTeam`); the
   * neutral 🏳️ for a nation competition's side that is no nation yet (a
   * bundle placeholder). A club has none: the key is ABSENT, never `''` and
   * never 🏳️, and nothing is printed in its place. Which teams are nations is
   * a written fact of the competition (`TEAM_KIND`).
   */
  flag?: string;
  /**
   * The provider's stable id for this team, namespaced by provider
   * (`espn:359`). The same for a club in every competition it plays. Present
   * on a team read from a live feed (and on that team read back from the
   * cache); ABSENT on the bundled schedule's teams and on a feed record that
   * carried none. Two teams with the same id are one team, whatever they are
   * called; the id never makes two teams of one code AND name (see `sameTeam`).
   */
  id?: string;
}

/**
 * What a provider reported about the season ONE response belongs to. Metadata
 * of that response, never an input: a request selects a competition, and the
 * provider says which season it answered for.
 */
export interface SeasonInfo {
  /** The season's year as the provider keys it (2026 for "2026-27"). */
  year: number;
  /** Human label (e.g. "2026-27 English Premier League"); may be empty. */
  label: string;
  /** ISO 8601 UTC, when the provider states it. */
  startDate?: string;
  /** ISO 8601 UTC, when the provider states it. */
  endDate?: string;
}

/**
 * The stage of a fixture, from a written grammar over the provider's season
 * slug and the competition's kind (`stageFromSlug` in the trust layer).
 *   - `GROUP`, `R32`, `R16`, `QF`, `SF`, `3P` (the third-place play-off), `F`:
 *     a tournament's group stage and knockout rounds;
 *   - `REGULAR`: a league's regular season ("League");
 *   - `LEAGUE`: a cup's league phase ("League phase");
 *   - `PO`: play-offs ("Play-offs"), a knockout stage;
 *   - `FRIENDLY`: a friendly, under the friendly competition only;
 *   - `OTHER`: a phase the grammar does not know. It carries the provider's own
 *     words in `Match.stageLabel` when there are any, and prints nothing when
 *     there are none (an absent or unreadable slug asserts no phase).
 */
export type Stage =
  | 'GROUP'
  | 'R32'
  | 'R16'
  | 'QF'
  | 'SF'
  | '3P'
  | 'F'
  | 'FRIENDLY'
  | 'REGULAR'
  | 'LEAGUE'
  | 'PO'
  | 'OTHER';

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
  /**
   * The provider's own words for a phase the grammar does not know (the slug
   * humanized: `qualifying-final` → "Qualifying final"), a human label of at
   * most 40 columns. Present only on an `OTHER` stage, and only when there are
   * words; printed untranslated.
   */
  stageLabel?: string;
  /** Group letter "A".."L" for the group stage; undefined for knockouts. */
  group?: string;
  /** Kickoff time, ISO 8601 in UTC (always ends in "Z"). */
  kickoff: string;
  venue: string;
  /** Host city (e.g. "Mexico City"). Present when the provider supplies it. */
  city?: string;
  /** Host country (e.g. "Mexico"). Present when the provider supplies it. */
  country?: string;
  home: Team;
  away: Team;
  /** Present once the match is no longer purely SCHEDULED. */
  score?: { home: number; away: number };
  /**
   * Penalty-shootout score for a knockout decided on penalties (ESPN
   * `competitor.shootoutScore`; status detail "FT-Pens"). Present ONLY for
   * shootout matches — `score` stays the level regulation/extra-time result, and
   * `scoreline` renders e.g. "1(3)–1(4)". Live-only, never in the bundle.
   */
  shootout?: { home: number; away: number };
  /** Live match minute when in progress. */
  minute?: number;
  status: Status;
  /** Goals/cards when the provider supplies them. */
  events?: MatchEvent[];
  /**
   * Winner's team code when the provider marks one (e.g. ESPN `competitor.winner`
   * after penalties). Used for knockout advancement when the score is level.
   */
  winnerCode?: string;
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

/**
 * A standings row: declared beside the tables (`standings.ts`), re-exported
 * here with the other domain shapes, so the model has one place to import from.
 */
export type { StandingRow } from './standings';
