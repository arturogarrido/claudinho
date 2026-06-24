import type { Stage, Team } from '../types';
import type { SlotRef } from './types';

const PLACEHOLDER_FLAG = '🏳️';

function winnerName(stage: Stage, index: number): string {
  switch (stage) {
    case 'R32':
      return `Round of 32 ${index} Winner`;
    case 'R16':
      return `Round of 16 ${index} Winner`;
    case 'QF':
      return `Quarterfinal ${index} Winner`;
    case 'SF':
      return `Semifinal ${index} Winner`;
    default:
      return `${stage}-${index} Winner`;
  }
}

/** Map a topology slot to the placeholder team shown in the bundled schedule. */
export function slotRefToTeam(ref: SlotRef): Team {
  switch (ref.kind) {
    case 'group':
      return {
        code: ref.position === 1 ? `1${ref.group}` : `2${ref.group}`,
        name:
          ref.position === 1 ? `Group ${ref.group} Winner` : `Group ${ref.group} 2nd Place`,
        flag: PLACEHOLDER_FLAG,
      };
    case 'third':
      return {
        code: '3RD',
        name: `Third Place Group ${ref.groups.join('/')}`,
        flag: PLACEHOLDER_FLAG,
      };
    case 'winner':
      return { code: 'RD32', name: winnerName(ref.stage, ref.index), flag: PLACEHOLDER_FLAG };
    case 'loser':
      return {
        code: 'RD32',
        name: `Semifinal ${ref.index} Loser`,
        flag: PLACEHOLDER_FLAG,
      };
    case 'seed':
      return { code: 'TBD', name: ref.label, flag: PLACEHOLDER_FLAG };
    default:
      return { code: 'TBD', name: 'TBD', flag: PLACEHOLDER_FLAG };
  }
}

/** True when a team carries a real nation flag (not a bracket placeholder). */
export function isResolvedNation(team: Team): boolean {
  return team.flag !== PLACEHOLDER_FLAG;
}
