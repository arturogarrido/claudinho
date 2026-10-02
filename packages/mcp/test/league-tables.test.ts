/**
 * 0.11 PR 2.3 on the MCP server: `get_standings`, `standings://` and the table
 * card of `get_share_snippet`, for every table shape, in text and `data`. Each
 * case goes from a payload recorded on the real feed (Oct 2 2026) through the
 * real adapter into the tool.
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { DISCLAIMER } from '../src/format';
import { buildServer, OUTPUT_SCHEMAS, toContent } from '../src/server';
import { standingsResourceText, toolGetShareSnippet, toolGetStandings } from '../src/tools';

const recorded = (slug: string): { children: Array<Record<string, unknown>> } =>
  JSON.parse(readFileSync(new URL(`../../core/test/fixtures/standings/${slug}.json`, import.meta.url), 'utf8'));

let requests = 0;
const serving = (competition: string, payload: unknown = recorded(competition)) =>
  new EspnAdapter({
    competition,
    fetchImpl: (async () => {
      requests++;
      return new Response(JSON.stringify(payload));
    }) as unknown as typeof fetch,
  });
const common = (competition: string, payload?: unknown) => ({
  adapter: serving(competition, payload),
  marketProvider: new FakeMarketProvider(),
  now: new Date('2026-10-02T12:00:00Z'),
});
type Table = { group: string; label?: string; standings: unknown[]; partial?: unknown };
const strict = (schema: keyof typeof OUTPUT_SCHEMAS, data: unknown) => z.object(OUTPUT_SCHEMAS[schema]).strict().parse(data);

const INCOMPLETE = 'Some tables could not be read — this is not the whole competition.';
/** A flat sibling the parser inspects and cannot name: the inventory is not whole. */
const shortOf = (slug: string) => {
  const payload = recorded(slug);
  return { children: [...payload.children.slice(0, 2), { ...payload.children[2], name: 'Second Phase' }] };
};

