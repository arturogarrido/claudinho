import type { Team } from '../types';
import type { SlotRef } from './types';
import { isResolvedNation } from './placeholders';

const PLACEHOLDER_FLAG = '🏳️';

/**
 * Parse an ESPN home/away label into a bracket slot reference (name patterns only).
 * Real nation flags are mapped to `seed` — never `team` — so the bundled schedule
 * cannot treat ESPN pre-draw labels as confirmed participants.
 */
export function parseTeamSlot(team: Team): SlotRef | null {
  const name = team.name;

  let m = name.match(/^Group ([A-L]) Winner$/);
  if (m) return { kind: 'group', position: 1, group: m[1]! };

  m = name.match(/^Group ([A-L]) 2nd Place$/);
  if (m) return { kind: 'group', position: 2, group: m[1]! };

  m = name.match(/^Third Place Group ([A-L](?:\/[A-L])+)$/);
  if (m) return { kind: 'third', groups: m[1]!.split('/') };

  m = name.match(/^Round of 32 (\d+) Winner$/);
  if (m) return { kind: 'winner', stage: 'R32', index: Number(m[1]) };

  m = name.match(/^Round of 16 (\d+) Winner$/);
  if (m) return { kind: 'winner', stage: 'R16', index: Number(m[1]) };

  m = name.match(/^Quarterfinal (\d+) Winner$/);
  if (m) return { kind: 'winner', stage: 'QF', index: Number(m[1]) };

  m = name.match(/^Semifinal (\d+) Winner$/);
  if (m) return { kind: 'winner', stage: 'SF', index: Number(m[1]) };

  m = name.match(/^Semifinal (\d+) Loser$/);
  if (m) return { kind: 'loser', stage: 'SF', index: Number(m[1]) };

  if (isResolvedNation(team)) {
    return { kind: 'seed', label: team.name, code: 'TBD' };
  }

  // Restored bundled knockout placeholder (post-sanitize seed label).
  if (team.flag === PLACEHOLDER_FLAG && team.code === 'TBD') {
    return { kind: 'seed', label: team.name, code: 'TBD' };
  }

  return null;
}
