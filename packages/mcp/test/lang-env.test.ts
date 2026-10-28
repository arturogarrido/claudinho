/**
 * The server's language (`CLAUDINHO_LANG`, listed in the MCP Registry record since its first version and read by
 * nothing in the server until this test): a tool call that names no `lang` answers in the server's
 * `CLAUDINHO_LANG` when it is exactly one of `en`, `es`, `pt`, `fr` (the CLI's and the plugin's predicate:
 * case-sensitive, nothing trimmed), else as before, in English. A call's `lang` decides when it is present and not
 * empty, as it does today: `lang: "fr"` under `CLAUDINHO_LANG=es` is French, `lang: "en"` is English, and an
 * unsupported `lang` answers as it did without the variable. `LANG` is not read: the record says "default en".
 *
 * Driven over the wire, through the registered handlers, never by calling a tool function: the default is applied
 * where a request enters the server, and a test that calls `toolGetToday(...)` directly would not cross it. Every
 * case compares two whole answers (`isError`, `content`, `structuredContent`), so the text AND the structured data
 * of a call under the variable are the ones the same call with `lang` returns. A row whose answer did not change
 * with the language would prove nothing, so each row is also required to differ from its English answer.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server';

const LOCALES = ['en', 'es', 'pt', 'fr'] as const;

type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
const PL_SEASON = { year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z', displayName: '2026-27 English Premier League' };
const FEEDS: Record<string, { season: unknown; slug: string; events: Ev[] }> = {
  'fifa.world': { season: WC_SEASON, slug: 'group-stage', events: [{ id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA }] },
  'eng.1': { season: PL_SEASON, slug: 'regular-season', events: [{ id: '41', date: '2026-06-12T14:00Z', home: ARS, away: CHE }] },
};
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function event(e: Ev, slug: string) {
  const side = (s: Side, homeAway: string) => ({ homeAway, score: '0', team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return {
    id: e.id,
    date: e.date,
    season: { slug },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' }, period: 0 },
    competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }],
  };
}
// A provider for the World Cup and the Premier League: each scoreboard request answers the events in the provider
// days it asked for (one day, or a month), the standings with nothing.
async function feed(input: unknown): Promise<Response> {
  const url = String(input);
  const slug = Object.keys(FEEDS).find((s) => url.includes(`/${s}/`));
  if (!slug) return json({ code: 404 }, 404);
  if (url.includes('/standings')) return json({});
  const { season, slug: stage, events } = FEEDS[slug] as (typeof FEEDS)[string];
  const asked = new URL(url).searchParams.get('dates') ?? '';
  if (asked.includes('-')) return json({ code: 400 }, 400);
  const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
  return json({ leagues: [{ season }], events: events.filter(inBucket).map((e) => event(e, stage)) });
}

// One row per answer kind: every tool that takes `lang`, on the World Cup and, where the path differs, on a club
// competition. The competition is passed, so every competition-answering text opens with the mode line "· from
// the request", localized; the share row is the bracket card, the one card localized whole.
const ROWS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['get_today', { competition: 'world-cup', date: '2026-06-11', tz: 'UTC' }],
  ['get_today', { competition: 'premier-league', date: '2026-06-12', tz: 'UTC' }],
  ['get_live', { competition: 'world-cup' }],
  ['get_match', { competition: 'world-cup', id: '760415', tz: 'UTC' }],
  ['get_standings', { competition: 'world-cup' }],
  ['get_standings', { competition: 'premier-league' }],
  ['get_bracket', { competition: 'world-cup', tz: 'UTC' }],
  ['get_next_fixture', { competition: 'world-cup', team: 'MEX', tz: 'UTC' }],
  ['get_next_fixture', { competition: 'premier-league', team: 'Arsenal', tz: 'UTC' }],
  ['get_market_signal', { competition: 'world-cup', team: 'MEX', tz: 'UTC' }],
  ['get_share_snippet', { competition: 'world-cup', bracket: true, tz: 'UTC' }],
  ['list_competitions', { competition: 'premier-league' }],
];

type Answer = { isError: boolean; content: unknown; structuredContent: unknown };
const textOf = (a: Answer) => (a.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');

let client: Client;
let server: ReturnType<typeof buildServer>;
const ENV_NAMES = ['CLAUDINHO_LANG', 'LANG', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_TZ', 'CLAUDINHO_FLAVOR'] as const;
const before = new Map<string, string | undefined>();

beforeAll(async () => {
  for (const name of ENV_NAMES) {
    before.set(name, process.env[name]);
    delete process.env[name];
  }
  // One clock for every call, so two answers compared are never a minute apart.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
  vi.spyOn(globalThis, 'fetch').mockImplementation(feed as typeof fetch);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  server = buildServer();
  client = new Client({ name: 'lang-env', version: '0.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [name, value] of before) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** One call over the wire with `env` set for it alone (a name absent from `env` is unset). */
