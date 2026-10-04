/**
 * The selection's rules the acceptance tests do not reach on their own
 * (0.11 · 2.5a): the raw slug's length bound, the resolver reading no
 * environment, the one constructor of a selected value, the refusal sentence
 * (localized, bounded, naming every alias), the request wording of the mode
 * line, and the README matrix's cells against core's capability rule.
 */
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  capabilitiesOf,
  type CompetitionEntry,
  deriveTables,
  listCompetitions,
  modeLine,
  resolveCompetition,
  selectedCompetition,
  selectionRefusal,
  SUPPORTED,
} from '../src';

const ORIG = process.env.CLAUDINHO_COMPETITION;
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('the resolver', () => {
  it('a raw slug is believed up to 64 units, and refused past them', () => {
    const at64 = `a.${'b'.repeat(62)}`;
    const at65 = `a.${'b'.repeat(63)}`;
    expect(at64).toHaveLength(64);
    expect(resolveCompetition(at64)).toMatchObject({ kind: 'selected', slug: at64, experimental: true });
    expect(resolveCompetition(at65).kind).toBe('refused');
  });

  it('reads no environment: only what its edge hands in', () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(resolveCompetition()).toMatchObject({ slug: 'fifa.world', chosenBy: 'default' });
    expect(resolveCompetition(undefined, process.env.CLAUDINHO_COMPETITION)).toMatchObject({ slug: 'eng.1', chosenBy: 'env' });
  });

  it('every selected value comes from one constructor: the table describes a slug it holds, a raw one is itself', () => {
    expect(selectedCompetition('esp.1', 'env')).toEqual({ kind: 'selected', slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'env', experimental: false });
    expect(selectedCompetition('usa.1', 'flag')).toEqual({ kind: 'selected', slug: 'usa.1', name: 'usa.1', chosenBy: 'flag', experimental: true });
    // The resolver's answer for an alias is exactly the constructor's.
    expect(resolveCompetition('laliga')).toEqual(selectedCompetition('esp.1', 'flag'));
  });
});

describe('the derived views have no prototype', () => {
  it('a row named like the prototype key is an own key of every view', () => {
    const proto = { ...SUPPORTED[0], slug: '__proto__', alias: 'proto' } as CompetitionEntry;
    const views = deriveTables([...SUPPORTED, proto]);
    expect(Object.hasOwn(views.teamKind, '__proto__')).toBe(true);
    expect(Object.hasOwn(views.cadenceYears, '__proto__')).toBe(true);
  });
});

describe('a listing states each row\'s own capabilities, from the table it is given', () => {
  it('a sixteenth row unlike a raw slug: no table, no bracket, markets offered', () => {
    const odd: CompetitionEntry = { ...SUPPORTED[0], slug: 'xyz.1', alias: 'xyz', name: 'XYZ', standings: 'none', bracket: 'not-applicable', markets: 'offered' } as CompetitionEntry;
    const listed = listCompetitions([...SUPPORTED, odd], null).competitions.find((c) => c.slug === 'xyz.1');
    expect(listed?.capabilities).toEqual({ scores: 'offered', next: 'offered', standings: 'not-applicable', bracket: 'not-applicable', markets: 'offered' });
  });
});

describe('the refusal', () => {
  it('names the value and every alias, in table order; nothing for a competition', () => {
    const sel = resolveCompetition('foo');
    const said = selectionRefusal(sel, 'en') ?? '';
    expect(said).toContain('"foo"');
    expect(said).toContain(SUPPORTED.map((e) => e.alias).join(', '));
    expect(selectionRefusal(resolveCompetition('eng.1'), 'en')).toBeUndefined();
  });

  it('in the reader\'s language', () => {
    const sel = resolveCompetition('foo');
    for (const lang of ['es', 'pt', 'fr']) {
      const said = selectionRefusal(sel, lang) ?? '';
      expect(said, lang).not.toBe(selectionRefusal(sel, 'en'));
      expect(said, lang).toContain('foo');
      expect(said, lang).toContain('premier-league');
    }
  });

  it('prints the value as a bounded label: no control character, no unbounded length', () => {
    const value = `\u001b[31m${'x'.repeat(500)}`;
    const said = selectionRefusal(resolveCompetition(value), 'en') ?? '';
    expect(said).not.toContain('\u001b');
    expect(said.length).toBeLessThan(400);
  });
});

describe('the mode line on a request (MCP): the flag is the request\'s argument', () => {
  const sel = selectedCompetition('eng.1', 'flag');
  it('in four locales', () => {
    expect(modeLine(sel, 'en', 'request')).toBe('Premier League · from the request');
    expect(modeLine(sel, 'es', 'request')).toBe('Premier League · desde la solicitud');
    expect(modeLine(sel, 'pt', 'request')).toBe('Premier League · da solicitação');
    expect(modeLine(sel, 'fr', 'request')).toBe('Premier League · depuis la requête');
  });

  it('the environment and the default read the same on both surfaces', () => {
    expect(modeLine(selectedCompetition('eng.1', 'env'), 'en', 'request')).toBe('Premier League · from the environment');
    expect(modeLine(selectedCompetition('fifa.world', 'default'), 'en', 'request')).toBe('World Cup');
  });

  it('a refused selection has no line', () => {
    expect(modeLine(resolveCompetition('foo'), 'en')).toBe('');
  });
});

describe('the README matrix states core\'s capability rule, cell by cell', () => {
  const SCRIPT = fileURLToPath(new URL('../../../scripts/gen-readme-matrix.mjs', import.meta.url));
  const CELL: Record<string, string> = { offered: 'yes', 'not-offered-yet': 'not yet', 'not-applicable': 'n/a' };
  const fake: CompetitionEntry = {
    slug: 'fra.1',
    alias: 'ligue-1',
    name: 'Ligue 1',
    teams: 'club',
    kind: 'league',
    standings: 'none',
    bracket: 'not-applicable',
    markets: 'offered',
    cadenceYears: 1,
  };

  it('every row of the table, a sixteenth included, renders capabilitiesOf', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as { renderMatrix: (table: readonly unknown[]) => string };
    const table = [...SUPPORTED, fake];
    const rows = renderMatrix(table)
      .split('\n')
      .filter((l) => l.startsWith('| `'));
    expect(rows).toHaveLength(table.length);
    table.forEach((entry, i) => {
      const cells = (rows[i] ?? '').split('|').map((c) => c.trim()).filter(Boolean);
      const caps = capabilitiesOf(entry.slug, table);
      expect(cells.slice(3), entry.slug).toEqual([caps.scores, caps.next, caps.standings, caps.bracket, caps.markets].map((c) => CELL[c]));
    });
  });
});
