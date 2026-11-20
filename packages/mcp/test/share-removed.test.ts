import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, OUTPUT_SCHEMAS } from '../src/server';

/**
 * 0.15.0 removed the share cards: `get_share_snippet` is not a tool. Nine
 * tools remain, and nothing a client reads at the start of a session (the
 * instructions, the tool list with its descriptions and schemas) names a
 * share card or a snippet.
 */
const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const NINE = ['get_bracket', 'get_live', 'get_market_signal', 'get_match', 'get_next_fixture', 'get_standings', 'get_team', 'get_today', 'list_competitions'];
const GONE = /share|snippet|paste/i;

describe('get_share_snippet is not a tool', () => {
  it('nine output schemas, none for a share snippet', () => {
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual(NINE);
  });

  it('the instructions name no share tool, snippet or card', () => {
    expect(INSTRUCTIONS).toContain('get_next_fixture');
    expect(INSTRUCTIONS).not.toMatch(GONE);
    expect(INSTRUCTIONS).not.toMatch(/\bcards?\b/i);
  });

  it.skipIf(!existsSync(DIST))('the built server: initialize and tools/list name nine tools and no share card', () => {
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'share-removed', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];
    const output = execFileSync(process.execPath, [DIST], { input: `${requests.map((r) => JSON.stringify(r)).join('\n')}\n`, encoding: 'utf8', timeout: 30_000 });
    const replies = output.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { id?: number; result?: { instructions?: string; tools?: Array<{ name: string }> } });
    const init = replies.find((r) => r.id === 1)?.result;
    const tools = replies.find((r) => r.id === 2)?.result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(NINE);
    expect(JSON.stringify(tools)).not.toMatch(GONE);
    expect(init?.instructions ?? '').toContain('get_next_fixture');
    expect(init?.instructions ?? '').not.toMatch(GONE);
  });
});
