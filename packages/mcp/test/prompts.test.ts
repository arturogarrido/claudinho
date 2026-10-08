import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

/** Drive the real MCP protocol so prompts are checked as clients see them. */
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverT);
  const client = new Client({ name: 'prompts-test', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const promptText = (res: { messages: { content: { type: string; text?: string } }[] }) =>
  res.messages.map((m) => (m.content.type === 'text' ? (m.content.text ?? '') : '')).join('\n');

describe('my_team prompt', () => {
  it('is listed for the competition you follow, with the team optional', async () => {
    await withClient(async (client) => {
      const { prompts } = await client.listPrompts();
      const p = prompts.find((x) => x.name === 'my_team');
      expect(p?.title).toBe('My team');
      expect(p?.description).toMatch(/competition you follow/);
      expect(p?.description).not.toMatch(/World Cup nation/);
      expect(p?.description).toMatch(/World Cup/); // the market read is still the World Cup's, and the description says so
      const team = p?.arguments?.find((a) => a.name === 'team');
      expect(team, 'the team argument').toBeDefined();
      expect(team?.required ?? false, 'a team is optional: with none, the pinned team').toBe(false);
      expect(team?.description).toMatch(/club|nation/i);
      expect(team?.description).toMatch(/follow --team/);
      expect(team?.description).not.toMatch(/World Cup nation/);
      expect(p?.arguments?.map((a) => a.name)).toEqual(['team']);
    });
  });

  it('with a team: guides the agent through the fixture, the standing, and the World Cup-only market read', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'Arsenal' } });
      const text = promptText(res);
      expect(text).toContain('get_next_fixture');
      expect(text).toContain('get_standings');
      expect(text).toContain('get_market_signal');
      expect(text).toContain('Arsenal');
      // The competition is the one the user follows: the tools are called with no competition argument,
      // never pointed at the World Cup, and a noCompetition answer is relayed as "run claudinho follow".
      expect(text).not.toMatch(/competition:\s*"world-cup"/);
      expect(text).toMatch(/competition I follow/);
      expect(text).toMatch(/no competition argument/);
      expect(text).toMatch(/noCompetition/);
      expect(text).toMatch(/claudinho follow <alias>/);
      // The market read is conditional on the competition, in the approved words, with the code's provenance.
      expect(text).toMatch(/[Oo]nly when the competition is the World Cup/);
      expect(text).toContain('market signals are read for the World Cup alone');
      expect(text).toMatch(/3-letter code/);
      expect(text).toContain('get_team');
      // The standing is the team's row of its table, and a competition with no table is said so.
      expect(text).toMatch(/row of its table/);
      expect(text).toMatch(/no table/);
      // Next is not now.
      expect(text).toContain('its state (scheduled, in play or finished)');
      expect(text).toMatch(/in play only when the state says so/);
      expect(text).not.toMatch(/World Cup match/);
      expect(text).not.toMatch(/group standing/);
    });
  });

  it('with no team: the pinned team, named as such, and the ask when there is none', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team' });
      const text = promptText(res);
      expect(text).toContain('get_next_fixture');
      expect(text).toMatch(/pinned/);
      expect(text).toContain('claudinho follow --team');
      expect(text).toMatch(/with no team/);
      expect(text).toMatch(/ask me which team/);
      expect(text).not.toContain('undefined');
      expect(text).not.toMatch(/\bnull\b/);
      expect(text).toContain('get_standings');
      expect(text).toContain('get_market_signal');
    });
  });

  it('bounds the team label before it reaches the prompt, as the tools do', async () => {
    await withClient(async (client) => {
      const r = await client.getPrompt({ name: 'my_team', arguments: { team: 'a'.repeat(41) } }).then(
        () => 'accepted',
        (e: Error) => `refused: ${e.message}`,
      );
      expect(r).toMatch(/^refused:/);
      const ok = await client.getPrompt({ name: 'my_team', arguments: { team: 'O&M' } });
      expect(promptText(ok)).toContain('O&M');
    });
  });

  it('frames market data as informational only, with an explicit anti-advice guardrail', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'BRA' } });
      const text = promptText(res);
      expect(text).toMatch(/informational/i);
      // The guardrail itself names betting/trading in a prohibition ("never as
      // betting or trading advice") — assert that negation is present, not that
      // the word is absent.
      expect(text).toMatch(/never[^.]*\b(betting|trading)\b/i);
    });
  });
});