describe('get_standings shows the table the competition has', () => {
  it('a league: title with label and key in the text; key, label and twenty rows in data', async () => {
    const r = await toolGetStandings(common('eng.1'));
    expect(r.text).toContain('2026-27 English Premier League (LEAGUE)');
    expect(r.text).toContain('Manchester City');
    expect(r.text).toContain('ESPN');
    const data = r.data as { degraded: boolean; source: string; tables: Table[] };
    expect(data).toMatchObject({ degraded: false, source: 'espn' });
    expect(data.tables).toHaveLength(1);
    // The nested table schema is permissive: the label is asserted, not inferred from a parse.
    expect(data.tables[0]).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    expect(data.tables[0]?.standings).toHaveLength(20);
    expect('incomplete' in data).toBe(false);
    expect(() => strict('get_standings', r.data)).not.toThrow();
  });

  it('the Champions League phase: 36 rows under LEAGUE', async () => {
    const r = await toolGetStandings({ group: 'league', ...common('uefa.champions') });
    const table = (r.data as { tables: Table }).tables;
    expect(table).toMatchObject({ group: 'LEAGUE', label: 'League Phase' });
    expect(table.standings).toHaveLength(36);
    expect(r.text).toContain('League Phase (LEAGUE)');
  });

  it('numbered groups: fourteen tables; A1 is Group A1; A is no group', async () => {
    const all = await toolGetStandings(common('uefa.nations'));
    expect((all.data as { tables: Table[] }).tables.map((t) => t.group)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2']);
    expect(all.text).toContain('Group A1 (A1)');
    const a1 = await toolGetStandings({ group: 'a1', ...common('uefa.nations') });
    expect((a1.data as { tables: Table }).tables).toMatchObject({ group: 'A1', label: 'Group A1' });
    const a = await toolGetStandings({ group: 'A', ...common('uefa.nations') });
    expect(a.text).toContain('No group "A".');
    expect(a.data).toEqual({ degraded: false, source: 'espn', tables: null });
  });

  it('groups under a league: nine tables; A-B is League A, Group B', async () => {
    const all = await toolGetStandings(common('concacaf.nations.league'));
    expect((all.data as { tables: Table[] }).tables.map((t) => t.group)).toEqual(['A-A', 'A-B', 'B-A', 'B-B', 'B-C', 'B-D', 'C-A', 'C-B', 'C-C']);
    expect(all.text).toContain('League B, Group D (B-D)');
    const ab = await toolGetStandings({ group: 'A-B', ...common('concacaf.nations.league') });
    expect((ab.data as { tables: Table }).tables.label).toBe('League A, Group B');
  });

  it('a lettered group is what it was: "Group A", and no label in data', async () => {
    const r = await toolGetStandings({ group: 'A', ...common('uefa.euro') });
    expect(r.text.split('\n')[0]).toBe('Group A');
    expect(Object.keys((r.data as { tables: Table }).tables)).toEqual(['group', 'standings']);
  });

  it('a competition with no table by design: "No standings available", attributed, not an outage', async () => {
    const r = await toolGetStandings(common('concacaf.champions'));
    expect(r.text).toContain('No standings available.');
    expect(r.data).toEqual({ degraded: false, source: 'espn', tables: [] });
  });

  it('the two sentences for "nothing to show" follow the reader’s language, like "unavailable" does', async () => {
    // Found in review: they were English literals. Under this competition the
    // empty answer used to be the localized "unavailable"; it must not become
    // an English sentence for a Spanish reader.
    const empty = await toolGetStandings({ lang: 'es', ...common('concacaf.champions') });
    expect(empty.text).toContain('No hay clasificación disponible.');
    const unknown = await toolGetStandings({ group: 'A', lang: 'es', ...common('uefa.nations') });
    expect(unknown.text).toContain('No se encontró el grupo "A".');
    const pt = await toolGetStandings({ group: 'A', lang: 'pt', ...common('uefa.nations') });
    expect(pt.text).toContain('Grupo "A" não encontrado.');
    const fr = await toolGetStandings({ lang: 'fr', ...common('concacaf.champions') });
    expect(fr.text).toContain('Aucun classement disponible.');
    // Found in review: in Portuguese "none" read as an outage ("Classificação
    // indisponível." beside "Classificação ao vivo indisponível.").
    const none = await toolGetStandings({ lang: 'pt', ...common('concacaf.champions') });
    expect(none.text).toContain('Não há classificação disponível.');
    expect(none.text).not.toContain('indisponível');
    // English is what it was.
    expect((await toolGetStandings({ group: 'A', ...common('uefa.nations') })).text).toContain('No group "A".');
  });
});

describe('tables are missing: text and data both say so', () => {
  it('all tables: the ones that were read, the sentence beside them, `incomplete: true`, and the schema declares it', async () => {
    const r = await toolGetStandings(common('uefa.euro', shortOf('uefa.euro')));
    expect(r.text).toContain(`(${INCOMPLETE})`);
    expect(r.text).toContain('Group A');
    // BEFORE the tables: the text of a tool answer is cut at a fixed length,
    // from the end, and a verdict at the tail would be the first thing lost.
    expect(r.text.indexOf(INCOMPLETE)).toBeLessThan(r.text.indexOf('Group A'));
    const data = r.data as { incomplete?: boolean; degraded: boolean; tables: Table[] };
    expect(data.incomplete).toBe(true);
    expect(data.degraded).toBe(false);
    expect(data.tables.map((t) => t.group)).toEqual(['A', 'B']);
    expect(() => strict('get_standings', r.data)).not.toThrow();
  });

  it('in the reader’s language', async () => {
    const r = await toolGetStandings({ lang: 'es', ...common('uefa.euro', shortOf('uefa.euro')) });
    expect(r.text).toContain('No se pudieron leer algunas tablas — esta no es la competición completa.');
  });

  it('a key that was read: its table, and no verdict about the batch', async () => {
    const r = await toolGetStandings({ group: 'A', ...common('uefa.euro', shortOf('uefa.euro')) });
    expect(r.text).not.toContain(INCOMPLETE);
    expect('incomplete' in (r.data as object)).toBe(false);
  });

  it('a key that was not read: unavailable, not "no group"', async () => {
    const r = await toolGetStandings({ group: 'C', ...common('uefa.euro', shortOf('uefa.euro')) });
    expect(r.text).toContain('Live standings unavailable.');
    expect(r.data).toEqual({ degraded: true, source: null, tables: null });
  });
});

describe('standings://{key}', () => {
  it('a league by its key, a numbered group, a group under a league', async () => {
    expect(await standingsResourceText('league', serving('eng.1'))).toContain('2026-27 English Premier League (LEAGUE)');
    expect(await standingsResourceText('A1', serving('uefa.nations'))).toContain('Group A1 (A1)');
    expect(await standingsResourceText('a-b', serving('concacaf.nations.league'))).toContain('League A, Group B (A-B)');
    expect((await standingsResourceText('A', serving('uefa.euro'))).split('\n')[0]).toBe('Group A');
  });

  it('a string that is not a key is refused before a request, and says what a key is', async () => {
    requests = 0;
    for (const junk of ['A B', 'Group A', '..%2FA', 'A/B', 'ABCDEFGHIJKLM', '']) {
      const text = await standingsResourceText(junk, serving('uefa.euro'));
      expect(text, JSON.stringify(junk)).toContain('Not a table.');
      expect(text).toContain('standings://LEAGUE');
      expect(text).toContain('not affiliated with or endorsed by FIFA or Anthropic');
    }
    expect(requests).toBe(0);
  });
});

describe('get_share_snippet: a table card', () => {
  it('a league card: label and key in the title; the label in data', async () => {
    const r = await toolGetShareSnippet({ group: 'LEAGUE', ...common('eng.1') });
    expect(r.text).toContain('2026-27 English Premier League (LEAGUE) · standings');
    const data = r.data as { kind: string; group: string; tables: Table[] };
    expect(data).toMatchObject({ kind: 'table', group: 'LEAGUE' });
    expect(data.tables[0]).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    expect(() => strict('get_share_snippet', r.data)).not.toThrow();
  });

  it('a key that was not read, with tables missing: the card says unavailable', async () => {
    const r = await toolGetShareSnippet({ group: 'C', ...common('uefa.euro', shortOf('uefa.euro')) });
    expect(r.text).toContain('Live standings unavailable.');
    expect((r.data as { degraded: boolean }).degraded).toBe(true);
  });
});

describe('the contract says so', () => {
  it('the REGISTERED argument accepts a table key, and the descriptions say what one is', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      const { tools } = await client.listTools();
      for (const name of ['get_standings', 'get_share_snippet']) {
        const tool = tools.find((t) => t.name === name);
        const input = tool?.inputSchema as { properties?: Record<string, { pattern?: string; description?: string }> } | undefined;
        const group = input?.properties?.group;
        expect(group?.pattern, name).toBeDefined();
        const pattern = new RegExp(group?.pattern ?? '$^');
        for (const key of ['A', 'l', 'A1', 'A-B', 'LEAGUE']) expect(pattern.test(key), `${name} ${key}`).toBe(true);
        for (const junk of ['', 'A B', 'Group A', 'A/B', 'ABCDEFGHIJKLM']) expect(pattern.test(junk), `${name} ${junk}`).toBe(false);
        expect(group?.description, name).toMatch(/A1.*A-B.*LEAGUE/);
        // The sentences an agent follows no longer say "A–L or all 12".
        expect(tool?.description, name).not.toMatch(/all 12/);
      }
      const standings = tools.find((t) => t.name === 'get_standings');
      expect(standings?.description).toMatch(/LEAGUE/);
      const output = standings?.outputSchema as { properties?: Record<string, { const?: unknown; description?: string }> } | undefined;
      const marker = output?.properties?.incomplete;
      expect(marker?.const).toBe(true);
      expect(marker?.description).toMatch(/not the whole competition/);
      // The resource says what a key is, too.
      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.find((t) => t.uriTemplate === 'standings://{group}')?.description).toMatch(/LEAGUE/);
    } finally {
      await client.close();
    }
  });
});

