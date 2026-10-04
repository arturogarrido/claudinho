import type { Match, Stage, Team } from '../types';

/** A participant slot in the bundled bracket topology (pre-resolution). */
export type SlotRef =
  | { kind: 'group'; position: 1 | 2; group: string }
  | { kind: 'third'; groups: string[] }
  | { kind: 'winner'; stage: Stage; index: number }
  | { kind: 'loser'; stage: Stage; index: number }
  /** ESPN pre-draw nation label — display only; never confirmed from the bundled schedule. */
  | { kind: 'seed'; label: string; code: string };

export interface BracketMatchNode {
  matchId: string;
  stage: Stage;
  /** 1-based index within the stage, ordered by ascending numeric ESPN event id. */
  index: number;
  home: SlotRef;
  away: SlotRef;
}

export interface BracketTopology {
  generatedAt: string;
  stages: Stage[];
  matches: BracketMatchNode[];
}

/** Knockout rounds in display order (3P before the final). */
export const BRACKET_STAGE_ORDER: Stage[] = ['R32', 'R16', 'QF', 'SF', '3P', 'F'];

export const EXPECTED_KNOCKOUT_COUNTS: Partial<Record<Stage, number>> = {
  R32: 16,
  R16: 8,
  QF: 4,
  SF: 2,
  '3P': 1,
  F: 1,
};

export type SlotStatus = 'confirmed' | 'projected' | 'tbd';

/** A resolved bracket participant for display. */
export interface ResolvedParticipant {
  label: string;
  /** A nation's flag, or the neutral 🏳️ of a slot not yet known; absent for a side with none. */
  flag?: string;
  code?: string;
  status: SlotStatus;
}

export interface BracketMatchView {
  matchId: string;
  stage: Stage;
  index: number;
  kickoff: string;
  home: ResolvedParticipant;
  away: ResolvedParticipant;
  match: Match;
}

export interface BracketStageView {
  stage: Stage;
  label: string;
  matches: BracketMatchView[];
}

export interface BracketView {
  stages: BracketStageView[];
  degraded: boolean;
  standingsDegraded: boolean;
  source?: string;
  /** The bracket is a World Cup feature; off the bundle there is none (audit A03). */
  unsupported?: true;
  /** This competition has no bracket at all (a league season with no knockout tie of its own). */
  inapplicable?: true;
}

export interface BracketResult {
  view: BracketView;
  /** Off the bundle there is no bracket (audit A03); `view.stages` is empty. */
  unsupported?: true;
  /**
   * This competition has no bracket at all (`bracketCapability`: a league
   * season with no knockout tie of its own); `view.stages` is empty.
   */
  inapplicable?: true;
  degraded: boolean;
  standingsDegraded: boolean;
  source?: string;
  /**
   * The knockout window said its answer was not whole (see
   * `VerdictSource.partial`): the view holds the ties that were read, and a
   * tie whose record was left out shows its bundled slot. Absent when the
   * window was whole, failed, or said nothing.
   */
  partial?: { omitted?: number };
}

/** Lookup a team object from a merged knockout match when the slot is already resolved. */
export function teamFromMatch(match: Match, code: string): Team | undefined {
  if (match.home.code === code) return match.home;
  if (match.away.code === code) return match.away;
  return undefined;
}
