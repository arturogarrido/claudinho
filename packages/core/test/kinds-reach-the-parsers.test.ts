/**
 * 0.11 · 2.2 + 2.4 — the rules the written kinds feed, where the red tests do
 * not reach them.
 *
 *   - The ADAPTER states its competition to both parsers (the scoreboard and
 *     the standings): the call is pinned, not just the parser. Without it a
 *     nations competition off the bundle would read as clubs (no flag), and a
 *     club competition is indistinguishable from "nobody said".
 *   - Every lookup in the written tables is an own-property one.
 *   - A group letter belongs to the group stage, on the cache path too.
 *   - The one joiner drops empty segments; the one flag rule puts nothing in a
 *     flag's place; the bracket prints a flagless side by its code.
 */
import { describe, expect, it } from 'vitest';
import {
  competitionKind,
  EspnAdapter,
  formatBracketMatchLine,
  joinSegments,
  stageLabel,
  stageLabelI18n,
  teamKind,
  withFlag,
} from '../src';
import type { BracketMatchView } from '../src/bracket/types';
import { seasonSlugOf } from '../src/kinds';
import { parseCachedMatch } from '../src/trust';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** One feed for any competition: a single table named like a group, and one event. */
function feed(competition: string) {
  const team = (id: string, abbreviation: string, displayName: string) => ({ id, abbreviation, displayName });
  const standings = {
    children: [
      {
        name: 'Group A',
        standings: {
          entries: [team('2654', 'ALB', 'Albania'), team('2578', 'LVA', 'Latvia')].map((t, i) => ({
            team: t,
            stats: STATS.map((name) => ({ name, value: name === 'rank' ? i + 1 : 0 })),
          })),
        },
      },
    ],
  };
  const scoreboard = {
    leagues: [{ season: { year: 2026 } }],
    events: [
      {
        id: '700100',
        date: '2026-10-10T18:45Z',
        season: { slug: 'league-phase' },
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitions: [
          {
            venue: { fullName: 'Air Albania Stadium' },
            competitors: [
              { homeAway: 'home', team: team('2654', 'ALB', 'Albania') },
              { homeAway: 'away', team: team('2578', 'LVA', 'Latvia') },
            ],
          },
        ],
      },
    ],
  };
  const fetchImpl = (async (input: unknown) =>
    json(String(input).includes('/standings') ? standings : scoreboard)) as unknown as typeof fetch;
  return new EspnAdapter({ competition, fetchImpl });
}

describe('the adapter states its competition to both parsers', () => {
  it('a nations competition off the bundle: the scoreboard row AND the standings row carry the generated flag', async () => {
    const adapter = feed('uefa.nations');
    const [m] = await adapter.fetchByDate('2026-10-10');
    expect(m?.home.flag).toBe('\u{1F1E6}\u{1F1F1}');
    expect(m?.stage).toBe('LEAGUE');
    const [table] = await adapter.fetchStandings();
    expect(table?.rows[0]?.team.flag).toBe('\u{1F1E6}\u{1F1F1}');
  });

  it('the same feed under a club competition: no flag on either, not even an empty one', async () => {
    const adapter = feed('eng.1');
    const [m] = await adapter.fetchByDate('2026-10-10');
    expect(m && 'flag' in m.home).toBe(false);
    const [table] = await adapter.fetchStandings();
    const row = table?.rows[0];
    expect(row?.team.name).toBe('Albania');
    expect(row && 'flag' in row.team).toBe(false);
  });
});

describe('the written tables are read by own property only', () => {
  it('a competition named like a property every object has is unlisted', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(teamKind(name), name).toBe('club');
      expect(competitionKind(name), name).toBe('cup');
      expect(seasonSlugOf(name), name).toBeUndefined();
    }
    expect(teamKind(undefined)).toBe('club');
    expect(competitionKind(undefined)).toBe('cup');
  });
});

describe('a group letter belongs to the group stage', () => {
  const base = {
    id: '700200',
    kickoff: '2026-10-10T18:45:00.000Z',
    venue: 'Emirates Stadium',
    home: { code: 'ARS', name: 'Arsenal' },
    away: { code: 'CHE', name: 'Chelsea' },
    status: 'SCHEDULED',
    updatedAt: '2026-10-10T12:00:00.000Z',
  };

  it('the cache path drops one claimed on any other stage, and keeps it on GROUP', () => {
    for (const stage of ['REGULAR', 'LEAGUE', 'PO', 'OTHER', 'FRIENDLY', 'R16']) {
      const r = parseCachedMatch({ ...base, stage, group: 'A' });
      expect(r.kind, stage).toBe('valid');
      expect(r.kind === 'valid' && 'group' in r.value, stage).toBe(false);
    }
    const g = parseCachedMatch({ ...base, stage: 'GROUP', group: 'A' });
    expect(g.kind === 'valid' && g.value.group).toBe('A');
  });

  it('the formatters print a group letter under GROUP only', () => {
    expect(stageLabel({ stage: 'REGULAR', group: 'A' })).toBe('League');
    expect(stageLabelI18n('es', { stage: 'REGULAR', group: 'A' })).toBe('Liga');
    expect(stageLabel({ stage: 'GROUP', group: 'A' })).toBe('Group A');
    expect(stageLabel({ stage: 'GROUP' })).toBe('Group stage');
  });

  it('a label is not a group: an OTHER prints its words, and a stage nobody knows prints itself', () => {
    expect(stageLabelI18n('fr', { stage: 'OTHER', stageLabel: 'Qualifying final', group: 'A' })).toBe('Qualifying final');
    expect(stageLabelI18n('en', { stage: 'constructor' as never })).toBe('constructor');
  });
});

describe('one joiner, one flag rule', () => {
  it('joinSegments drops the empty segments and their separators', () => {
    expect(joinSegments(['LIVE 50\'', '', 'Emirates Stadium'])).toBe('LIVE 50\' · Emirates Stadium');
    expect(joinSegments(['League', undefined, ''])).toBe('League');
    expect(joinSegments(['', ''])).toBe('');
  });

  it('withFlag prints a flag only when it is a non-empty string, with its one space', () => {
    const MX = '\u{1F1F2}\u{1F1FD}';
    expect(withFlag('Mexico', MX, 'home')).toBe(`${MX} Mexico`);
    expect(withFlag('Mexico', MX, 'away')).toBe(`Mexico ${MX}`);
    expect(withFlag('Arsenal', undefined, 'home')).toBe('Arsenal');
    expect(withFlag('Arsenal', '', 'away')).toBe('Arsenal');
  });

  it('the bracket prints a side with no flag by its code, never an empty flag', () => {
    const mv = {
      matchId: '1',
      stage: 'R16',
      index: 1,
      kickoff: '',
      home: { label: 'Arsenal', code: 'ARS', status: 'confirmed' },
      away: { label: 'Chelsea', code: 'CHE', status: 'confirmed' },
      match: {
        id: '1',
        stage: 'R16',
        kickoff: '',
        venue: '',
        home: { code: 'ARS', name: 'Arsenal' },
        away: { code: 'CHE', name: 'Chelsea' },
        status: 'SCHEDULED',
        updatedAt: '',
      },
    } as BracketMatchView;
    expect(formatBracketMatchLine(mv)).toBe('  ARS vs CHE');
  });
});
