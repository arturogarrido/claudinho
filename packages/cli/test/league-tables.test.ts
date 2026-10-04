/**
 * 0.11 PR 2.3 on the CLI: `table` and `share table` for every table shape, in
 * text and `--json`. Each case goes from a payload recorded on the real feed
 * (Oct 2 2026) through the real adapter into the command: nothing here injects
 * an already-parsed table.
 */
import { readFileSync } from 'node:fs';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputError, cmdShare, cmdTable } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { makeT } from '../src/i18n';

const recorded = (slug: string): { children: Array<Record<string, unknown>> } =>
  JSON.parse(readFileSync(new URL(`../../core/test/fixtures/standings/${slug}.json`, import.meta.url), 'utf8'));

let requests = 0;
function ctx(competition: string, over: Partial<CliConfig> = {}, payload: unknown = recorded(competition)) {
  const lang = over.lang ?? 'en';
  const cfg: CliConfig = described({ lang, tz: 'UTC', json: false, color: false, source: 'espn', competition, flavor: 'off', markets: false, ...over });
  const adapter = new EspnAdapter({
    competition,
    fetchImpl: (async () => {
      requests++;
      return new Response(JSON.stringify(payload));
    }) as unknown as typeof fetch,
  });
  return { cfg, t: makeT(lang), adapter, now: new Date('2026-10-02T12:00:00Z'), marketProvider: new FakeMarketProvider() };
}

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  requests = 0;
  writes = [];
  process.env.CLAUDINHO_NO_STAR = '1';
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
});
const text = () => writes.join('');
const json = () => JSON.parse(text());

const INCOMPLETE = {
  en: 'Some tables could not be read — this is not the whole competition.',
  es: 'No se pudieron leer algunas tablas — esta no es la competición completa.',
  pt: 'Algumas tabelas não puderam ser lidas — esta não é a competição completa.',
  fr: "Certains classements n'ont pas pu être lus — ce n'est pas la compétition complète.",
} as const;
/** A flat sibling the parser inspects and cannot name: the inventory is not whole. */
const shortOf = (slug: string) => {
  const payload = recorded(slug);
  return { children: [...payload.children.slice(0, 2), { ...payload.children[2], name: 'Second Phase' }] };
};

describe('`table` shows the table the competition has', () => {
  it('a league: one table, titled with the provider’s name and the key that selects it', async () => {
    await cmdTable(undefined, ctx('eng.1'));
    expect(text()).toContain('2026-27 English Premier League (LEAGUE)');
    expect(text()).toContain('Manchester City');
    expect(text()).toContain('ESPN');
    expect(text()).not.toContain(INCOMPLETE.en);
    // Twenty rows, the provider's first on top.
    expect(text().indexOf('Manchester City')).toBeLessThan(text().indexOf('Arsenal'));
  });

  it('a league, structured: the key, the label, twenty rows, no verdict', async () => {
    await cmdTable(undefined, ctx('eng.1', { json: true }));
    const data = json();
    expect(data).toMatchObject({ degraded: false, source: 'espn' });
    expect(data).not.toHaveProperty('incomplete');
    expect(data.tables).toHaveLength(1);
    expect(data.tables[0]).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    expect(data.tables[0].standings).toHaveLength(20);
    expect(data.tables[0].standings[0]).toMatchObject({ rank: 1, team: { id: 'espn:382', name: 'Manchester City' } });
  });

  it('the key selects it, in any case', async () => {
    await cmdTable('league', ctx('uefa.champions', { json: true }));
    const data = json();
    expect(data.tables).toMatchObject({ group: 'LEAGUE', label: 'League Phase' });
    expect(data.tables.standings).toHaveLength(36);
  });

  it('numbered groups: fourteen tables; `A1` is Group A1 and `A` is no group', async () => {
    await cmdTable(undefined, ctx('uefa.nations', { json: true }));
    expect(json().tables.map((t: { group: string }) => t.group)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2']);
    writes = [];
    await cmdTable('a1', ctx('uefa.nations'));
    expect(text()).toContain('Group A1 (A1)');
    writes = [];
    await cmdTable('A', ctx('uefa.nations'));
    expect(text()).toContain('No group found for A.');
    writes = [];
    await cmdTable('A', ctx('uefa.nations', { lang: 'es' }));
    expect(text()).toContain('No se encontró el grupo A.');
  });

  it('groups under a league: nine tables, each with its league in the title', async () => {
    await cmdTable(undefined, ctx('concacaf.nations.league'));
    for (const title of ['League A, Group A (A-A)', 'League A, Group B (A-B)', 'League B, Group D (B-D)', 'League C, Group C (C-C)']) {
      expect(text(), title).toContain(title);
    }
    writes = [];
    await cmdTable('a-b', ctx('concacaf.nations.league', { json: true }));
    expect(json().tables).toMatchObject({ group: 'A-B', label: 'League A, Group B' });
    writes = [];
    await cmdTable('B', ctx('concacaf.nations.league'));
    expect(text()).toContain('No group found for B.');
  });

  it('a lettered group keeps its localized title and gains no label', async () => {
    await cmdTable('A', ctx('uefa.euro'));
    expect(text()).toContain('Group A');
    expect(text()).not.toContain('(A)');
    writes = [];
    await cmdTable('A', ctx('uefa.euro', { lang: 'es' }));
    expect(text()).toContain('Grupo A');
    writes = [];
    await cmdTable('A', ctx('uefa.euro', { json: true }));
    expect(Object.keys(json().tables)).toEqual(['group', 'standings']);
  });

  it('a title from another table stays the provider’s (English) in every locale', async () => {
    await cmdTable(undefined, ctx('mex.1', { lang: 'pt' }));
    expect(text()).toContain('2026 Torneo Apertura (LEAGUE)');
  });

  it('a competition with no table by design says there is none, not that the provider is down', async () => {
    await cmdTable(undefined, ctx('concacaf.champions'));
    expect(text()).toContain('No standings available.');
    expect(text()).not.toContain('unavailable');
    // In every language "none" is not the outage sentence (found in review: Portuguese said "indisponível" for both).
    writes = [];
    await cmdTable(undefined, ctx('concacaf.champions', { lang: 'pt' }));
    expect(text()).toContain('Não há classificação disponível.');
    expect(text()).not.toContain('indisponível');
    writes = [];
    await cmdTable(undefined, ctx('concacaf.champions', { json: true }));
    expect(json()).toEqual({
      degraded: false,
      source: 'espn',
      tables: [],
      competition: { slug: 'concacaf.champions', alias: 'concacaf-champions-cup', name: 'Concacaf Champions Cup', chosenBy: 'saved' },
    });
  });
});

describe('tables are missing: the read says so, in text and in `--json`', () => {
  for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
    it(`all tables, ${lang}: the tables that were read, and the sentence beside them`, async () => {
      await cmdTable(undefined, ctx('uefa.euro', { lang }, shortOf('uefa.euro')));
      expect(text()).toContain(INCOMPLETE[lang]);
      expect(text()).toContain('ESPN');
    });
  }

  it('all tables, structured: `incomplete: true` beside the tables', async () => {
    await cmdTable(undefined, ctx('uefa.euro', { json: true }, shortOf('uefa.euro')));
    const data = json();
    expect(data.incomplete).toBe(true);
    expect(data.degraded).toBe(false);
    expect(data.tables.map((t: { group: string }) => t.group)).toEqual(['A', 'B']);
  });

  it('a key that was read is its table, with no verdict about the batch in either form', async () => {
    await cmdTable('A', ctx('uefa.euro', {}, shortOf('uefa.euro')));
    expect(text()).toContain('Group A');
    expect(text()).not.toContain(INCOMPLETE.en);
    writes = [];
    await cmdTable('A', ctx('uefa.euro', { json: true }, shortOf('uefa.euro')));
    expect(json()).not.toHaveProperty('incomplete');
    expect(json().tables.group).toBe('A');
  });

  it('a key that was not read is unavailable, not "no group": it may be the table that is missing', async () => {
    await cmdTable('C', ctx('uefa.euro', {}, shortOf('uefa.euro')));
    expect(text()).toContain('Live standings unavailable.');
    expect(text()).not.toContain('No group found');
    writes = [];
    await cmdTable('C', ctx('uefa.euro', { json: true }, shortOf('uefa.euro')));
    expect(json()).toEqual({
      degraded: true,
      source: null,
      tables: null,
      competition: { slug: 'uefa.euro', alias: 'euro', name: 'EURO', chosenBy: 'saved' },
    });
  });
});

