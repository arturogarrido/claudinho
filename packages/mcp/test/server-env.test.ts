/**
 * The MCP Registry record (`server.json`, published by the `mcp-registry` job on every tag, immutable per version)
 * lists the environment variables a user may set in the server's `env`. Every name it lists is one the server READS.
 * From the first record (0.4.2, June 2026) to 0.13.0 it listed `CLAUDINHO_LANG`, which nothing in the server read:
 * a user who set it got English.
 *
 * Measured by running the server, not by reading its source (the server bundles core, and core holds reads only the
 * CLI reaches): `process.env` is replaced by a recording proxy, the server is imported afresh (`CLAUDINHO_FLAVOR` is
 * read when it loads), and every registered tool is called once over the wire with its optional arguments left
 * out, so a default the environment supplies is asked for. The listed names are unset while it runs, so a spread of
 * the environment (which reads only the keys that exist) cannot count as a read of one.
 *
 * Limit, a tripwire and not a proof: a READ is not an honoured value. That the value a variable holds changes the
 * answer is each variable's own test (`CLAUDINHO_LANG`: `lang-env.test.ts`). A read on a path these calls do not
 * take is not seen, and the guard then fails closed: give the call that reaches it.
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Record_ = { packages?: Array<{ environmentVariables?: Array<{ name: string }> }> };
const record = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as Record_;
const advertised = (record.packages ?? []).flatMap((p) => (p.environmentVariables ?? []).map((v) => v.name));

// One call per registered tool, every optional argument left out (no tz, no lang, no flavor, no team where the
// tool can do without one): the read of a default the environment supplies is on the path.
const CALLS: Readonly<Record<string, Record<string, unknown>>> = {
  get_today: {},
  get_live: {},
  get_match: { id: '760415' },
  get_standings: {},
  get_bracket: {},
  get_next_fixture: {},
  get_market_signal: { team: 'MEX' },
  get_share_snippet: { matchId: '760415' },
  get_team: { query: 'Mexico' },
  list_competitions: {},
};

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
// A provider that answers every request, with nothing in it: the tools take their healthy paths.
const feed = async (input: unknown) => (String(input).includes('/standings') ? json({}) : json({ leagues: [{ season: WC_SEASON }], events: [] }));

const reads = new Set<string>();
const real = process.env;
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of advertised) {
    saved.set(name, real[name]);
    delete real[name];
  }
  process.env = new Proxy(real, {
    get(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.has(target, key);
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  });
});

afterAll(() => {
  process.env = real;
  for (const [name, value] of saved) {
    if (value === undefined) delete real[name];
    else real[name] = value;
  }
  vi.restoreAllMocks();
});

describe('server.json lists only environment variables the server reads', () => {
  it('the record lists variables, and each is a CLAUDINHO_ name', () => {
    expect(advertised.length).toBeGreaterThan(0);
    for (const name of advertised) expect(name).toMatch(/^CLAUDINHO_[A-Z_]+$/);
  });

  it('every listed name is read while the server loads and answers one call to each tool', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(feed as typeof fetch);
    vi.resetModules();
    reads.clear();
    const { buildServer } = await import('../src/server');
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'server-env', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      const { tools } = await client.listTools();
      // Every registered tool has its call here, and nothing here is not a tool: a new tool is driven too.
      expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(CALLS).sort());
      for (const tool of tools) {
        // A tool error is an answer too (get_next_fixture with no team and none configured): the read happened.
        await client.callTool({ name: tool.name, arguments: CALLS[tool.name] });
      }
    } finally {
      await client.close();
      await server.close();
    }
    expect(advertised.filter((name) => !reads.has(name))).toEqual([]);
  });
});
