/**
 * 0.11 PR 2.0 — the MCP half of "one competition selection per request,
 * stable team identity".
 *
 * The server's edge is where it builds a request's adapter (`resolveAdapter`).
 * A tool acts on the competition of the adapter it was given; and a team's
 * provider id is a DECLARED part of the output, not something that happens to
 * survive `.passthrough()`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server';
import { resolveAdapter, toolGetNextFixture, toolGetToday } from '../src/tools';

const saved = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (saved === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = saved;
});

function response(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body };
}

function fakeAdapter(competition: string, matches: Match[] = []): ProviderAdapter {
  return {
    name: 'fake',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate(): Promise<Match[]> {
      return matches;
    },
    async fetchLive(): Promise<Match[]> {
      return matches;
    },
  };
}

const ARSENAL_CHELSEA: Match = {
  id: '401878761',
  stage: 'FRIENDLY',
  kickoff: '2026-10-10T11:30:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', flag: '🏳️', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', flag: '🏳️', id: 'espn:363' },
  status: 'SCHEDULED',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

describe('selection — the server resolves the competition once per request', () => {
  it('an explicit selection wins over the environment for every request it makes', async () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      urls.push(String(url));
      return response({ leagues: [], events: [] });
    });
    await toolGetToday({ date: '2026-10-10', competition: 'eng.1' });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain('/soccer/eng.1/');
  });

  it('the adapter it builds states the competition it serves', () => {
    expect(resolveAdapter({}).competition).toBe('fifa.world');
    expect(resolveAdapter({ competition: 'eng.1' }).competition).toBe('eng.1');
    process.env.CLAUDINHO_COMPETITION = 'ita.1';
    expect(resolveAdapter({}).competition).toBe('ita.1');
    // …and one scope keeps one server-lifetime adapter (the retained throttle).
    expect(resolveAdapter({ competition: 'eng.1' })).toBe(resolveAdapter({ competition: 'eng.1' }));
  });

  it('one request resolves once: the environment changing mid-request changes nothing', () => {
    const request = {}; // a request's args object IS the request
    const first = resolveAdapter(request);
    process.env.CLAUDINHO_COMPETITION = 'ita.1';
    expect(resolveAdapter(request)).toBe(first);
    expect(resolveAdapter(request).competition).toBe('fifa.world');
    // A NEW request reads the environment at its own edge.
    expect(resolveAdapter({}).competition).toBe('ita.1');
  });

  it('a tool acts on its request’s competition, not the environment', async () => {
    // Environment says World Cup; the request is for a league → no World Cup
    // lookup happens: the query goes to the league's own reader (since 0.11
    // 2.1c), which this adapter cannot serve a schedule ahead to.
    const league = await toolGetNextFixture({ team: 'ALA', competition: 'eng.1', adapter: fakeAdapter('eng.1') });
    expect(league.data).toMatchObject({ team: 'ALA', fixture: null, degraded: true });
    expect(league.text).not.toMatch(/New Zealand|NZL/);

    // Environment says a league; the request is for the World Cup (its argument
    // beats the environment, and its adapter serves it) → the bundle applies.
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const worldCup = await toolGetToday({ date: '2026-06-11', competition: 'world-cup', adapter: fakeAdapter('fifa.world') });
    expect((worldCup.data as { matches: unknown[] }).matches.length).toBeGreaterThan(0);
  });
});

describe('identity — a team’s provider id is a declared part of the output', () => {
  it('reaches structured content', async () => {
    const { data } = await toolGetToday({
      date: '2026-10-10',
      tz: 'UTC',
      competition: 'eng.1', adapter: fakeAdapter('eng.1', [ARSENAL_CHELSEA]),
    });
    const [match] = (data as { matches: Match[] }).matches;
    expect(match?.home.id).toBe('espn:359');
    expect(match?.away.id).toBe('espn:363');
  });

  it('is declared in the advertised output schema, not left to passthrough', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      const { tools } = await client.listTools();
      type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; $ref?: string; type?: unknown };
      // The advertised schema reuses shapes through `$ref` (a JSON pointer into
      // the same tool's schema), so follow them: an assertion that stops at a
      // `$ref`, or that greps for any `id`, can pass on the MATCH's id alone.
      const deref = (root: Schema, node: Schema | undefined): Schema | undefined => {
        let cur = node;
        for (let hops = 0; cur?.$ref && hops < 8; hops++) {
          cur = cur.$ref
            .replace(/^#\//, '')
            .split('/')
            .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root) as Schema | undefined;
        }
        return cur;
      };
      const teamShape = (tool: string, path: (root: Schema) => Schema | undefined): Schema | undefined => {
        const root = tools.find((t) => t.name === tool)?.outputSchema as Schema | undefined;
        if (!root) return undefined;
        const match = deref(root, path(root));
        // A nullable match is `anyOf: [match, null]`.
        const object = match?.properties ? match : (match?.anyOf ?? []).map((v) => deref(root, v)).find((v) => v?.properties);
        return deref(root, object?.properties?.home);
      };
      const everyMatchShape: Array<[string, (root: Schema) => Schema | undefined]> = [
        ['get_today', (r) => r.properties?.matches?.items],
        ['get_live', (r) => r.properties?.matches?.items],
        ['get_match', (r) => r.properties?.match],
        ['get_next_fixture', (r) => r.properties?.fixture],
      ];
      for (const [tool, path] of everyMatchShape) {
        const home = teamShape(tool, path);
        expect(home?.properties?.code, `${tool}: found the team shape`).toEqual({ type: 'string' });
        expect(home?.properties?.id, `${tool}: team id declared`).toEqual({ type: 'string' });
      }
    } finally {
      await client.close();
    }
  });
});
