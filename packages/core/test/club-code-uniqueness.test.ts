/**
 * 0.11 PR 2.1c, added by the coder: a club's CODE is not an identity (two
 * Libertadores clubs are both `CAR`), so one hit by code resolves only against
 * a roster that was read whole. With a table asked for and not read whole, the
 * other club may be the refused row, or a club with no match in the span: the
 * answer is "not known" (`unresolved`, which `next` answers as degraded), never
 * a silent pick. A NAME still resolves on one hit, and a competition with no
 * table answers a code from the schedule, the only evidence it will ever have.
 */
import { describe, expect, it } from 'vitest';
import { resolveClub, type Roster } from '../src/teams';
import type { Match, Team } from '../src/types';

const T = (id: string, code: string, name: string): Team => ({ id: `espn:${id}`, code, name, flag: '\u{1F3F3}️' });
const CARABOBO = T('7001', 'CAR', 'Carabobo');
const ALWAYS_READY = T('7002', 'CAR', 'Always Ready');
const BOCA = T('7003', 'BOC', 'Boca Juniors');
const fixture = (home: Team, away: Team): Match =>
  ({ id: '20', stage: 'FRIENDLY', kickoff: '2026-10-12T22:00:00.000Z', venue: '', home, away, status: 'SCHEDULED', updatedAt: '2026-10-10T15:00:00.000Z' }) as Match;

describe('a code resolves on one hit only against a roster read whole', () => {
  const schedule = [fixture(ALWAYS_READY, BOCA)];

  it('the table could not be read: `CAR` matched once in the span is not unique, so it is not answered', () => {
    const unread: Roster = { teams: [], complete: false, tableAsked: true };
    expect(resolveClub('CAR', unread, schedule)).toEqual({ outcome: 'unresolved', idless: [] });
    // A name is specific: it still resolves from the schedule.
    expect(resolveClub('Always Ready', unread, schedule)).toMatchObject({ outcome: 'resolved', team: { id: 'espn:7002' } });
  });

  it('one of two shared-code rows refused: the row that was read is not "the" CAR', () => {
    const partial: Roster = { teams: [CARABOBO], complete: false, tableAsked: true };
    expect(resolveClub('car', partial, []).outcome).toBe('unresolved');
  });

  it('a roster read whole proves it: one CAR in it is the CAR', () => {
    const whole: Roster = { teams: [CARABOBO, BOCA], complete: true, tableAsked: true };
    expect(resolveClub('CAR', whole, []).outcome).toBe('resolved');
  });

  it('a competition with no table: the schedule is all there is, and a code it holds once is answered', () => {
    const none: Roster = { teams: [], complete: false, tableAsked: false };
    expect(resolveClub('CAR', none, schedule)).toMatchObject({ outcome: 'resolved', team: { id: 'espn:7002' } });
  });
});
