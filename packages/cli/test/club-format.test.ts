/**
 * 0.11 · 2.2 — two CLI format rules that a club list changes.
 *
 * The home column: `matchLine` padded the home cell to a fixed 22 display
 * columns, enough for every nation but not for "Independiente Rivadavia". The
 * width is now measured once per list on the shown home CELLS (the flag and
 * its space when there is one, the name alone otherwise), floored at 22 and
 * capped at 32: a list whose widest cell fits 22 is byte-identical to before.
 *
 * "¿Y si sí?": Mexico's rally cry was keyed on the code `MEX`, which a club
 * can carry too. It is keyed on identity now: Mexico's provider id (or the
 * bundle's id-less Mexico), in a nations competition.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { displayWidth, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { matchLine, painterFor } from '../src/format';
import { makeT } from '../src/i18n';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'fifa.world', flavor: 'full', markets: false, ...over });
}
const NOW = new Date('2026-10-04T12:00:00Z');
const club = (id: string, home: [string, string], away: [string, string]): Match => ({
  id,
  stage: 'REGULAR',
  kickoff: '2026-10-04T14:00:00.000Z',
  venue: 'Somewhere',
  home: { code: home[0], name: home[1], id: `espn:${home[0]}` },
  away: { code: away[0], name: away[1], id: `espn:${away[0]}` },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
});
const adapterOf = (fixtures: Match[], competition = 'conmebol.libertadores'): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return fixtures;
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return fixtures;
  },
});
const ctxFor = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg({ competition: adapter.competition, flavor: 'off', ...over }),
  t: makeT('en'),
  adapter,
  now: NOW,
  marketProvider: new FakeMarketProvider(),
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const rows = () => writes.join('').split('\n').filter((l) => / vs /.test(l));
const vsColumn = (line: string) => displayWidth(line.slice(0, line.indexOf('vs')));

describe('the home column is measured on the list', () => {
  it('a list whose widest home cell fits 22 columns keeps the column where it was', async () => {
    await cmdToday('2026-10-04', ctxFor(adapterOf([club('1', ['ARS', 'Arsenal'], ['CHE', 'Chelsea']), club('2', ['LEE', 'Leeds United'], ['LIV', 'Liverpool'])], 'eng.1')));
    const lines = rows();
    expect(lines).toHaveLength(2);
    // "  " + a 22-column cell + " " + " vs": the `vs` starts at column 26, as it always has.
    for (const l of lines) expect(vsColumn(l), l).toBe(26);
  });

  it('a wider home cell widens every row of the list to it: the `vs` stays in one column', async () => {
    await cmdToday('2026-10-04', ctxFor(adapterOf([
      club('1', ['IRI', 'Independiente Rivadavia'], ['BOC', 'Boca Juniors']),
      club('2', ['RIV', 'River Plate'], ['FLA', 'Flamengo']),
      club('3', ['PEN', 'Peñarol'], ['NAC', 'Nacional']),
    ])));
    const lines = rows();
    expect(lines).toHaveLength(3);
    const columns = new Set(lines.map(vsColumn));
    expect([...columns]).toEqual([2 + displayWidth('Independiente Rivadavia') + 2]);
    expect(writes.join('')).not.toMatch(/\S {2}\S\s+vs/); // no row carries a gap where a flag would be
  });

  it('a cell past 32 columns pushes its own row only (the cap)', async () => {
    const long = 'Club Deportivo Universidad de San Martín de Porres';
    await cmdToday('2026-10-04', ctxFor(adapterOf([club('1', ['USM', long], ['ALI', 'Alianza Lima']), club('2', ['CRI', 'Sporting Cristal'], ['UNI', 'Universitario'])])));
    const lines = rows();
    expect(lines).toHaveLength(2);
    const [wide, other] = lines.map(vsColumn) as [number, number];
    expect(other).toBe(2 + 32 + 2);
    expect(wide).toBeGreaterThan(other);
  });

  it('`live` measures its own list the same way', async () => {
    const inPlay = (m: Match): Match => ({ ...m, status: 'LIVE', minute: 30, score: { home: 0, away: 0 } });
    const fixtures = [
      inPlay(club('1', ['IRI', 'Independiente Rivadavia'], ['BOC', 'Boca Juniors'])),
      inPlay(club('2', ['RIV', 'River Plate'], ['FLA', 'Flamengo'])),
    ];
    const adapter: ProviderAdapter = { ...adapterOf(fixtures), async fetchLive() { return fixtures; } };
    await cmdLive(ctxFor(adapter));
    const lines = writes.join('').split('\n').filter((l) => /0–0/.test(l));
    expect(lines).toHaveLength(2);
    // "  " + the cell + " " + the score (a score has no leading pad; `vs` does).
    const columns = new Set(lines.map((l) => displayWidth(l.slice(0, l.indexOf('0–0')))));
    expect([...columns]).toEqual([2 + displayWidth('Independiente Rivadavia') + 1]);
  });

  it('a bundled knockout day the feed does not serve: the placeholder homes widen the list, and every row keeps one column', async () => {
    // The corpus serves every pairing, so the recorded World Cup days are
    // byte-identical; a DEGRADED knockout day still has its 🏳️ placeholders at
    // home ("Round of 32 1 Winner" is 23 columns with its flag), and the rule
    // widens that list to them. Stated in the description; pinned here.
    const failing: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() { throw new Error('down'); },
      async fetchLive() { throw new Error('down'); },
      async fetchWindow() { throw new Error('down'); },
    };
    process.env.CLAUDINHO_FLAGS = 'on';
    try {
      await cmdToday('2026-07-06', ctxFor(failing, { tz: 'UTC' }));
    } finally {
      delete process.env.CLAUDINHO_FLAGS;
    }
    const lines = rows();
    expect(lines.length).toBeGreaterThan(1);
    const columns = new Set(lines.map(vsColumn));
    expect(columns.size).toBe(1);
    expect([...columns][0]).toBeGreaterThan(26);
  });

  it('a nations list with flags measures the cell with its flag', async () => {
    const nation = (id: string, home: [string, string, string], away: [string, string, string]): Match => ({
      ...club(id, [home[0], home[1]], [away[0], away[1]]),
      home: { code: home[0], name: home[1], flag: home[2], id: `espn:${home[0]}` },
      away: { code: away[0], name: away[1], flag: away[2], id: `espn:${away[0]}` },
      stage: 'LEAGUE',
    });
    process.env.CLAUDINHO_FLAGS = 'on';
    try {
      await cmdToday('2026-10-04', ctxFor(adapterOf([
        nation('1', ['BIH', 'Bosnia and Herzegovina', '🇧🇦'], ['ALB', 'Albania', '🇦🇱']),
        nation('2', ['LVA', 'Latvia', '🇱🇻'], ['AND', 'Andorra', '🇦🇩']),
      ], 'uefa.nations')));
    } finally {
      delete process.env.CLAUDINHO_FLAGS;
    }
    const lines = rows();
    expect(lines).toHaveLength(2);
    const columns = new Set(lines.map(vsColumn));
    expect([...columns]).toEqual([2 + displayWidth('🇧🇦 Bosnia and Herzegovina') + 2]);
  });
});

describe('"¿Y si sí?" is Mexico\'s, by identity and competition', () => {
  const live = (home: Match['home'], over: Partial<Match> = {}): Match => ({
    id: '1',
    stage: 'GROUP',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home,
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'LIVE',
    minute: 67,
    score: { home: 1, away: 0 },
    updatedAt: '2026-06-11T20:07Z',
    ...over,
  });
  const line = (m: Match, competition: string) => matchLine(m, cfg({ competition }), makeT('en'), painterFor(cfg({ competition })));

  it('the bundle\'s Mexico (no id) and Mexico by its id in a nations competition', () => {
    expect(line(live({ code: 'MEX', name: 'Mexico', flag: '🇲🇽' }), 'fifa.world')).toContain('¿Y si sí?');
    expect(line(live({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' }, { stage: 'LEAGUE' }), 'concacaf.nations.league')).toContain('¿Y si sí?');
    expect(line(live({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' }, { stage: 'GROUP' }), 'concacaf.gold')).toContain('¿Y si sí?');
  });

  it('never a club coded MEX, never another team with the code, never off a nations competition', () => {
    expect(line(live({ code: 'MEX', name: 'Club Mexico', id: 'espn:9999' }, { stage: 'REGULAR' }), 'mex.1')).not.toContain('¿Y si sí?');
    expect(line(live({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:9999' }), 'concacaf.gold')).not.toContain('¿Y si sí?');
    expect(line(live({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' }, { stage: 'REGULAR' }), 'eng.1')).not.toContain('¿Y si sí?');
  });

  it('a club line prints the name alone, no flag, no gap', () => {
    const l = line(live({ code: 'ARS', name: 'Arsenal', id: 'espn:359' }, { stage: 'REGULAR', away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' } }), 'eng.1');
    expect(l).toMatch(/^\s+Arsenal\s+1–0\s+Chelsea/);
    expect(l).not.toContain('undefined');
    expect(l).not.toContain('🏳️');
  });
});
