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
  it('guides the agent through fixture, standings, AND the market read', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'MEX' } });
      const text = promptText(res);
      expect(text).toContain('get_next_fixture');
      expect(text).toContain('get_standings');
      expect(text).toContain('get_market_signal');
      expect(text).toContain('MEX');
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
