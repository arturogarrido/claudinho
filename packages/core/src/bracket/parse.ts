import type { Team } from '../types';
import type { SlotRef } from './types';

const PLACEHOLDER_FLAG = '🏳️';

/**
 * Parse an ESPN home/away team into a bracket slot reference.
 * Returns null when the name is unrecognized — gen:schedule must fail loudly.
 */
export function parseTeamSlot(team: Team): SlotRef | null {
  if (team.flag !== PLACEHOLDER_FLAG) {
    return { kind: 'team', code: team.code };
  }

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

  return null;
}
