/**
 * 0.11 PR 2.3 — every table shape the supported competitions serve.
 *
 * The table parser read one shape: children named `Group <letter>`. Six of the
 * then fifteen competitions serve that. Six served one league table (seven since the Liga AUF Uruguaya, Oct 2026) and answered
 * "unavailable"; the UEFA Nations League serves numbered groups and answered
 * the same; one has no table; and the Concacaf Nations League, whose tables are named
 * "League A, Group B", was read WRONG: each table was taken for the letter its
 * name ends in, so four of nine were shown as the whole competition.
 *
 * The payloads under `fixtures/standings/` were recorded from the real feed on
 * Oct 2 2026 and slimmed to what the parser reads (names, ids, statistics).
 * Every repair test here goes payload → parser → adapter → domain.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta, fetchMeta } from '../src/adapters/meta';
import { STANDINGS_SHAPE } from '../src/competition';
import { getBracket, getStandings } from '../src/live';
import { tableShareCard } from '../src/share/cards';
import { formatShareTable } from '../src/share/format';
import { type GroupStandings, tableData, tableKeyArg, tableTitle } from '../src/standings';
import { verdictExtras, verdictQualifiers } from '../src/verdict';
import { MAX_GROUP_ROWS, MAX_GROUPS, parseEspnStandings } from '../src/trust/espn';

type RecordedTeam = { id: string; abbreviation: string; displayName: string };
type RecordedChild = { name: string; standings: { entries: Array<{ team: RecordedTeam }> } };
/** A recorded payload (the competition with no table has no `children` at all). */
type Recorded = { children: RecordedChild[] };
const recorded = (slug: string): Recorded =>
  JSON.parse(readFileSync(new URL(`./fixtures/standings/${slug}.json`, import.meta.url), 'utf8'));
/** The rows of a recorded payload's i-th table. */
function entriesOf(payload: Recorded, i: number) {
  const table = payload.children[i];
  if (!table) throw new Error(`the recorded payload has no table ${i}`);
  return table.standings.entries;
}

/** An adapter for `competition` whose standings request answers `payload`. */
const serving = (competition: string, payload: unknown) =>
  new EspnAdapter({
    competition,
    fetchImpl: (async () => new Response(JSON.stringify(payload))) as unknown as typeof fetch,
  });
const read = (competition: string, key?: string, payload: unknown = recorded(competition)) =>
  getStandings(serving(competition, payload), key);

const row = (id: number, name: string, rank: number, code = `T${id}`) => ({
  team: { id: String(id), abbreviation: code, displayName: name },
  stats: Object.entries({
    gamesPlayed: 1,
    wins: 1,
    ties: 0,
    losses: 0,
    pointsFor: 2,
    pointsAgainst: 0,
    pointDifferential: 2,
    points: 3,
    rank,
  }).map(([n, value]) => ({ name: n, value })),
});
let nextId = 1000;
/** A table child with `n` healthy rows (fresh team ids each time). */
const child = (name: string, n = 2, extra: Record<string, unknown> = {}) => ({
  name,
  standings: { entries: Array.from({ length: n }, (_, i) => row(nextId++, `Team ${nextId}`, i + 1)) },
  ...extra,
});

describe('the shapes are written down, per competition', () => {
  it('a league is authorised to serve ONE table; everything else is groups, or has no table', () => {
    expect(STANDINGS_SHAPE).toEqual({
      'eng.1': 'league',
      'esp.1': 'league',
      'ita.1': 'league',
      'ger.1': 'league',
      'mex.1': 'league',
      'uru.1': 'league',
      'uefa.champions': 'league',
      'concacaf.champions': 'none',
    });
  });
});

describe('a league: one table, key LEAGUE, labelled with the provider’s name', () => {
  for (const [slug, rows, label] of [
    ['eng.1', 20, '2026-27 English Premier League'],
    ['esp.1', 20, '2026-27 LALIGA'],
    ['ita.1', 20, '2026-2027 Italian Serie A'],
    ['ger.1', 18, '2026-27 German Bundesliga'],
    ['mex.1', 18, '2026 Torneo Apertura'],
    ['uru.1', 16, 'Torneo Clausura 2026'],
    ['uefa.champions', 36, 'League Phase'],
  ] as const) {
    it(`${slug}: ${rows} rows, live, attributed`, async () => {
      const r = await read(slug);
      expect(r.degraded).toBe(false);
      expect(r.source).toBe('espn');
      expect(r.incomplete).toBeUndefined();
      expect(r.tables.map((t) => [t.group, t.label, t.rows.length, t.partial])).toEqual([['LEAGUE', label, rows, undefined]]);
      // In the provider's rank order, 1..n.
      expect(r.tables[0]?.rows.map((x) => x.rank)).toEqual(Array.from({ length: rows }, (_, i) => i + 1));
      // The key reads it too, in any case.
      expect((await read(slug, 'league')).tables.map((t) => t.group)).toEqual(['LEAGUE']);
    });
  }

  it('the first row is the provider’s first row', async () => {
    const top = (await read('eng.1')).tables[0]?.rows[0];
    expect(top?.team).toMatchObject({ id: 'espn:382', code: 'MNC', name: 'Manchester City' });
    expect(top).toMatchObject({ played: 5, won: 5, points: 15, rank: 1 });
  });
});

