/**
 * The commentary bank (0.11 · 2.7b): the banks Arturo approved, exactly; a
 * list of matches gets DISTINCT phrases while the bank allows (`flavorsFor`);
 * three more moments (`ht`, `late`, `draw`); and the team rally cries, a table
 * keyed by the provider id (`rallyCryFor`), of which Mexico's "¿Y si sí?" was
 * the one hard-coded case. The approved content is pinned to the fixtures
 * `fixtures/flavor-bank.approved.json` and `fixtures/rally-cries.approved.json`:
 * a change to a phrase is a change to the fixture, made on purpose.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLAVOR_BANKS, flavorsFor, matchFlavor, RALLY_CRIES, rallyCryFor } from '../src';
import type { Match, Team } from '../src';

const approved = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/flavor-bank.approved.json', import.meta.url)), 'utf8')) as {
  banks: Record<string, Record<string, string[]>>;
};
const approvedCries = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rally-cries.approved.json', import.meta.url)), 'utf8')) as {
  cries: { id: string; code: string; name: string; kind: 'nation' | 'club'; cry: string }[];
};

const LANGS = ['en', 'es', 'pt', 'fr'] as const;
const MOMENTS = ['scheduled', 'live', 'goal', 'ht', 'late', 'ft', 'draw'] as const;
type Moment = (typeof MOMENTS)[number];

function match(over: Partial<Match> = {}): Match {
  return {
    id: '800000001',
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: 'Emirates Stadium',
    home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
    away: { code: 'LEE', name: 'Leeds United', id: 'espn:357' },
    status: 'SCHEDULED',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...over,
  };
}
const live = (minute: number, home: number, away: number): Match => match({ status: 'LIVE', minute, score: { home, away } });
const bankOf = (lang: string, moment: Moment): readonly string[] => FLAVOR_BANKS[lang]?.[moment] ?? [];

describe('the approved banks, exactly', () => {
  it('ships the phrases Arturo approved, per language and moment, in the approved order', () => {
    for (const lang of LANGS) {
      for (const moment of MOMENTS) {
        expect(bankOf(lang, moment), `${lang}/${moment}`).toEqual(approved.banks[lang]?.[moment]);
      }
    }
    expect(Object.keys(FLAVOR_BANKS).sort()).toEqual([...LANGS].sort());
  });

  it('every bank is at least ten deep, with no duplicate', () => {
    for (const lang of LANGS) {
      for (const moment of MOMENTS) {
        const bank = bankOf(lang, moment);
        expect(bank.length, `${lang}/${moment}`).toBeGreaterThanOrEqual(10);
        expect(new Set(bank.map((p) => p.toLowerCase())).size, `${lang}/${moment} duplicates`).toBe(bank.length);
      }
    }
  });

  it('every phrase keeps the shape: under 40 characters, one to seven words, ends with ! or ?, no dash, no emoji, no betting word', () => {
    const BET = /\b(bet(s|ting)?|wager(s|ing)?|odds|parlays?|apuestas?|apost\w*|paris?|cotes?)\b/i;
    for (const lang of LANGS) {
      for (const moment of MOMENTS) {
        for (const p of bankOf(lang, moment)) {
          const label = `${lang}/${moment}: ${p}`;
          expect(p.length, label).toBeLessThan(40);
          const words = p.split(/\s+/).length;
          expect(words, label).toBeGreaterThanOrEqual(1);
          expect(words, label).toBeLessThanOrEqual(7);
          expect(p, label).toMatch(/[!?]$/);
          if (lang === 'fr') expect(p, label).toMatch(/ [!?]$/);
          if (lang === 'es') expect(p, label).toMatch(/^[¡¿]/);
          expect(p, label).not.toMatch(/[–—]/);
          expect([...p].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1f000 || /[☀-➿]/.test(ch)), `${label}: emoji`).toBe(false);
          expect(p, label).not.toMatch(BET);
        }
      }
    }
  });
});

describe('flavorsFor: a list gets distinct phrases while the bank allows', () => {
  it('eight scheduled fixtures get eight different phrases, in every language', () => {
    const list = Array.from({ length: 8 }, (_, i) => match({ id: String(800000100 + i) }));
    for (const lang of LANGS) {
      const out = flavorsFor(list, { level: 'full', locale: lang });
      expect(out.length).toBe(8);
      expect(new Set(out).size, lang).toBe(8);
      for (const p of out) expect(bankOf(lang, 'scheduled'), lang).toContain(p);
    }
  });

  it('is deterministic for the same list, and the first row keeps its single-match phrase', () => {
    const list = Array.from({ length: 6 }, (_, i) => match({ id: String(800000200 + i) }));
    const a = flavorsFor(list, { level: 'full', locale: 'en' });
    const b = flavorsFor(list, { level: 'full', locale: 'en' });
    expect(a).toEqual(b);
    expect(a[0]).toBe(matchFlavor(list[0] as Match, { level: 'full', locale: 'en' }));
  });

  it('a single match through flavorsFor is matchFlavor', () => {
    for (const m of [match(), live(30, 0, 0), live(30, 1, 0), live(85, 2, 2), match({ status: 'HT', score: { home: 0, away: 0 } }), match({ status: 'FT', score: { home: 1, away: 1 } })]) {
      expect(flavorsFor([m], { level: 'full', locale: 'es' })).toEqual([matchFlavor(m, { level: 'full', locale: 'es' })]);
    }
  });

  it('past the bank, the phrases repeat (never empty), and the moments mix within one list', () => {
    const depth = bankOf('en', 'draw').length;
    const draws = Array.from({ length: depth + 3 }, (_, i) => match({ id: String(800000300 + i), status: 'FT', score: { home: 1, away: 1 } }));
    const out = flavorsFor(draws, { level: 'full', locale: 'en' });
    expect(out.every((p) => p !== '')).toBe(true);
    expect(new Set(out.slice(0, depth)).size).toBe(depth);
    const mixed = [match({ id: '1' }), live(10, 0, 0), live(10, 1, 0), match({ id: '4' })];
    const got = flavorsFor(mixed, { level: 'full', locale: 'pt' });
    expect(bankOf('pt', 'scheduled')).toContain(got[0]);
    expect(bankOf('pt', 'live')).toContain(got[1]);
    expect(bankOf('pt', 'goal')).toContain(got[2]);
    expect(bankOf('pt', 'scheduled')).toContain(got[3]);
    expect(got[0]).not.toBe(got[3]);
  });

  it('the level gates the list as it gates one match: off is silent, subtle narrates goals and full time only', () => {
    const list = [match(), live(10, 0, 0), live(10, 1, 0), live(85, 0, 0), match({ status: 'HT' }), match({ status: 'FT', score: { home: 2, away: 0 } }), match({ status: 'FT', score: { home: 0, away: 0 } })];
    expect(flavorsFor(list, { level: 'off', locale: 'en' })).toEqual(['', '', '', '', '', '', '']);
    const subtle = flavorsFor(list, { level: 'subtle', locale: 'en' });
    expect(subtle.slice(0, 2)).toEqual(['', '']);
    expect(subtle[2]).not.toBe('');
    expect(subtle[3]).toBe('');
    expect(subtle[4]).toBe('');
    expect(subtle[5]).not.toBe('');
    expect(subtle[6]).not.toBe('');
  });
});

describe('the moments: half-time, the late minutes, a draw', () => {
  it('half-time is its own moment at any score', () => {
    for (const lang of LANGS) {
      expect(bankOf(lang, 'ht')).toContain(matchFlavor(match({ status: 'HT', score: { home: 0, away: 0 } }), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'ht')).toContain(matchFlavor(match({ status: 'HT', score: { home: 2, away: 1 } }), { level: 'full', locale: lang }));
    }
  });

  it('minute 80 and after is late, at any score; 79 is still live or goal', () => {
    for (const lang of LANGS) {
      expect(bankOf(lang, 'late')).toContain(matchFlavor(live(80, 0, 0), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'late')).toContain(matchFlavor(live(90, 3, 2), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'live')).toContain(matchFlavor(live(79, 0, 0), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'goal')).toContain(matchFlavor(live(79, 1, 0), { level: 'full', locale: lang }));
    }
    // A live minute nobody stated is not late.
    expect(bankOf('en', 'live')).toContain(matchFlavor(match({ status: 'LIVE', score: { home: 0, away: 0 } }), { level: 'full', locale: 'en' }));
  });

  it('a level full time is a draw, a decided one is ft', () => {
    for (const lang of LANGS) {
      expect(bankOf(lang, 'draw')).toContain(matchFlavor(match({ status: 'FT', score: { home: 0, away: 0 } }), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'draw')).toContain(matchFlavor(match({ status: 'FT', score: { home: 2, away: 2 } }), { level: 'full', locale: lang }));
      expect(bankOf(lang, 'ft')).toContain(matchFlavor(match({ status: 'FT', score: { home: 1, away: 0 } }), { level: 'full', locale: lang }));
    }
  });

  it('subtle narrates the draw, not the break nor the late minutes', () => {
    expect(matchFlavor(match({ status: 'FT', score: { home: 1, away: 1 } }), { level: 'subtle' })).not.toBe('');
    expect(matchFlavor(match({ status: 'HT', score: { home: 1, away: 1 } }), { level: 'subtle' })).toBe('');
    expect(matchFlavor(live(88, 1, 1), { level: 'subtle' })).toBe('');
  });

  it('postponed and cancelled stay sober, in a list too', () => {
    const sober = [match({ status: 'POSTPONED' }), match({ status: 'CANCELLED' })];
    expect(flavorsFor(sober, { level: 'full', locale: 'en' })).toEqual(['', '']);
  });
});

describe('the team rally cries', () => {
  const mex: Team = { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' };
  const bundledMex: Team = { code: 'MEX', name: 'Mexico', flag: '🇲🇽' };
  const pumas: Team = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
  const america: Team = { code: 'AME', name: 'América', id: 'espn:227' };
  const necaxa: Team = { code: 'NCX', name: 'Necaxa', id: 'espn:229' }; // a club with no cry in the table
  const clubMex: Team = { code: 'MEX', name: 'Mexico FC', id: 'espn:99999' };
  const rsa: Team = { code: 'RSA', name: 'South Africa', flag: '🇿🇦', id: 'espn:467' }; // a nation with no cry in the table

  it('ships the cries Arturo approved, exactly, keyed by the provider id', () => {
    expect(RALLY_CRIES).toEqual(approvedCries.cries);
    const ids = RALLY_CRIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of RALLY_CRIES) {
      expect(c.id).toMatch(/^espn:\d+$/);
      expect(c.cry.length).toBeLessThan(40);
      expect(c.cry).not.toMatch(/[–—]/);
    }
  });

  it("Mexico's is '¿Y si sí?', by id in any nations competition, and by code and name for the bundle's id-less Mexico", () => {
    expect(rallyCryFor(match({ home: mex, away: rsa }), 'nation')).toBe('¿Y si sí?');
    expect(rallyCryFor(match({ home: rsa, away: mex }), 'nation')).toBe('¿Y si sí?');
    expect(rallyCryFor(match({ home: bundledMex, away: rsa }), 'nation')).toBe('¿Y si sí?');
    // An id-less side is believed by code and name on a nations competition only: a club coded MEX is not Mexico.
    expect(rallyCryFor(match({ home: clubMex, away: necaxa }), 'club')).toBeUndefined();
    expect(rallyCryFor(match({ home: { code: 'MEX', name: 'Mexico FC' }, away: necaxa }), 'club')).toBeUndefined();
  });

  it("a club's cry by its id, the same id in every competition", () => {
    expect(rallyCryFor(match({ home: pumas, away: necaxa }), 'club')).toBe('¡Goya!');
    expect(rallyCryFor(match({ home: necaxa, away: pumas }), 'club')).toBe('¡Goya!');
    expect(rallyCryFor(match({ home: { ...pumas, code: 'PUM' }, away: necaxa }), 'club')).toBe('¡Goya!');
    expect(rallyCryFor(match({ home: { code: 'UNAM', name: 'Pumas UNAM' }, away: necaxa }), 'club')).toBeUndefined(); // no id: no claim
  });

  it("when both sides have one, the pinned side's wins, else the home side's", () => {
    const clasico = match({ home: america, away: pumas });
    expect(rallyCryFor(clasico, 'club')).toBe('¡Ódiame más!');
    expect(rallyCryFor(clasico, 'club', { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM' })).toBe('¡Goya!');
    expect(rallyCryFor(clasico, 'club', { id: 'espn:227', code: 'AME', name: 'América' })).toBe('¡Ódiame más!');
    // A pin for neither side changes nothing.
    expect(rallyCryFor(clasico, 'club', { id: 'espn:229', code: 'NCX', name: 'Necaxa' })).toBe('¡Ódiame más!');
  });

  it('a side with no cry leaves the moment phrase in place: the rally is not in the bank', () => {
    const m = match({ home: necaxa, away: { code: 'PUE', name: 'Puebla', id: 'espn:231' } }); // neither side in the table
    expect(rallyCryFor(m, 'club')).toBeUndefined();
    for (const lang of LANGS) {
      for (const moment of MOMENTS) expect(bankOf(lang, moment)).not.toContain('¿Y si sí?');
    }
  });
});
