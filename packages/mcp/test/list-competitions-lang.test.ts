/**
 * The MCP edge speaks the request's language (0.11 · 2.5a, review): the
 * refusal of an unknown competition is in the request's `lang` through a real
 * tool call, and `list_competitions` takes `lang` like every other tool (its
 * `Current:` line is localized; the names are not), so the reads of
 * `args.lang` in its handler are reachable from the wire. The listing's text
 * names every competition with its capabilities, pinned row by row.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SUPPORTED } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { toolGetToday, toolListCompetitions } from '../src/tools';

const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverT);
  const client = new Client({ name: 'list-competitions-lang', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('the refusal in the request\'s language', () => {
  it('es, pt, fr and en, through the handler', async () => {
    await expect(toolGetToday({ date: '2026-10-04', competition: 'foo', lang: 'es' })).rejects.toThrow(/Competición desconocida "foo"/);
    await expect(toolGetToday({ date: '2026-10-04', competition: 'foo', lang: 'pt' })).rejects.toThrow(/Competição desconhecida "foo"/);
    await expect(toolGetToday({ date: '2026-10-04', competition: 'foo', lang: 'fr' })).rejects.toThrow(/Compétition inconnue « foo »/);
    await expect(toolGetToday({ date: '2026-10-04', competition: 'foo', lang: 'en' })).rejects.toThrow(/Unknown competition "foo"/);
    await expect(toolGetToday({ date: '2026-10-04', competition: 'foo' })).rejects.toThrow(/Unknown competition "foo"/);
  });

  it('through the wire: the tool error carries the sentence in the request\'s language', async () => {
    await withClient(async (client) => {
      const res = (await client.callTool({ name: 'get_today', arguments: { competition: 'foo', lang: 'es' } })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
      expect(res.isError).toBe(true);
      const text = res.content.map((c) => c.text ?? '').join('\n');
      expect(text).toMatch(/Competición desconocida "foo"/);
      expect(text).toContain('premier-league');
    });
  });
});

describe('list_competitions', () => {
  it('takes lang: the Current line is localized, the names are not', async () => {
    const es = toolListCompetitions({ competition: 'premier-league', lang: 'es' });
    expect(es.text).toContain('Current: Premier League · desde la solicitud');
    const fr = toolListCompetitions({ lang: 'fr' });
    expect(fr.text).toContain('Current: World Cup');
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === 'list_competitions');
      const props = Object.keys((tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});
      expect(props).toContain('lang');
      expect(props).toContain('competition');
      const res = (await client.callTool({ name: 'list_competitions', arguments: { competition: 'laliga', lang: 'pt' } })) as { content: Array<{ type: string; text?: string }> };
      expect(res.content.map((c) => c.text ?? '').join('\n')).toContain('Current: LALIGA · da solicitação');
    });
  });

  it('names every competition with its alias, teams and capabilities, one row each, in the table\'s order', () => {
    const r = toolListCompetitions({});
    const rows = r.text.split('\n').filter((l) => / · (nation|club) · /.test(l));
    expect(rows).toHaveLength(SUPPORTED.length);
    SUPPORTED.forEach((e, i) => {
      expect(rows[i], e.slug).toContain(`${e.alias} · ${e.name} · ${e.teams} · `);
    });
    expect(rows[0]).toBe('world-cup · World Cup · nation · offered/offered/offered/offered/offered');
    expect(rows.find((l) => l.startsWith('premier-league · '))).toBe('premier-league · Premier League · club · offered/offered/offered/not-applicable/not-offered-yet');
    expect(rows.find((l) => l.startsWith('concacaf-champions-cup · '))).toBe('concacaf-champions-cup · Concacaf Champions Cup · club · offered/offered/not-applicable/not-offered-yet/not-offered-yet');
  });
});