describe('a table argument is a key, or it is refused before anything is asked', () => {
  it('`table`: not a key is a usage error in the reader’s language, and no request is made', async () => {
    for (const junk of ['A B', 'Group A', '../A', 'A/B', 'ABCDEFGHIJKLM', 'A\u200b', '']) {
      await expect(cmdTable(junk, ctx('uefa.euro')), JSON.stringify(junk)).rejects.toBeInstanceOf(InputError);
    }
    await expect(cmdTable('A B', ctx('uefa.euro', { lang: 'es' }))).rejects.toThrow(/No es una tabla/);
    // French says "classement" for standings; "tableau" is this product's word for the bracket.
    await expect(cmdTable('A B', ctx('uefa.euro', { lang: 'fr' }))).rejects.toThrow(/Ce n'est pas un classement/);
    expect(requests).toBe(0);
  });

  it('`share table`: the same', async () => {
    await expect(cmdShare('table', 'A B', {}, ctx('uefa.euro'))).rejects.toBeInstanceOf(InputError);
    expect(requests).toBe(0);
  });
});

describe('`share table`', () => {
  it('a league card: titled with label and key, and the card’s structured form has the label', async () => {
    await cmdShare('table', 'league', {}, ctx('eng.1'));
    expect(text()).toContain('2026-27 English Premier League (LEAGUE) · standings');
    // A card row is rank, code, points (how a club is drawn is PR 2.2's).
    expect(text()).toMatch(/1\. .*MNC {2}15 pts/);
    writes = [];
    await cmdShare('table', 'LEAGUE', {}, ctx('eng.1', { json: true }));
    const data = json();
    expect(data).toMatchObject({ kind: 'table', group: 'LEAGUE', degraded: false, source: 'espn' });
    expect(data.tables[0]).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    expect(data).not.toHaveProperty('incomplete');
  });

  it('a lettered card is what it was', async () => {
    await cmdShare('table', 'A', {}, ctx('uefa.euro'));
    expect(text()).toContain('Group A · standings');
  });

  it('every table, with one missing: the card says so in the reader’s language, like every verdict on a card, and in its structured form', async () => {
    // Found in review: the sentence was English on the card whatever the
    // language, while `table` printed it localized. A card's copy is English;
    // the one sentence it prints for a VERDICT is the localized one, on every
    // surface.
    for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
      writes = [];
      await cmdShare('table', undefined, {}, ctx('uefa.euro', { lang }, shortOf('uefa.euro')));
      expect(text(), lang).toContain(`(${INCOMPLETE[lang]})`);
      // The rest of the card stays English.
      expect(text(), lang).toContain('Group A · standings');
    }
    writes = [];
    await cmdShare('table', undefined, {}, ctx('uefa.euro', { json: true }, shortOf('uefa.euro')));
    const data = json();
    expect(data.incomplete).toBe(true);
    expect(data.snippet).toContain(INCOMPLETE.en);
    expect(data.tables).toHaveLength(2);
  });
});