describe('numbered groups (UEFA Nations League)', () => {
  it('fourteen tables, keyed A1 … D2, each with its label', async () => {
    const r = await read('uefa.nations');
    expect(r.degraded).toBe(false);
    expect(r.incomplete).toBeUndefined();
    expect(r.tables.map((t) => t.group)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2']);
    expect(r.tables[0]?.label).toBe('Group A1');
    expect(r.tables.every((t) => t.rows.length >= 3)).toBe(true);
  });

  it('`A1` is Group A1; `A` is no group at all, not Group A1', async () => {
    const a1 = await read('uefa.nations', 'a1');
    expect(a1.tables.map((t) => t.group)).toEqual(['A1']);
    const a = await read('uefa.nations', 'A');
    expect(a).toEqual({ tables: [], degraded: false, source: 'espn' });
  });
});

describe('groups under a league (Concacaf Nations League)', () => {
  const KEYS = ['A-A', 'A-B', 'B-A', 'B-B', 'B-C', 'B-D', 'C-A', 'C-B', 'C-C'];

  it('nine tables, nine keys, none dropped (four were read as the whole competition)', async () => {
    const r = await read('concacaf.nations.league');
    expect(r.degraded).toBe(false);
    expect(r.incomplete).toBeUndefined();
    expect(r.tables.map((t) => t.group)).toEqual(KEYS);
    expect(r.tables.map((t) => t.label)).toEqual([
      'League A, Group A',
      'League A, Group B',
      'League B, Group A',
      'League B, Group B',
      'League B, Group C',
      'League B, Group D',
      'League C, Group A',
      'League C, Group B',
      'League C, Group C',
    ]);
    expect(r.tables.map((t) => t.rows.length)).toEqual([6, 6, 4, 4, 4, 4, 3, 3, 3]);
  });

  it('`A-B` is League A, Group B; `B` alone is no group', async () => {
    const payload = recorded('concacaf.nations.league');
    const sent = entriesOf(payload, 1);
    const ab = await read('concacaf.nations.league', 'a-b');
    expect(ab.tables.map((t) => t.label)).toEqual(['League A, Group B']);
    expect(ab.tables[0]?.rows.map((x) => x.team.name).sort()).toEqual(sent.map((e) => e.team.displayName).sort());
    expect(await read('concacaf.nations.league', 'B')).toEqual({ tables: [], degraded: false, source: 'espn' });
  });
});

describe('the lettered competitions read as they did', () => {
  for (const [slug, n] of [
    ['fifa.world', 12],
    ['fifa.cwc', 8],
    ['conmebol.libertadores', 8],
    ['conmebol.america', 4],
    ['concacaf.gold', 4],
    ['uefa.euro', 6],
  ] as const) {
    it(`${slug}: ${n} lettered groups, no label`, async () => {
      const r = await read(slug);
      expect(r.degraded).toBe(false);
      expect(r.incomplete).toBeUndefined();
      expect(r.tables.map((t) => t.group)).toEqual('ABCDEFGHIJKL'.slice(0, n).split(''));
      expect(r.tables.every((t) => t.label === undefined && t.rows.length === 4 && !t.partial)).toBe(true);
    });
  }

});

describe('a competition with no table by design', () => {
  it('answers with no table list at all, and that is an empty answer, not an outage', async () => {
    // What the Concacaf Champions Cup's endpoint answers: its seasons, no `children`.
    expect(recorded('concacaf.champions')).not.toHaveProperty('children');
    expect(await read('concacaf.champions')).toEqual({ tables: [], degraded: false, source: 'espn' });
    expect(await read('concacaf.champions', 'A')).toEqual({ tables: [], degraded: false, source: 'espn' });
  });

  it('only there: a missing table list anywhere else is an answer that cannot be read', async () => {
    const answer = recorded('concacaf.champions');
    expect(await read('eng.1', undefined, answer)).toEqual({ tables: [], degraded: true });
    expect(await read('uefa.nations', undefined, answer)).toEqual({ tables: [], degraded: true });
    expect((await read('fifa.world', undefined, answer)).degraded).toBe(true);
  });

  it('an empty list of children is the same empty answer', async () => {
    expect(await read('concacaf.champions', undefined, { ...recorded('concacaf.champions'), children: [] })).toEqual({ tables: [], degraded: false, source: 'espn' });
  });

  it('and if it ever serves a child, the competition is not what was written down: nothing is read', async () => {
    for (const children of [[child('Group A', 4)], [{ name: 'Round of 16', standings: { entries: [] } }]]) {
      const r = await read('concacaf.champions', undefined, { ...recorded('concacaf.champions'), children });
      expect(r, JSON.stringify(children).slice(0, 40)).toEqual({ tables: [], degraded: true });
    }
  });

  it('only the competition’s own document is an empty answer', () => {
    // What it is, as recorded: a name, a season, no table list, no table.
    const doc = recorded('concacaf.champions') as unknown as Record<string, unknown>;
    expect(parseEspnStandings(doc, 'none')).toMatchObject({ items: [], complete: true, inventory: 'complete' });
    // The real answer also carries a `uid` and the list of past `seasons` (measured; the recorder kept neither).
    const whole = { ...doc, uid: 's:600~l:5699', seasons: [{ year: 2025 }, { year: 2024 }] };
    expect(parseEspnStandings(whole, 'none')).toMatchObject({ items: [], complete: true, inventory: 'complete' });
    // Found in review: "an object with a name" was enough, so an error body
    // that happens to carry one, and a document with a table at its root,
    // were both a healthy "no standings".
    const table = { entries: [row(1, 'One', 1), row(2, 'Two', 2)] };
    for (const body of [
      null,
      [],
      'x',
      0,
      {},
      { code: 404, message: 'Not Found' },
      { name: 7, season: doc.season },
      { name: '', season: doc.season },
      { name: 'Error', code: 404, message: 'not found' }, // a name, and nothing else of the document
      // Found in review: an error body that ALSO carries a season passed. The
      // document is the one that was measured: its keys, and no others.
      { name: 'Error', season: { year: 2026 }, code: 500, message: 'standings unavailable' },
      { ...doc, somethingNew: 1 },
      { ...doc, error: null },
      { name: doc.name }, // no season
      { ...doc, season: 'x' },
      // "States a season" is the product's one rule for a season (`sealSeason`): a year.
      { ...doc, season: null },
      { ...doc, season: [] },
      { ...doc, season: {} }, // an object is not a season
      { ...doc, season: { year: 'x' } },
      { ...doc, season: { year: 20260 } },
      { ...doc, standings: table }, // the document, with a table at its root
    ]) {
      expect(parseEspnStandings(body, 'none').complete, JSON.stringify(body).slice(0, 60)).toBe(false);
    }
  });
});

describe('the key comes from the RAW name, whole', () => {
  const open = (children: unknown[], key?: string) => read('synthetic.cup', key, { children });

  it('a name that only becomes a group after sanitizing is not that group', async () => {
    // Both sanitize to exactly "Group A": an invisible character, and a tail
    // that the label's length bound cuts off.
    for (const name of ['Group A\u200b', `Group A${' '.repeat(150)}1`, 'Group A\n', ' Group A', 'Group  A', 'XGroup A']) {
      const parsed = parseEspnStandings({ children: [child(name)] });
      expect(parsed.items, JSON.stringify(name)).toEqual([]);
      expect(parsed.inventory, JSON.stringify(name)).toBe('incomplete');
    }
  });

  it('the grammars, in any case: a letter, a letter and a digit, a league and a group', () => {
    const parsed = parseEspnStandings({ children: [child('group b'), child('GROUP C3'), child('league d, group e')] });
    expect(parsed.items.map((t) => [t.group, t.label])).toEqual([
      ['B', undefined],
      ['C3', 'GROUP C3'],
      ['D-E', 'league d, group e'],
    ]);
    expect(parsed.inventory).toBe('complete');
  });

  it('a name with no readable label is not a table', async () => {
    const parsed = parseEspnStandings({ children: [child('\u200b\u200b')] }, 'league');
    expect(parsed.items).toEqual([]);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('a name outside the grammar in a GROUPS competition is never a league, however alone it is', async () => {
    const r = await open([child('2026-27 Some League', 20)]);
    expect(r.tables).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
  });

});

describe('a payload with tables the parser cannot inspect is refused whole', () => {
  // A table nobody inspected could claim a key that was accepted: no table in
  // the payload can then be shown to be the only one with its key.
  const nested = (inner: unknown[]) => ({ name: 'Another phase', children: inner, standings: { entries: [] } });

  it('a child with children of its own: nothing is read, beside a readable sibling too', async () => {
    for (const tree of [nested([child('Group A')]), nested([null]), { name: 'Another phase', children: 'x' }, { name: 'Another phase', children: null }, { ...child('Group C', 4), children: [child('Group A')] }]) {
      const parsed = parseEspnStandings({ children: [child('Group A', 4), child('Group B', 4), tree] });
      expect(parsed.items, JSON.stringify(tree)).toEqual([]);
      expect(parsed.complete).toBe(false);
      expect(parsed.inventory).toBe('incomplete');
      const payload = { children: [child('Group A', 4), child('Group B', 4), tree] };
      expect(await read('synthetic.cup', undefined, payload)).toEqual({ tables: [], degraded: true });
      expect(await read('synthetic.cup', 'B', payload)).toEqual({ tables: [], degraded: true });
    }
  });

  it('an EMPTY list of children holds no table: it refuses nothing', async () => {
    // Found in review: the rule was wider than its reason. A child that says
    // "I have no children" has no table nobody inspected, and it blanked every
    // table of the competition (on the World Cup: all twelve, for the roster).
    const wc = recorded('fifa.world');
    const withEmpty = { children: wc.children.map((c, i) => (i === 5 ? { ...c, children: [] } : c)) };
    const all = await read('fifa.world', undefined, withEmpty);
    expect(all.degraded).toBe(false);
    expect(all.tables).toHaveLength(12);
    const euro = recorded('uefa.euro');
    const open = await read('uefa.euro', undefined, { children: euro.children.map((c) => ({ ...c, children: [] })) });
    expect(open).toMatchObject({ degraded: false, source: 'espn' });
    expect(open.tables).toHaveLength(6);
    expect(open.incomplete).toBeUndefined();
    // A stage with no rows and no children is still an unread child, not a refusal.
    const stage = await read('uefa.euro', undefined, { children: [...euro.children, { name: 'Knockout', children: [], standings: { entries: [] } }] });
    expect(stage.tables).toHaveLength(6);
    expect(stage.incomplete).toBe(true);
  });

  it('a table at the ROOT, beside the children, is a table nobody read: the inventory is not whole', async () => {
    // Found in review: only `children` was read, so a table the provider put
    // at the root was skipped in silence, against "nothing is skipped" (and
    // against the no-table shape, which refuses a root table). No recorded
    // payload has one.
    const table = { entries: [row(1, 'One', 1), row(2, 'Two', 2)] };
    const euro = { ...recorded('uefa.euro'), standings: table };
    const all = await read('uefa.euro', undefined, euro);
    expect(all.tables).toHaveLength(6);
    expect(all.incomplete).toBe(true);
    expect(await read('uefa.euro', 'Z', euro)).toEqual({ tables: [], degraded: true });
    const league = await read('eng.1', undefined, { ...recorded('eng.1'), standings: table });
    expect(league.tables).toHaveLength(1);
    expect(league.incomplete).toBe(true);
    // With a declared scope the scope decides, as for any table outside it.
    const wc = await read('fifa.world', undefined, { ...recorded('fifa.world'), standings: table });
    expect(wc).toMatchObject({ degraded: false, source: 'espn' });
    expect(wc.tables).toHaveLength(12);
    expect(wc.incomplete).toBeUndefined();
    // ANY value at the root but an absent key: nobody decided what it is, so it was not read.
    for (const root of [null, {}, [], 0, '', { entries: [] }]) {
      const r = await read('uefa.euro', undefined, { ...recorded('uefa.euro'), standings: root });
      expect(r.incomplete, JSON.stringify(root)).toBe(true);
      expect(r.tables, JSON.stringify(root)).toHaveLength(6);
    }
    // The control: the same payloads without it are whole.
    expect((await read('uefa.euro')).incomplete).toBeUndefined();
    expect((await read('eng.1')).incomplete).toBeUndefined();
  });

  it('on the World Cup: twelve healthy groups and a phase whose children hold another Group A are not twelve live tables', async () => {
    const wc = recorded('fifa.world');
    const payload = { children: [...wc.children, nested([{ ...wc.children[0] }])] };
    const all = await read('fifa.world', undefined, payload);
    expect(all.degraded).toBe(true);
    expect(all.source).toBeUndefined();
    // A keyed read has no more authority than the aggregate.
    expect((await read('fifa.world', 'B', payload)).degraded).toBe(true);
  });

  it('a flat sibling the parser inspected and could not name is NOT that: its siblings are served', async () => {
    const r = await read('synthetic.cup', undefined, { children: [child('Group A', 4), child('Second Phase', 3)] });
    expect(r.tables.map((t) => t.group)).toEqual(['A']);
    expect(r.incomplete).toBe(true);
    expect(r.source).toBe('espn');
  });
});

describe('a league competition must serve exactly one readable table', () => {
  const league = (children: unknown[]) => read('eng.1', undefined, { children });

  it('two tables (an Apertura and a Clausura together): unavailable, never the first one', async () => {
    const r = await league([child('2026 Torneo Apertura', 18), child('2026 Torneo Clausura', 18)]);
    expect(r).toEqual({ tables: [], degraded: true });
  });

  it('one table beside a sibling that cannot be read: unavailable', async () => {
    for (const sibling of [{ name: 'Clausura', standings: { entries: 'bad' } }, { name: 'Clausura' }, null, { name: 'Clausura', standings: { entries: [] } }]) {
      const r = await league([child('2026 Torneo Apertura', 18), sibling]);
      expect(r, JSON.stringify(sibling)).toEqual({ tables: [], degraded: true });
    }
  });

  it('no table at all (between seasons) is a healthy empty', async () => {
    expect(await league([])).toEqual({ tables: [], degraded: false, source: 'espn' });
  });

  it('its one child with no rows is a table that was not read, not a healthy empty', async () => {
    const r = await league([{ name: '2027-28 English Premier League', standings: { entries: [] } }]);
    expect(r).toEqual({ tables: [], degraded: true });
  });

  it('a grouped competition whose payload shrinks to one child is still a group', async () => {
    const r = await read('uefa.euro', undefined, { children: [child('Group C', 4)] });
    expect(r.tables.map((t) => [t.group, t.label])).toEqual([['C', undefined]]);
  });
});

describe('a key that two children claim belongs to neither', () => {
  const pair = (first: string, second: string) => [child(first, 4), child('Group B', 4), child(second, 4)];

  it('both orders, any case: neither is a table, and the read says it is not whole', async () => {
    for (const [first, second] of [
      ['Group A', 'group a'],
      ['group a', 'Group A'],
    ] as const) {
      const r = await read('synthetic.cup', undefined, { children: pair(first, second) });
      expect(r.tables.map((t) => t.group)).toEqual(['B']);
      expect(r.incomplete).toBe(true);
      // Asked for by key, the collided group is not "no such group": it is there and unreadable.
      expect(await read('synthetic.cup', 'A', { children: pair(first, second) })).toEqual({ tables: [], degraded: true });
      // A group that was read whole is returned, with no verdict about the batch.
      expect(await read('synthetic.cup', 'B', { children: pair(first, second) })).toMatchObject({ degraded: false, source: 'espn' });
      expect((await read('synthetic.cup', 'B', { children: pair(first, second) })).incomplete).toBeUndefined();
    }
  });

  it('the second claim can be anywhere among the children that are inspected', () => {
    const many = [child('Group A', 4), ...Array.from({ length: 62 }, (_, i) => ({ name: `Stage ${i}`, standings: { entries: [] } })), child('Group A', 4)];
    expect(many).toHaveLength(64);
    const parsed = parseEspnStandings({ children: many });
    expect(parsed.items).toEqual([]);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('on the World Cup the collided group takes the degraded fallback: twelve live tables are not shown with a wrong one', async () => {
    const wc = recorded('fifa.world');
    const twice = { children: [...wc.children, { ...wc.children[0], name: 'group a' }] };
    const all = await read('fifa.world', undefined, twice);
    expect(all.degraded).toBe(true);
    expect(all.source).toBeUndefined();
    const a = await read('fifa.world', 'A', twice);
    expect(a.degraded).toBe(true);
    // A group nobody contested is still served live.
    const b = await read('fifa.world', 'B', twice);
    expect(b).toMatchObject({ degraded: false, source: 'espn' });
  });
});

describe('a contested group confirms nothing in the bracket', () => {
  it('the bracket falls back to its topology when two children claim Group A (the first used to stay authoritative)', async () => {
    const wc = recorded('fifa.world');
    const bracketOn = (standings: unknown) =>
      getBracket(
        new EspnAdapter({
          competition: 'fifa.world',
          fetchImpl: (async (input: unknown) =>
            new Response(JSON.stringify(String(input).includes('/standings') ? standings : { leagues: [{}], events: [] }))) as unknown as typeof fetch,
        }),
        {},
      );
    const healthy = await bracketOn(wc);
    expect(healthy.standingsDegraded).toBe(false);
    const contested = await bracketOn({ children: [...wc.children, { ...wc.children[0], name: 'group a' }] });
    expect(contested.standingsDegraded).toBe(true);
  });
});

describe('more children than the parser inspects is not a payload it reads', () => {
  it('twelve healthy groups, 52 stages and a 65th child contradicting Group A: refused, not twelve tables', async () => {
    const wc = recorded('fifa.world');
    const stages = Array.from({ length: 52 }, (_, i) => ({ name: `Stage ${i}`, standings: { entries: [] } }));
    const payload = { children: [...wc.children, ...stages, { ...wc.children[0] }] };
    expect(payload.children).toHaveLength(65);
    const parsed = parseEspnStandings(payload);
    expect(parsed.items).toEqual([]);
    expect(parsed.complete).toBe(false);
    const r = await read('fifa.world', undefined, payload);
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
    // Sixty-four is read.
    expect(parseEspnStandings({ children: payload.children.slice(0, 64) }).items).toHaveLength(12);
  });
});

describe('two kinds of "not whole", kept apart', () => {
  const broken = { team: { id: '9', abbreviation: 'BRK', displayName: 'Broken' }, stats: [] };

  it('a refused ROW makes its table partial and leaves the inventory complete', async () => {
    const payload = { children: [{ name: 'Group A', standings: { entries: [row(1, 'One', 1), broken, row(2, 'Two', 3)] } }] };
    const parsed = parseEspnStandings(payload);
    expect(parsed.items[0]?.partial).toEqual({ omitted: 1 });
    expect(parsed.inventory).toBe('complete');
    expect(parsed.complete).toBe(false); // the existing flag: not every RECORD was read
    const all = await read('synthetic.cup', undefined, payload);
    expect(all.incomplete).toBeUndefined();
    expect(all.tables[0]?.partial).toEqual({ omitted: 1 });
    // So another key is definitively absent.
    expect(await read('synthetic.cup', 'B', payload)).toEqual({ tables: [], degraded: false, source: 'espn' });
  });

  it('a table child that did not become a table makes the inventory incomplete', async () => {
    for (const sibling of [
      { name: 'Unexpected', standings: { entries: 'bad' } }, // rows that are not a list
      { name: 'Unexpected', standings: { entries: {} } },
      { name: 'Unexpected' }, // no rows list at all
      child('Second Phase', 3), // a name outside the grammar, with rows
      { name: 'Group C', standings: { entries: [] } }, // a group with no rows is a group that was not read
      { name: 'Group C', standings: { entries: [broken] } }, // a group whose every row was refused
      null,
    ]) {
      const payload = { children: [child('Group A', 4), sibling] };
      expect(parseEspnStandings(payload).inventory, JSON.stringify(sibling)).toBe('incomplete');
      const all = await read('synthetic.cup', undefined, payload);
      expect(all.tables.map((t) => t.group), JSON.stringify(sibling)).toEqual(['A']);
      expect(all.incomplete, JSON.stringify(sibling)).toBe(true);
      expect(all.source).toBe('espn');
      // A key that was not read may be the table that was refused: unavailable, not "no group".
      expect(await read('synthetic.cup', 'C', payload), JSON.stringify(sibling)).toEqual({ tables: [], degraded: true });
      // A key that was read is returned, with no verdict about the batch.
      const a = await read('synthetic.cup', 'A', payload);
      expect(a.tables.map((t) => t.group)).toEqual(['A']);
      expect(a.incomplete).toBeUndefined();
    }
  });

  it('a NAMED group with no rows is a table that was not read: alone it is unavailable, not a healthy empty', async () => {
    const alone = { children: [{ name: 'Group B', standings: { entries: [] } }] };
    expect(parseEspnStandings(alone).inventory).toBe('incomplete');
    expect(await read('synthetic.cup', undefined, alone)).toEqual({ tables: [], degraded: true });
    expect(await read('synthetic.cup', 'B', alone)).toEqual({ tables: [], degraded: true });
  });

  it('no children at all is a healthy empty answer, attributed', async () => {
    expect(parseEspnStandings({ children: [] })).toMatchObject({ items: [], complete: true, inventory: 'complete' });
    expect(await read('synthetic.cup', undefined, { children: [] })).toEqual({ tables: [], degraded: false, source: 'espn' });
  });

  it('nothing is skipped: an empty rows list under a name the grammar does not know is an unread child too', async () => {
    // It used to be waved through as "a knockout stage". No measured payload
    // holds such a child, and a name the grammar REJECTS must not get through
    // by having no rows.
    for (const name of ['Round of 16', 'Group A\u200b', 'Group A10', `Group A${' '.repeat(150)}1`]) {
      const payload = { children: [child('Group B', 4), { name, standings: { entries: [] } }] };
      expect(parseEspnStandings(payload).inventory, JSON.stringify(name)).toBe('incomplete');
      const all = await read('synthetic.cup', undefined, payload);
      expect(all.tables.map((t) => t.group)).toEqual(['B']);
      expect(all.incomplete, JSON.stringify(name)).toBe(true);
      // No key is invented from the rejected name, and A is not "no such group".
      expect(await read('synthetic.cup', 'A', payload), JSON.stringify(name)).toEqual({ tables: [], degraded: true });
    }
  });

  it('the adapter carries both on the result', async () => {
    const whole = await serving('uefa.nations', recorded('uefa.nations')).fetchStandings();
    expect(fetchMeta(whole)).toMatchObject({ complete: true, inventoryComplete: true });
    const short = await serving('synthetic.cup', { children: [child('Group A', 4), child('Second Phase', 3)] }).fetchStandings();
    expect(fetchMeta(short)).toMatchObject({ complete: false, inventoryComplete: false });
  });
});

describe('with an expected list (the World Cup), the list decides', () => {
  it('a table outside the list is not shown and does not blank a complete read', async () => {
    const wc = recorded('fifa.world');
    const extra = { children: [...wc.children, child('Group M', 4)] };
    const all = await read('fifa.world', undefined, extra);
    expect(all.degraded).toBe(false);
    expect(all.incomplete).toBeUndefined();
    expect(all.tables.map((t) => t.group)).toEqual('ABCDEFGHIJKL'.split(''));
    expect(await read('fifa.world', 'M', extra)).toEqual({ tables: [], degraded: false });
  });

  it('a table outside the list is not PARSED: it takes no row from an expected table and names no fixture group', async () => {
    // Listed FIRST, with Group A's own teams: read, it would occupy the
    // identity ledger, every row of Group A would be refused as a team seen
    // twice, and the whole read would fall back to the roster.
    const wc = recorded('fifa.world');
    const stolen = { children: [{ ...wc.children[0], name: 'Group M' }, ...wc.children] };
    const all = await read('fifa.world', undefined, stolen);
    expect(all.degraded).toBe(false);
    expect(all.tables).toHaveLength(12);
    expect(all.tables[0]?.rows).toHaveLength(4);
    expect(all.tables[0]?.partial).toBeUndefined();
    const maps = await serving('fifa.world', stolen).fetchGroupMap();
    expect(new Set(Object.values(maps))).toEqual(new Set('ABCDEFGHIJKL'.split('')));
    // The parser says so itself: with a declared scope the child is an unread one, and costs no row.
    const counter = { n: 0 };
    const watched = entriesOf(wc, 0).map(
      (e) =>
        new Proxy(e, {
          get(target, key, receiver) {
            if (key === 'team') counter.n++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const counted = { name: 'Group M', standings: { entries: watched } };
    const parsed = parseEspnStandings({ children: [counted, ...wc.children] }, 'groups', 'ABCDEFGHIJKL'.split(''));
    expect(parsed.items.map((t) => t.group)).toEqual('ABCDEFGHIJKL'.split(''));
    expect(counter.n).toBe(0);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('for ANY adapter: an all-tables read with nothing read and tables missing is unavailable, not an empty answer with a verdict', async () => {
    // Found in review. The ESPN adapter throws in this state; the rule must
    // not live in one adapter. Text said "No standings available" with the
    // provider's name, and structured output said `incomplete: true`.
    const none: GroupStandings[] = [];
    const other = {
      name: 'other',
      competition: 'synthetic.cup',
      capabilities: { push: false, latencyHintSec: 0 },
      fetchByDate: async () => [],
      fetchLive: async () => [],
      fetchStandings: async () => attachFetchMeta(none, { complete: false, inventoryComplete: false }),
    };
    expect(await getStandings(other)).toEqual({ tables: [], degraded: true });
  });

  it('the list decides for ANY adapter: one that hands back a table outside its own list does not get it shown', async () => {
    // The ESPN adapter never parses such a table; another provider's adapter might return one.
    const table = (group: string) => ({ group, rows: [{ team: { code: 'AAA', name: 'A', flag: '🏳️' }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 }] });
    const other = {
      name: 'other',
      competition: 'synthetic.cup',
      capabilities: { push: false, latencyHintSec: 0 },
      expectedStandingsGroups: ['A'],
      fetchByDate: async () => [],
      fetchLive: async () => [],
      fetchStandings: async () => [table('A'), table('M')],
    };
    expect((await getStandings(other)).tables.map((t) => t.group)).toEqual(['A']);
  });

  it('nor does a child nobody can read', async () => {
    const wc = recorded('fifa.world');
    const all = await read('fifa.world', undefined, { children: [...wc.children, child('Second Phase', 3)] });
    expect(all.degraded).toBe(false);
    expect(all.incomplete).toBeUndefined();
    expect(all.tables).toHaveLength(12);
  });
});

describe('bounds, applied before the work', () => {
  /** `n` rows whose `team` is read through a counter: one read per row parsed. */
  const counted = (n: number, counter: { rows: number }, healthy = true) =>
    Array.from({ length: n }, (_, i) => {
      const r = healthy ? row(nextId++, `Team ${nextId}`, i + 1) : { team: { id: String(nextId++), abbreviation: 'X', displayName: 'X' }, stats: [] };
      return new Proxy(r, {
        get(target, key, receiver) {
          if (key === 'team') counter.rows++;
          return Reflect.get(target, key, receiver);
        },
      });
    });

  it('the fortieth row is read and the forty-first is not', () => {
    expect(MAX_GROUP_ROWS).toBe(40);
    const counter = { rows: 0 };
    const parsed = parseEspnStandings({ children: [{ name: 'League Phase', standings: { entries: counted(41, counter) } }] }, 'league');
    expect(parsed.items[0]?.rows).toHaveLength(40);
    expect(parsed.items[0]?.rows.at(-1)?.rank).toBe(40);
    expect(parsed.items[0]?.partial).toEqual({ omitted: 1 });
    expect(counter.rows).toBe(40);
    expect(parsed.inventory).toBe('complete');
  });

  it('the sixteenth table is read and the seventeenth is not', () => {
    expect(MAX_GROUPS).toBe(16);
    const counter = { rows: 0 };
    const names = 'ABCDEFGHIJKLMNOPQ'.split('').map((l) => `Group ${l}`);
    expect(names).toHaveLength(17);
    const parsed = parseEspnStandings({ children: names.map((name) => ({ name, standings: { entries: counted(4, counter) } })) });
    expect(parsed.items.map((t) => t.group)).toEqual('ABCDEFGHIJKLMNOP'.split(''));
    expect(counter.rows).toBe(64);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('a key two children claim costs no slot: the sixteenth table after it is still read', () => {
    const counter = { rows: 0 };
    // SIXTEEN surviving tables (B to Q) beside the two claims on A: with
    // fifteen, a parser that charged the collided key a slot still passed.
    const names = ['Group A', ...'BCDEFGHIJKLMNOP'.split('').map((l) => `Group ${l}`), 'group a', 'Group Q'];
    expect(names).toHaveLength(18);
    const parsed = parseEspnStandings({ children: names.map((name) => ({ name, standings: { entries: counted(4, counter) } })) });
    expect(parsed.items.map((t) => t.group)).toEqual('BCDEFGHIJKLMNOPQ'.split(''));
    expect(counter.rows).toBe(16 * 4);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('a slot is taken before the rows are parsed and is never given back', () => {
    // 64 children, 64 distinct keys, forty malformed rows each: no table is
    // ACCEPTED, so a budget that counted accepted tables would parse them all.
    const counter = { rows: 0 };
    const keys: string[] = [];
    for (const l of 'ABCDEFGH') for (const d of '12345678') keys.push(`Group ${l}${d}`);
    const parsed = parseEspnStandings({ children: keys.map((name) => ({ name, standings: { entries: counted(40, counter, false) } })) });
    expect(parsed.items).toEqual([]);
    expect(counter.rows).toBe(16 * 40);
    expect(parsed.inventory).toBe('incomplete');
  });

  it('a key withdrawn by a collision costs no rows at all', () => {
    const counter = { rows: 0 };
    const parsed = parseEspnStandings({
      children: [
        { name: 'Group A', standings: { entries: counted(4, counter) } },
        { name: 'Group B', standings: { entries: counted(4, counter) } },
        { name: 'group a', standings: { entries: counted(4, counter) } },
      ],
    });
    expect(parsed.items.map((t) => t.group)).toEqual(['B']);
    expect(counter.rows).toBe(4);
  });
});

describe('a table key is not a fixture’s group', () => {
  // A fixture with no stage name is read as a group-stage fixture, and takes
  // its group from the standings: "Group LEAGUE" on a Premier League match.
  const fixture = (home: [string, string, string], away: [string, string, string]) => ({
    id: '900001',
    date: '2026-10-10T15:00Z',
    // A group-stage fixture: a group letter attaches under GROUP only, and a
    // record with no slug states no phase at all (0.11 · 2.4).
    season: { slug: 'group-stage' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: home[0], abbreviation: home[1], displayName: home[2] } },
          { homeAway: 'away', team: { id: away[0], abbreviation: away[1], displayName: away[2] } },
        ],
      },
    ],
  });
  const both = (competition: string, standings: unknown, events: unknown[]) =>
    new EspnAdapter({
      competition,
      fetchImpl: (async (input: unknown) =>
        new Response(JSON.stringify(String(input).includes('/standings') ? standings : { leagues: [{}], events }))) as unknown as typeof fetch,
    });
  const teamsOf = (payload: Recorded, i: number) =>
    entriesOf(payload, i).map((e) => [e.team.id, e.team.abbreviation, e.team.displayName] as [string, string, string]);

  it('a league table is read, and puts no group on a fixture', async () => {
    const payload = recorded('eng.1');
    const [a, b] = teamsOf(payload, 0);
    const adapter = both('eng.1', payload, [fixture(a as [string, string, string], b as [string, string, string])]);
    expect((await getStandings(adapter)).tables.map((t) => t.group)).toEqual(['LEAGUE']);
    const [m] = await adapter.fetchByDate('2026-10-10');
    expect(m?.home.name).toBe(a?.[2]);
    expect(m?.group).toBeUndefined();
  });

  it('neither do numbered groups or groups under a league', async () => {
    for (const slug of ['uefa.nations', 'concacaf.nations.league']) {
      const payload = recorded(slug);
      const [a, b] = teamsOf(payload, 0);
      const adapter = both(slug, payload, [fixture(a as [string, string, string], b as [string, string, string])]);
      expect((await getStandings(adapter)).tables.length).toBeGreaterThan(1);
      const [m] = await adapter.fetchByDate('2026-10-10');
      expect(m?.group, slug).toBeUndefined();
    }
  });

  it('a lettered group still does', async () => {
    const payload = recorded('uefa.euro');
    const [a, b] = teamsOf(payload, 2);
    const adapter = both('uefa.euro', payload, [fixture(a as [string, string, string], b as [string, string, string])]);
    const [m] = await adapter.fetchByDate('2026-10-10');
    expect(m?.group).toBe('C');
  });

  it('a code a lettered table shares with a NUMBERED or nested one names no group either', async () => {
    // Found in review: tables that are not lettered were skipped BEFORE the
    // shared codes were counted, so `CAR` in Group A and in Group B1 still
    // mapped to A, and a Caracas fixture (Group B1) was labelled Group A.
    for (const other of ['Group B1', 'League A, Group B']) {
      const standings = {
        children: [
          { name: 'Group A', standings: { entries: [row(1, 'Carabobo', 1, 'CAR'), row(2, 'Alpha', 2, 'ALP')] } },
          { name: other, standings: { entries: [row(3, 'Caracas', 1, 'CAR'), row(4, 'Beta', 2, 'BET')] } },
        ],
      };
      const maps = await both('synthetic.cup', standings, []).fetchGroupMap();
      expect(maps.CAR, other).toBeUndefined();
      expect(maps.ALP, other).toBe('A');
      expect(maps.BET, other).toBeUndefined(); // not a lettered group: it names no fixture's group
      const noId = fixture(['', 'CAR', 'Caracas'], ['', 'BET', 'Beta']);
      for (const side of noId.competitions[0]?.competitors ?? []) (side.team as { id?: string }).id = undefined;
      const [anon] = await both('synthetic.cup', standings, [noId]).fetchByDate('2026-10-10');
      expect(anon?.group, other).toBeUndefined();
    }
  });

  it('a code that two tables hold names neither group; the same teams’ ids still do', async () => {
    // Two clubs share `CAR` (the Libertadores has such a pair). A fixture whose
    // team has no id used to take the group of whichever table came later.
    const standings = {
      children: [
        { name: 'Group A', standings: { entries: [row(1, 'Carabobo', 1, 'CAR'), row(2, 'Alpha', 2, 'ALP')] } },
        { name: 'Group B', standings: { entries: [row(3, 'Caracas', 1, 'CAR'), row(4, 'Beta', 2, 'BET')] } },
      ],
    };
    const maps = await both('synthetic.cup', standings, []).fetchGroupMap();
    expect(maps.CAR).toBeUndefined();
    expect(maps.ALP).toBe('A');
    // A fixture between two teams the feed gave no id: the shared code says nothing.
    const noId = fixture(['', 'CAR', 'Carabobo'], ['', 'CAR', 'Caracas']);
    for (const side of noId.competitions[0]?.competitors ?? []) (side.team as { id?: string }).id = undefined;
    const [anon] = await both('synthetic.cup', standings, [noId]).fetchByDate('2026-10-10');
    expect(anon?.home.name).toBe('Carabobo');
    expect(anon?.group).toBeUndefined();
    const withIds = both('synthetic.cup', standings, [fixture(['3', 'CAR', 'Caracas'], ['4', 'BET', 'Beta'])]);
    const [m] = await withIds.fetchByDate('2026-10-10');
    expect(m?.group).toBe('B');
  });
});

describe('what every surface is built from', () => {
  const shortEuro = () => {
    const payload = recorded('uefa.euro');
    return { children: [...payload.children.slice(0, 2), { ...payload.children[2], name: 'Second Phase' }] };
  };

  it('a table’s structured form carries its label, and only when it has one', async () => {
    const league = (await read('eng.1')).tables[0];
    expect(league && tableData(league)).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    const lettered = (await read('uefa.euro', 'A')).tables[0];
    expect(lettered && Object.keys(tableData(lettered))).toEqual(['group', 'standings']);
  });

  it('a title: "Group A" for a lettered group, the label and the key for any other table', () => {
    expect(tableTitle({ group: 'A' })).toBe('Group A');
    expect(tableTitle({ group: 'A1', label: 'Group A1' })).toBe('Group A1 (A1)');
    expect(tableTitle({ group: 'A-B', label: 'League A, Group B' })).toBe('League A, Group B (A-B)');
    expect(tableTitle({ group: 'LEAGUE', label: 'League Phase' })).toBe('League Phase (LEAGUE)');
  });

  it('an argument is a key (1 to 12 letters, digits or -), upper-cased, or it is nothing', () => {
    expect(['A', 'l', 'a1', 'A-B', 'league', 'ABCDEFGHIJKL'].map(tableKeyArg)).toEqual(['A', 'L', 'A1', 'A-B', 'LEAGUE', 'ABCDEFGHIJKL']);
    for (const junk of ['', 'A B', 'Group A', 'A/B', 'A_B', '../A', 'A\u200b', 'ABCDEFGHIJKLM', 'Á', undefined, null, 7]) {
      expect(tableKeyArg(junk), JSON.stringify(junk)).toBeUndefined();
    }
  });

  it('the missing-table verdict: a key and a sentence, in four languages, only when the read states it', async () => {
    const short = await read('uefa.euro', undefined, shortEuro());
    expect(verdictExtras(short)).toEqual({ incomplete: true });
    expect(verdictQualifiers(short)).toEqual(['Some tables could not be read — this is not the whole competition.']);
    expect(verdictQualifiers(short, 'es')).toEqual(['No se pudieron leer algunas tablas — esta no es la competición completa.']);
    expect(verdictQualifiers(short, 'pt')).toEqual(['Algumas tabelas não puderam ser lidas — esta não é a competição completa.']);
    expect(verdictQualifiers(short, 'fr')).toEqual(["Certains classements n'ont pas pu être lus — ce n'est pas la compétition complète."]);
    const whole = await read('uefa.euro');
    expect(verdictExtras(whole)).toEqual({});
    expect(verdictQualifiers(whole)).toEqual([]);
  });

  it('a share card: the title, the verdict, and the sentence beside the tables', async () => {
    const league = await read('eng.1', 'LEAGUE');
    const card = tableShareCard(league, 'LEAGUE');
    expect(card.verdict).toEqual({});
    expect(card.tables[0]).toMatchObject({ group: 'LEAGUE', label: '2026-27 English Premier League' });
    const snippet = formatShareTable(card.input);
    expect(snippet.split('\n')[0]).toBe('2026-27 English Premier League (LEAGUE) · standings');
    expect(snippet).not.toContain('could not be read');

    const short = tableShareCard(await read('uefa.euro', undefined, shortEuro()), undefined);
    expect(short.verdict).toEqual({ incomplete: true });
    const text = formatShareTable(short.input);
    expect(text).toContain('Group A · standings');
    expect(text).toContain('(Some tables could not be read — this is not the whole competition.)');
    // A verdict's sentence is the localized one on every surface, a card included.
    const es = tableShareCard(await read('uefa.euro', undefined, shortEuro()), undefined, undefined, 'es');
    expect(formatShareTable(es.input)).toContain('(No se pudieron leer algunas tablas — esta no es la competición completa.)');
    expect(formatShareTable(es.input)).toContain('Group A · standings');
    // And it comes BEFORE the tables (what qualifies the body precedes it, since a card is cut from the end),
    // not instead of them, and before the footer.
    expect(text.indexOf('could not be read')).toBeLessThan(text.indexOf('Group A · standings'));
    expect(text.indexOf('could not be read')).toBeLessThan(text.indexOf('Live data: ESPN'));
  });
});
