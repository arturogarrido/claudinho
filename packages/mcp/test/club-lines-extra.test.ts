/**
 * 0.11 · 2.2 + 2.4 — MCP text rules the red tests do not reach: a match line
 * joins its status, stage and location with the empty ones dropped (a record
 * with no venue used to end in a dangling separator), and a side with no flag
 * prints its name alone, in the match line and in a standings row.
 */
import type { Match } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { matchLine, standingsTable } from '../src/format';

const club = (over: Partial<Match> = {}): Match => ({
  id: '800000050',
  stage: 'REGULAR',
  kickoff: '2026-10-04T14:00:00.000Z',
  venue: '',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'LIVE',
  minute: 50,
  score: { home: 2, away: 1 },
  updatedAt: '2026-10-04T14:50:00.000Z',
  ...over,
});

describe('the match line', () => {
  it('a venue-less record ends in its stage, not in a separator', () => {
    expect(matchLine(club(), { flavor: 'off', now: new Date('2026-10-04T14:50:00.000Z') })).toBe("Arsenal 2–1 Chelsea — LIVE 50' · League");
  });

  it('an OTHER with no words and no venue: the status alone', () => {
    expect(matchLine(club({ stage: 'OTHER' }), { flavor: 'off', now: new Date('2026-10-04T14:50:00.000Z') })).toBe("Arsenal 2–1 Chelsea — LIVE 50'");
  });

  it('with a venue and words: every segment, once each', () => {
    const line = matchLine(club({ stage: 'OTHER', stageLabel: 'Qualifying final', venue: 'Emirates Stadium', city: 'London' }), {
      flavor: 'off',
      now: new Date('2026-10-04T14:50:00.000Z'),
    });
    expect(line).toBe("Arsenal 2–1 Chelsea — LIVE 50' · Qualifying final · Emirates Stadium, London");
  });

  it('a nation keeps its flags', () => {
    const line = matchLine(
      club({
        home: { code: 'MEX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}' },
        away: { code: 'RSA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}' },
        stage: 'GROUP',
        group: 'A',
        venue: 'Estadio Banorte',
      }),
      { flavor: 'off', now: new Date('2026-10-04T14:50:00.000Z') },
    );
    expect(line).toBe("\u{1F1F2}\u{1F1FD} Mexico 2–1 South Africa \u{1F1FF}\u{1F1E6} — LIVE 50' · Group A · Estadio Banorte");
  });
});

describe('a standings row', () => {
  it('a club is its name alone; a nation its flag and name', () => {
    const row = (team: Match['home']) => ({
      team,
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goalsFor: 2,
      goalsAgainst: 1,
      goalDiff: 1,
      points: 3,
    });
    const text = standingsTable({ group: 'LEAGUE', label: 'Premier League' }, [
      row({ code: 'ARS', name: 'Arsenal' }),
      row({ code: 'MEX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}' }),
    ]);
    const [, , ars, mex] = text.split('\n');
    expect(ars).toMatch(/^Arsenal {2,}1/);
    expect(mex).toMatch(/^\u{1F1F2}\u{1F1FD} Mexico {2,}1/u);
  });
});
