/**
 * The MCP server's public copy (0.11 · 2.7): what an agent reads. No em-dash in
 * the tool descriptions, the input descriptions, the INSTRUCTIONS (the quoted
 * voice example `— ¡GOOOOL!` excepted: a renderer's separator) or the prompt's
 * text; the footer is core's one disclaimer; the INSTRUCTIONS carry the "next is
 * not now" rule; the `my_team` prompt tells the agent to ask the World Cup's
 * tools (it is the World Cup's prompt: the markets are) and to relay the
 * fixture's date and state; and the Smithery manifest's tool blurbs are the
 * tools' full descriptions, so the caveats the manifest guard requires stay.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISCLAIMER as CORE_DISCLAIMER } from '@claudinho/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '../src/format';
import { buildServer, INSTRUCTIONS } from '../src/server';

const VOICE_EXAMPLE = '— ¡GOOOOL!';
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../mcpb/manifest.json', import.meta.url)), 'utf8')) as {
  tools: { name: string; description: string }[];
};

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverT);
  const client = new Client({ name: 'copy-test', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const noEmDash = (label: string, text: string) => {
  const stripped = text.split(VOICE_EXAMPLE).join('');
  expect(stripped, `${label}: ${text.slice(0, 80)}`).not.toMatch(/—/);
};

describe("the server's copy", () => {
  it('no em-dash in any tool description or input description', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        noEmDash(tool.name, tool.description ?? '');
        const props = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
        for (const [name, prop] of Object.entries(props)) noEmDash(`${tool.name}.${name}`, prop.description ?? '');
      }
    });
  });

  it('no em-dash in the INSTRUCTIONS but the quoted voice example, and they say that "next" is not "now"', () => {
    noEmDash('INSTRUCTIONS', INSTRUCTIONS);
    expect(INSTRUCTIONS).toContain(VOICE_EXAMPLE);
    expect(INSTRUCTIONS).toMatch(/never infer that a fixture is happening now from a `next` query/i);
  });

  it('the footer is the one disclaimer', () => {
    expect(DISCLAIMER).toContain(CORE_DISCLAIMER);
    expect(INSTRUCTIONS).toContain(CORE_DISCLAIMER);
  });

  it("the my_team prompt asks the World Cup's tools and relays the date and state, with no em-dash", async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'MEX' } });
      const text = res.messages.map((m) => (m.content.type === 'text' ? (m.content.text ?? '') : '')).join('\n');
      expect(text).toMatch(/competition:\s*"world-cup"/);
      expect(text).toMatch(/date/i);
      expect(text).toMatch(/\bstate\b|\bstatus\b/i);
      noEmDash('my_team', text);
    });
  });

  it("the Smithery manifest's tool blurbs are the tools' full descriptions", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t.description ?? '']));
      for (const entry of manifest.tools) {
        expect(byName.has(entry.name), entry.name).toBe(true);
        expect(entry.description, entry.name).toBe(byName.get(entry.name));
      }
    });
  });
});
