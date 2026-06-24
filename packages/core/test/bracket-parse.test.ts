import { describe, expect, it } from 'vitest';
import { parseTeamSlot } from '../src/bracket/parse';
import type { Team } from '../src/types';

const T = (name: string, code: string, flag = '🏳️'): Team => ({ name, code, flag });

describe('parseTeamSlot', () => {
  it('maps ESPN pre-draw host nations to group-winner slots', () => {
    expect(parseTeamSlot(T('Mexico', 'MEX', '🇲🇽'))).toEqual({
      kind: 'group',
      position: 1,
      group: 'A',
    });
    expect(parseTeamSlot(T('Germany', 'GER', '🇩🇪'))).toEqual({
      kind: 'group',
      position: 1,
      group: 'E',
    });
    expect(parseTeamSlot(T('United States', 'USA', '🇺🇸'))).toEqual({
      kind: 'group',
      position: 1,
      group: 'D',
    });
    expect(parseTeamSlot(T('Argentina', 'ARG', '🇦🇷'))).toEqual({
      kind: 'group',
      position: 1,
      group: 'J',
    });
  });

  it('maps other ESPN pre-draw nations to generic seed slots', () => {
    expect(parseTeamSlot(T('France', 'FRA', '🇫🇷'))).toEqual({
      kind: 'seed',
      label: 'France',
      code: 'TBD',
    });
  });

  it('parses group winner and runner-up slots', () => {
    expect(parseTeamSlot(T('Group A Winner', '1A'))).toEqual({
      kind: 'group',
      position: 1,
      group: 'A',
    });
    expect(parseTeamSlot(T('Group B 2nd Place', '2B'))).toEqual({
      kind: 'group',
      position: 2,
      group: 'B',
    });
  });

  it('parses third-place composite slots', () => {
    expect(parseTeamSlot(T('Third Place Group A/B/C/D/F', '3RD'))).toEqual({
      kind: 'third',
      groups: ['A', 'B', 'C', 'D', 'F'],
    });
  });

  it('parses winner and loser advancement slots', () => {
    expect(parseTeamSlot(T('Round of 32 3 Winner', 'RD32'))).toEqual({
      kind: 'winner',
      stage: 'R32',
      index: 3,
    });
    expect(parseTeamSlot(T('Semifinal 1 Loser', 'RD32'))).toEqual({
      kind: 'loser',
      stage: 'SF',
      index: 1,
    });
  });

  it('returns null for unrecognized placeholder names', () => {
    expect(parseTeamSlot(T('Mystery Slot', '???'))).toBeNull();
  });
});