describe('a long answer is cut at a length: what qualifies it, and its footer, are not what is lost', () => {
  // Found in review. A league table may hold forty rows now; with the longest
  // names the sanitizer lets through, ONE table is longer than the cap on a
  // tool's text. The partial-table sentence sat after the rows, and the
  // attribution and the disclaimer after that: all three were cut.
  const longName = (i: number) => `${String.fromCodePoint(0x41 + (i % 26))}${NAME}`;
  // 99 of them and the first letter: 100 columns, 397 code points, the longest a label may be
  // (one more and the sanitizer cuts the name, and no row holds `longName` whole).
  const NAME = ('\u{1D400}' + '\u{1D185}'.repeat(3)).repeat(99);
  const stats = (rank: number) =>
    Object.entries({ gamesPlayed: 1, wins: 1, ties: 0, losses: 0, pointsFor: 2, pointsAgainst: 0, pointDifferential: 2, points: 3, rank }).map(
      ([name, value]) => ({ name, value }),
    );
  const league = {
    children: [
      {
        name: '2026-27 Long Names League',
        standings: {
          entries: Array.from({ length: 40 }, (_, i) => ({
            team: { id: String(5000 + i), abbreviation: `T${i}`, displayName: longName(i) },
            // The first row cannot be read: the table is partial.
            stats: i === 0 ? [] : stats(i + 1),
          })),
        },
      },
    ],
  };

  it('the partial-table sentence, the attribution and the disclaimer are in the text a client receives', async () => {
    const r = await toolGetStandings(common('eng.1', league));
    const table = (r.data as { tables: Table[] }).tables[0];
    expect(table?.standings).toHaveLength(39);
    expect(table?.partial).toEqual({ omitted: 1 });
    expect(r.text.length).toBeGreaterThan(32_000); // the case: longer than the cap
    const sent = toContent(r).content[0]?.text ?? '';
    expect(sent.length).toBeLessThanOrEqual(32_000);
    expect(sent).toContain('Partial table');
    expect(sent).toContain('(truncated)');
    expect(sent).toContain('Live data: ESPN');
    expect(sent).toContain(DISCLAIMER);
    // In reading order: the sentence about the table comes before its rows.
    expect(sent.indexOf('Partial table')).toBeLessThan(sent.indexOf(longName(1)));
  });

  it('a short answer is not touched', async () => {
    const r = await toolGetStandings(common('eng.1'));
    expect(toContent(r).content[0]?.text).toBe(r.text);
  });
});
