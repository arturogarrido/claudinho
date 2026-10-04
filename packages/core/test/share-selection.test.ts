/**
 * Every share card names its competition and carries the selector that
 * reproduces it (0.11 · 2.5a; ledger row D2): a pasted card must answer the
 * same thing whatever the recipient follows, which a bare `npx @claudinho/cli
 * table A` cannot once a saved choice or an environment exists. The World
 * Cup's cards too: its default is the thing 2.5b removes.
 */
import { describe, expect, it } from 'vitest';
import {
  bracketShareCard,
  dateShareCard,
  formatShareBracket,
  formatShareSnippet,
  formatShareTable,
  liveShareCard,
  matchShareCard,
  nextShareCard,
  tableShareCard,
} from '../src';
import type { BracketResult, GroupStandings, LiveResult, Match, NextFixtureResult, StandingsResult } from '../src';

const m = (over: Partial<Match> = {}): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-10T11:30:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'LEE', name: 'Leeds United', id: 'espn:357' },
  status: 'SCHEDULED',
  updatedAt: '2026-10-04T12:00:00.000Z',
  ...over,
});
const wc = (): Match => m({ id: '760415', stage: 'GROUP', group: 'A', home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' } });
const live: LiveResult = { matches: [m({ status: 'LIVE', minute: 50, score: { home: 2, away: 1 } })], degraded: false, source: 'espn' };
const next: NextFixtureResult = { fixture: m(), degraded: false, source: 'espn', team: { code: 'ARS', name: 'Arsenal', id: 'espn:359' } } as NextFixtureResult;
const noMarket = { signals: new Map(), complete: true };
const firstLine = (text: string) => text.split('\n').find((l) => l.trim() !== '') ?? '';
const cueOf = (text: string) => text.split('\n').find((l) => l.includes('npx @claudinho/cli')) ?? '';

describe('a club competition\'s cards', () => {
  const ctx = { tz: 'UTC', locale: 'en', competition: 'eng.1' };

  it('live, next, match and date cards: the title names it and the cue selects it by alias', () => {
    const cards = [
      liveShareCard(live, ctx),
      nextShareCard(next, 'ARS', noMarket, ctx),
      matchShareCard({ match: m(), degraded: false, source: 'espn' }, '800000001', noMarket, ctx),
      dateShareCard({ date: '2026-10-10', explicit: true, matches: [m()], degraded: false, source: 'espn' }, noMarket, ctx),
    ];
    for (const card of cards) {
      expect(card.input.title, card.kind).toMatch(/ · Premier League$/);
      expect(card.input.installLine, card.kind).toMatch(/^npx @claudinho\/cli --competition premier-league /);
      expect(card.input.installLine, card.kind).not.toContain('CLAUDINHO_COMPETITION');
      const text = formatShareSnippet(card.input);
      expect(firstLine(text), card.kind).toContain('Premier League');
      expect(cueOf(text), card.kind).toContain('--competition premier-league');
    }
    expect(cards[1]?.input.installLine).toBe('npx @claudinho/cli --competition premier-league next ARS');
    expect(cards[2]?.input.installLine).toBe('npx @claudinho/cli --competition premier-league match 800000001');
  });

  it('a table card: the first line names the competition, the cue selects it', () => {
    const table: GroupStandings = { group: 'LEAGUE', label: '2026-27 English Premier League', rows: [] };
    const result: StandingsResult = { tables: [table], degraded: false, source: 'espn' };
    const card = tableShareCard(result, 'LEAGUE', result.tables, 'en', 'eng.1');
    expect(card.input.installLine).toBe('npx @claudinho/cli --competition premier-league table LEAGUE');
    const text = formatShareTable(card.input);
    expect(firstLine(text)).toContain('Premier League');
    expect(cueOf(text)).toContain('--competition premier-league');
  });
});

describe('the World Cup\'s cards: named and selected too (its default is what 2.5b removes)', () => {
  const ctx = { tz: 'UTC', locale: 'en', competition: 'fifa.world' };

  it('a live card', () => {
    const card = liveShareCard({ matches: [wc()], degraded: false, source: 'espn' }, ctx);
    expect(card.input.title).toBe('Live match pulse · World Cup');
    expect(card.input.installLine).toBe('npx @claudinho/cli --competition world-cup live');
  });

  it('a date card', () => {
    const card = dateShareCard({ date: '2026-06-11', explicit: true, matches: [wc()], degraded: false, source: 'espn' }, noMarket, ctx);
    expect(card.input.title).toMatch(/^Matches · .* · World Cup$/);
    expect(card.input.installLine).toBe('npx @claudinho/cli --competition world-cup today');
  });

  it('a table card and a bracket card', () => {
    const table: GroupStandings = { group: 'A', rows: [] };
    const tcard = tableShareCard({ tables: [table], degraded: false, source: 'espn' }, 'A', [table], 'en', 'fifa.world');
    expect(tcard.input.installLine).toBe('npx @claudinho/cli --competition world-cup table A');
    expect(firstLine(formatShareTable(tcard.input))).toContain('World Cup');
    const bracket: BracketResult = { view: { stages: [] }, degraded: false, source: 'espn', standingsDegraded: false } as unknown as BracketResult;
    const bcard = bracketShareCard(bracket, undefined, 'en', 'fifa.world');
    expect(bcard.input.installLine).toBe('npx @claudinho/cli --competition world-cup bracket');
    expect(firstLine(formatShareBracket(bcard.input))).toContain('World Cup');
  });
});

describe('a raw slug: the cue selects it as typed, the title names the slug', () => {
  it('the friendly competition', () => {
    const card = liveShareCard(live, { tz: 'UTC', locale: 'en', competition: 'fifa.friendly' });
    expect(card.input.title).toBe('Live match pulse · fifa.friendly');
    expect(card.input.installLine).toBe('npx @claudinho/cli --competition fifa.friendly live');
  });
});
