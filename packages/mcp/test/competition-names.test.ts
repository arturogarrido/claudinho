/**
 * The MCP `competition` argument takes core's one grammar (part B, A2): an
 * alias, a slug, the competition's name or a short form, resolved to the
 * canonical selection; a near miss is a tool error that suggests the nearest
 * alias first and lists the aliases, unwrapped (an agent reads it whole). The
 * argument's description and the server's instructions say so; the listing
 * (`list_competitions`) is unchanged.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SUPPORTED } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, INSTRUCTIONS } from '../src/server';
import { selectionOf, toolGetToday, toolListCompetitions } from '../src/tools';

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
  const client = new Client({ name: 'competition-names', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('the competition argument by a name or a short form', () => {
  it('resolves to the canonical selection, chosen by the request', () => {
    expect(selectionOf({ competition: 'epl' })).toMatchObject({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' });
    expect(selectionOf({ competition: 'UEFA Champions League' })).toMatchObject({ slug: 'uefa.champions', alias: 'champions-league' });
    expect(selectionOf({ competition: 'copa america' })).toMatchObject({ slug: 'conmebol.america', alias: 'copa-america' });
  });

  it('the server\'s CLAUDINHO_COMPETITION takes the same grammar', () => {
    process.env.CLAUDINHO_COMPETITION = 'Bundesliga';
    expect(selectionOf({})).toMatchObject({ slug: 'ger.1', alias: 'bundesliga', chosenBy: 'env' });
  });

  it('a near miss is a tool error: the nearest alias first, then the aliases on one line', async () => {
    const aliases = SUPPORTED.map((e) => e.alias).join(', ');
    await expect(toolGetToday({ competition: 'premier' })).rejects.toThrow(
      `Unknown competition "premier". Did you mean premier-league?\nAliases: ${aliases}. Or an ESPN slug such as eng.1.`,
    );
    await expect(toolGetToday({ competition: 'premier', lang: 'es' })).rejects.toThrow(/¿Quisiste decir premier-league\?/);
    await expect(toolGetToday({ competition: 'mls' })).rejects.toThrow(`Unknown competition "mls".\nAliases: ${aliases}.`);
  });

  it('through the wire', async () => {
    await withClient(async (client) => {
      const res = (await client.callTool({ name: 'get_live', arguments: { competition: 'champions' } })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
      expect(res.isError).toBe(true);
      expect(res.content.map((c) => c.text ?? '').join('\n')).toContain('Did you mean champions-league or concacaf-champions-cup?');
    });
  });
});

describe('what an agent reads about it', () => {
  it('every tool\'s competition argument says it takes a name or a short form', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const withArg = tools.filter((t) => (t.inputSchema as { properties?: Record<string, unknown> }).properties?.competition);
      expect(withArg.length).toBeGreaterThan(5);
      for (const tool of withArg) {
        const d = ((tool.inputSchema as { properties: Record<string, { description?: string }> }).properties.competition?.description) ?? '';
        expect(d, tool.name).toContain('Premier League');
        expect(d, tool.name).toContain('epl');
        expect(d, tool.name).toContain('premier-league');
      }
    });
  });

  it('the instructions: names accepted, and an unknown competition suggests the nearest alias', () => {
    expect(INSTRUCTIONS).toMatch(/its name \(Premier League\)/);
    expect(INSTRUCTIONS).toContain('An unknown competition is a tool error that suggests the nearest alias when there is one and lists the aliases.');
  });

  it('list_competitions is unchanged: no short forms in its data', () => {
    const r = toolListCompetitions({});
    for (const row of (r.data as { competitions: Array<Record<string, unknown>> }).competitions) {
      expect(Object.keys(row)).toEqual(['slug', 'alias', 'name', 'teams', 'kind', 'capabilities']);
    }
  });
});

describe('round 1 of the review (#231)', () => {
  it('a 100,000-unit value or one with control and format characters: the tool error echoes a bounded, sanitized label', async () => {
    for (const v of ['x'.repeat(100_000), `epl\u0007‮${'y'.repeat(50_000)}`]) {
      let msg = '';
      try {
        await toolGetToday({ competition: v });
      } catch (err) {
        msg = (err as Error).message;
      }
      expect(msg.startsWith('Unknown competition "')).toBe(true);
      expect(msg.length).toBeLessThan(600);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what the test refuses.
      expect(msg).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/);
    }
  });

  it('the list_competitions description says the other tools take an alias, a name or a short form', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const d = tools.find((t) => t.name === 'list_competitions')?.description ?? '';
      expect(d).toContain('the alias every other tool\'s competition argument takes (it also takes the name or a short form)');
    });
  });
});