async function call(name: string, args: Record<string, unknown>, env: { CLAUDINHO_LANG?: string; LANG?: string; XDG_CONFIG_HOME?: string } = {}): Promise<Answer> {
  const kept = { CLAUDINHO_LANG: process.env.CLAUDINHO_LANG, LANG: process.env.LANG, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  delete process.env.CLAUDINHO_LANG;
  delete process.env.LANG;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: unknown; structuredContent?: unknown };
    return { isError: r.isError ?? false, content: r.content, structuredContent: r.structuredContent ?? null };
  } finally {
    for (const [k, v] of Object.entries(kept)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('the rows cover every tool that takes lang', () => {
  it('each tool whose input takes lang has a row; get_team takes none', async () => {
    const { tools } = await client.listTools();
    const takesLang = tools.filter((t) => 'lang' in ((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})).map((t) => t.name);
    expect([...new Set(ROWS.map(([name]) => name))].sort()).toEqual([...takesLang].sort());
    expect(takesLang).not.toContain('get_team');
    expect(takesLang).toHaveLength(9);
  });

  it("the lang argument's description says the server's CLAUDINHO_LANG is the default", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const lang = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.lang;
      if (lang) expect(lang.description, tool.name).toContain('CLAUDINHO_LANG');
    }
  });
});

describe("a call with no lang answers in the server's CLAUDINHO_LANG", () => {
  for (const [name, args] of ROWS) {
    const label = `${name} ${String(args.competition)}`;
    it(`${label}: CLAUDINHO_LANG=xx is the answer lang: "xx" gives, text and data, in each of the four`, async () => {
      const english = await call(name, args);
      for (const lang of LOCALES) {
        const asked = await call(name, { ...args, lang });
        const configured = await call(name, args, { CLAUDINHO_LANG: lang });
        expect(configured, `${label} ${lang}`).toEqual(asked);
        if (lang !== 'en') expect(textOf(asked), `${label} ${lang}: the row must change with the language`).not.toEqual(textOf(english));
      }
    });
  }

  it('a tool error is in it too: an unknown competition is refused in Spanish', async () => {
    const asked = await call('get_today', { competition: 'foo', lang: 'es' });
    const configured = await call('get_today', { competition: 'foo' }, { CLAUDINHO_LANG: 'es' });
    expect(configured).toEqual(asked);
    expect(configured.isError).toBe(true);
    expect(textOf(configured)).toMatch(/Competición desconocida "foo"/);
  });

  it('the noCompetition answer is in it too', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'claudinho-lang-env-'));
    try {
      const english = await call('get_today', {}, { XDG_CONFIG_HOME: empty });
      const asked = await call('get_today', { lang: 'pt' }, { XDG_CONFIG_HOME: empty });
      const configured = await call('get_today', {}, { CLAUDINHO_LANG: 'pt', XDG_CONFIG_HOME: empty });
      expect(configured).toEqual(asked);
      expect(configured.structuredContent).toMatchObject({ noCompetition: true });
      expect(textOf(configured)).not.toEqual(textOf(english));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('a call that names its lang decides', () => {
  const PRECEDENCE: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['get_today', { competition: 'world-cup', date: '2026-06-11', tz: 'UTC' }],
    ['get_share_snippet', { competition: 'world-cup', bracket: true, tz: 'UTC' }],
    ['list_competitions', { competition: 'premier-league' }],
  ];
  for (const [name, args] of PRECEDENCE) {
    it(`${name}: lang "fr", "en" and an unsupported "de" answer under CLAUDINHO_LANG=es as they do without it`, async () => {
      for (const lang of ['fr', 'en', 'de']) {
        expect(await call(name, { ...args, lang }, { CLAUDINHO_LANG: 'es' }), `${name} ${lang}`).toEqual(await call(name, { ...args, lang }));
      }
    });

    it(`${name}: an empty lang is no lang, so CLAUDINHO_LANG answers`, async () => {
      expect(await call(name, { ...args, lang: '' }, { CLAUDINHO_LANG: 'es' })).toEqual(await call(name, { ...args, lang: 'es' }));
    });
  }
});

describe('a CLAUDINHO_LANG that is not one of the four changes nothing, and LANG is not read', () => {
  const ROW = ['get_today', { competition: 'world-cup', date: '2026-06-11', tz: 'UTC' }] as const;
  it('de, ES, es-MX, es_MX.UTF-8, " es" and the empty string answer as no variable does (English)', async () => {
    const [name, args] = ROW;
    const english = await call(name, args);
    for (const value of ['de', 'ES', 'es-MX', 'es_MX.UTF-8', ' es', '']) {
      expect(await call(name, args, { CLAUDINHO_LANG: value }), JSON.stringify(value)).toEqual(english);
    }
  });

  it("LANG=es_MX.UTF-8 alone answers in English: the server's language is CLAUDINHO_LANG's, never the shell's", async () => {
    const [name, args] = ROW;
    expect(await call(name, args, { LANG: 'es_MX.UTF-8' })).toEqual(await call(name, args));
    expect(await call(name, args, { LANG: 'es_MX.UTF-8', CLAUDINHO_LANG: 'fr' })).toEqual(await call(name, { ...args, lang: 'fr' }));
  });
});
