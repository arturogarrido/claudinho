/**
 * A competition by its alias, its slug, its name or a written short form, in
 * ONE grammar (`competitionValue`), so the flag, `CLAUDINHO_COMPETITION`, the
 * saved choice and the MCP `competition` argument accept the same values. A
 * name is matched with case, accents, spaces, hyphens and underscores ignored;
 * a value with a dot keeps the slug grammar. A near miss is REFUSED and names
 * at most two aliases, nearest first, by three written steps; a prefix is never
 * accepted. Short forms and other names live in the supported table (two
 * columns), refused at load when two rows share one.
 */
import { describe, expect, it } from 'vitest';
import {
  type CompetitionEntry,
  competitionValue,
  deriveTables,
  parseDayArg,
  resolveCompetition,
  selectionRefusal,
  suggestCompetitions,
  SUPPORTED,
} from '../src';

const slugOf = (v: string) => {
  const got = competitionValue(v);
  return got && 'row' in got ? got.row.slug : got && 'raw' in got ? `raw:${got.raw}` : undefined;
};

/** Every value a row accepts by name, after the ignored characters. */
const ACCEPTED: Record<string, string[]> = {
  'fifa.world': ['world-cup', 'fifa.world', 'World Cup', 'world cup', 'WORLDCUP', 'FIFA World Cup', 'wc', 'WC'],
  'uefa.euro': ['euro', 'EURO', 'euros', 'European Championship'],
  'conmebol.america': ['copa-america', 'Copa América', 'Copa America', 'copa américa', 'COPA_AMERICA'],
  'uefa.nations': ['nations-league', 'UEFA Nations League', 'unl'],
  'concacaf.nations.league': ['concacaf-nations-league', 'Concacaf Nations League', 'cnl'],
  'concacaf.gold': ['gold-cup', 'Gold Cup', 'Concacaf Gold Cup', 'gold'],
  'eng.1': ['premier-league', 'eng.1', 'Premier League', 'premier league', 'PREMIER-LEAGUE', 'premierleague', 'premier_league', 'English Premier League', 'epl', 'EPL', 'pl'],
  'esp.1': ['laliga', 'LALIGA', 'La Liga', 'LA LIGA', 'la-liga'],
  'ita.1': ['serie-a', 'Serie A', 'seriea'],
  'ger.1': ['bundesliga', 'Bundesliga', 'buli'],
  'mex.1': ['liga-mx', 'Liga MX', 'lmx'],
  'uru.1': ['liga-auf', 'Liga AUF Uruguaya', 'auf'],
  'uefa.champions': ['champions-league', 'Champions League', 'UEFA Champions League', 'ucl', 'cl'],
  'conmebol.libertadores': ['libertadores', 'Libertadores', 'Copa Libertadores', 'CONMEBOL Libertadores'],
  'concacaf.champions': ['concacaf-champions-cup', 'Concacaf Champions Cup', 'ccc'],
  'fifa.cwc': ['club-world-cup', 'Club World Cup', 'FIFA Club World Cup', 'cwc'],
};

/** The written short forms, per row (the `shortForms` column). */
const SHORT: Record<string, string[]> = {
  'fifa.world': ['wc'], 'uefa.euro': ['euros'], 'conmebol.america': [], 'uefa.nations': ['unl'],
  'concacaf.nations.league': ['cnl'], 'concacaf.gold': ['gold'], 'eng.1': ['epl', 'pl'], 'esp.1': [], 'ita.1': [],
  'ger.1': ['buli'], 'mex.1': ['lmx'], 'uru.1': ['auf'], 'uefa.champions': ['ucl', 'cl'], 'conmebol.libertadores': [],
  'concacaf.champions': ['ccc'], 'fifa.cwc': ['cwc'],
};
/** The other names, per row (the `otherNames` column). */
const OTHER: Record<string, string[]> = {
  'fifa.world': ['FIFA World Cup'], 'uefa.euro': ['European Championship'], 'conmebol.america': [], 'uefa.nations': [],
  'concacaf.nations.league': [], 'concacaf.gold': ['Concacaf Gold Cup'], 'eng.1': ['English Premier League'], 'esp.1': [],
  'ita.1': [], 'ger.1': [], 'mex.1': [], 'uru.1': [], 'uefa.champions': ['UEFA Champions League'],
  'conmebol.libertadores': ['Copa Libertadores', 'CONMEBOL Libertadores'], 'concacaf.champions': [], 'fifa.cwc': ['FIFA Club World Cup'],
};

/** The same normalization the grammar documents: what a test compares keys by. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ _-]/g, '');

describe('the two columns', () => {
  it('each row carries its written short forms and other names', () => {
    for (const e of SUPPORTED) {
      expect([...(e.shortForms ?? [])], e.slug).toEqual(SHORT[e.slug]);
      expect([...(e.otherNames ?? [])], e.slug).toEqual(OTHER[e.slug]);
    }
  });

  it('every key (alias, name, other name, short form) belongs to ONE row', () => {
    const owner = new Map<string, string>();
    for (const e of SUPPORTED) {
      const keys = new Set([e.alias, e.name, ...(e.otherNames ?? []), ...(e.shortForms ?? [])].map(norm));
      for (const k of keys) {
        expect(owner.get(k), `${k} is ${owner.get(k)}'s and ${e.slug}'s`).toBeUndefined();
        owner.set(k, e.slug);
      }
    }
  });

  it('no key is a word an argument already means: `off`, or a day word (`today`, `sat`, `tomorrow`)', () => {
    for (const e of SUPPORTED) {
      for (const k of [e.alias, e.name, ...(e.otherNames ?? []), ...(e.shortForms ?? [])]) {
        expect(norm(k), k).not.toBe('off');
        expect(parseDayArg(norm(k)), k).toBeUndefined();
      }
    }
  });

  it('a short form is 2 to 6 lower-case letters or digits, never a slug and never another row\'s alias', () => {
    for (const e of SUPPORTED) {
      for (const s of e.shortForms ?? []) {
        expect(s, e.slug).toMatch(/^[a-z0-9]{2,6}$/);
        for (const other of SUPPORTED) {
          if (other === e) continue;
          expect(norm(other.alias), s).not.toBe(s);
          expect(other.slug, s).not.toBe(s);
        }
      }
    }
  });

  const FAKE: CompetitionEntry = {
    slug: 'fra.1', alias: 'ligue-1', name: 'Ligue 1', teams: 'club', kind: 'league', standings: 'league',
    bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1,
  };
  it('a table whose rows share a key is refused at load, naming it', () => {
    expect(() => deriveTables([...SUPPORTED, FAKE])).not.toThrow();
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, shortForms: ['epl'] }])).toThrow(/epl/);
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, otherNames: ['Premier League'] }])).toThrow(/premierleague|Premier League/);
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, otherNames: ['premier_league'] }])).toThrow();
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, shortForms: ['bundesliga'] }])).toThrow();
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, name: 'Serie A' }])).toThrow();
  });

  it('a short form outside its grammar is refused at load', () => {
    for (const bad of ['L1', 'l', 'ligueun1', 'l.1', 'l 1', 'é1']) {
      expect(() => deriveTables([...SUPPORTED, { ...FAKE, shortForms: [bad] }]), bad).toThrow();
    }
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, shortForms: ['l1'] }])).not.toThrow();
  });
});

describe('competitionValue: one grammar for every source', () => {
  it('accepts each row\'s alias, slug, name, other names and short forms, case, accents, spaces, hyphens and underscores ignored', () => {
    for (const [slug, values] of Object.entries(ACCEPTED)) {
      for (const v of values) expect(slugOf(v), v).toBe(slug);
    }
  });

  it('a value with a dot keeps the slug grammar: raw slugs as before, anything else refused', () => {
    expect(slugOf('fifa.friendly')).toBe('raw:fifa.friendly');
    expect(slugOf('esp.copa_del_rey')).toBe('raw:esp.copa_del_rey');
    for (const v of ['ENG.1', 'Eng.1', 'eng.1 ', 'é.1', 'premier.League', '.epl', 'epl.']) expect(slugOf(v), v).toBeUndefined();
  });

  it('refuses a prefix, a near miss, a nation\'s name, a league the table does not hold, and anything outside the characters a name is made of', () => {
    for (const v of ['premier', 'champions', 'nations', 'liga', 'copa', 'uruguay', 'bundesliag', 'mls', 'foo', 'constructor', 'toString', '__proto__',
      'premier\tleague', 'premier league', 'premier​league', 'pre\u0007mier', 'epl‮', '', 'x'.repeat(200), 'premier league'.repeat(10)]) {
      expect(slugOf(v), JSON.stringify(v)).toBeUndefined();
    }
  });

  it('every source resolves through it, to the canonical row', () => {
    expect(resolveCompetition('Premier League')).toEqual({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag', experimental: false });
    expect(resolveCompetition(undefined, 'ucl')).toMatchObject({ kind: 'selected', slug: 'uefa.champions', alias: 'champions-league', chosenBy: 'env' });
    expect(resolveCompetition(undefined, undefined, 'epl')).toMatchObject({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', chosenBy: 'saved' });
  });
});

describe('suggestCompetitions: at most two aliases, nearest first, by three written steps', () => {
  const TABLE: Array<[string, string[]]> = [
    // Step 1: an alias, a name, an other name or a short form STARTS with the input (3 characters or more).
    ['premier', ['premier-league']],
    ['Premier', ['premier-league']],
    ['serie', ['serie-a']],
    ['copa', ['copa-america', 'libertadores']],
    ['liga', ['liga-mx', 'liga-auf']],
    // Step 2: a later WORD of an alias, a name or an other name starts with it (after every step-1 row).
    ['champions', ['champions-league', 'concacaf-champions-cup']],
    ['nations', ['nations-league', 'concacaf-nations-league']],
    ['world', ['world-cup', 'club-world-cup']],
    ['uruguay', ['liga-auf']],
    ['cup', ['world-cup', 'gold-cup']],
    // Step 3: within 2 edits of a whole key (5 characters or more), nearest first.
    ['bundesliag', ['bundesliga']],
    ['premeir league', ['premier-league']],
    ['bundeslga', ['bundesliga']],
    // Nothing near: no suggestion.
    ['mls', []],
    ['foo', []],
    ['pr', []],
    ['ENG.1', []],
    ['fifa.friendlyy', []],
    ['', []],
    ['x'.repeat(200), []],
    ['premier'.repeat(30), []],
    ['pre\u0007mier', []],
    ['premier​', []],
    ['constructor', []],
  ];
  for (const [input, want] of TABLE) {
    it(`${JSON.stringify(input.length > 30 ? `${input.slice(0, 20)}…(${input.length})` : input)} → ${want.join(', ') || 'nothing'}`, () => {
      expect(suggestCompetitions(input)).toEqual(want);
      // Deterministic: asked again, the same answer.
      expect(suggestCompetitions(input)).toEqual(want);
    });
  }

  it('never more than two, never a value that resolves (an exact match is not a near miss)', () => {
    for (const e of SUPPORTED) {
      for (const v of [e.alias, e.name, ...(e.shortForms ?? [])]) expect(suggestCompetitions(v), v).toEqual([]);
    }
    for (const v of ['c', 'co', 'con', 'conc', 'concacaf', 'uefa', 'fifa', 'league', 'la', 'a']) {
      expect(suggestCompetitions(v).length, v).toBeLessThanOrEqual(2);
    }
  });

  it('a refused selection carries them', () => {
    const r = resolveCompetition('premier');
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.suggestions).toEqual(['premier-league']);
    const m = resolveCompetition(undefined, 'mls');
    if (m.kind === 'refused') expect(m.suggestions).toEqual([]);
  });
});

describe('the refusal: the value echoed as a label, the suggestion, then the aliases', () => {
  const aliases = SUPPORTED.map((e) => e.alias).join(', ');
  const refusal = (v: string, lang?: string) => selectionRefusal(resolveCompetition(v), lang);

  it('one suggestion, two, none (en)', () => {
    expect(refusal('premier', 'en')).toBe(`Unknown competition "premier". Did you mean premier-league?\nAliases: ${aliases}. Or an ESPN slug such as eng.1.`);
    expect(refusal('champions', 'en')).toBe(`Unknown competition "champions". Did you mean champions-league or concacaf-champions-cup?\nAliases: ${aliases}. Or an ESPN slug such as eng.1.`);
    expect(refusal('mls', 'en')).toBe(`Unknown competition "mls".\nAliases: ${aliases}. Or an ESPN slug such as eng.1.`);
    expect(refusal('mls')).toBe(refusal('mls', 'en'));
  });

  it('es, pt, fr', () => {
    expect(refusal('premier', 'es')).toBe(`Competición desconocida "premier". ¿Quisiste decir premier-league?\nAlias: ${aliases}. O un slug de ESPN como eng.1.`);
    expect(refusal('champions', 'es')).toContain('¿Quisiste decir champions-league o concacaf-champions-cup?');
    expect(refusal('premier', 'pt')).toBe(`Competição desconhecida "premier". Você quis dizer premier-league?\nAliases: ${aliases}. Ou um slug da ESPN como eng.1.`);
    expect(refusal('champions', 'pt')).toContain('Você quis dizer champions-league ou concacaf-champions-cup?');
    expect(refusal('premier', 'fr')).toBe(`Compétition inconnue « premier ». Vouliez-vous dire premier-league ?\nAlias : ${aliases}. Ou un slug ESPN comme eng.1.`);
    expect(refusal('champions', 'fr')).toContain('Vouliez-vous dire champions-league ou concacaf-champions-cup ?');
    expect(refusal('mls', 'fr')).toBe(`Compétition inconnue « mls ».\nAlias : ${aliases}. Ou un slug ESPN comme eng.1.`);
  });

  it('the typed value goes through the human-label rule before it is echoed: bounded, no control or format character', () => {
    for (const v of ['pre\u0007mier', 'epl‮', 'a\u001b[31mred', 'x​y', 'line\nbreak']) {
      const msg = refusal(v, 'en') ?? '';
      const first = msg.split('\n')[0] ?? '';
      expect(first, JSON.stringify(v)).not.toMatch(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/);
    }
    const long = refusal('x'.repeat(200), 'en') ?? '';
    const first = long.split('\n')[0] ?? '';
    expect(first.length).toBeLessThan(80);
    expect(long).not.toContain('Did you mean');
  });
});
