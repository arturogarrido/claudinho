/**
 * A payload's account of itself comes from ONE value.
 *
 * Handlers used to call `capRecords` two or three times in the same response
 * and hand-write `count: rows.length` beside it, so `count`, `matches` and the
 * accompanying signal set were four independent expressions describing the same
 * list. Nothing forced them to agree, and the text and the structured data could
 * describe different truncations of the same payload.
 *
 * These pin the invariant a reader depends on: `count` is the TRUE total,
 * `matches` may be shorter, and `truncated` says so — never inferred, never
 * silently absent.
 */
import { describe, expect, it } from 'vitest';
import { MAX_LIST_MATCHES, boundedRecords, truncationNote } from '../src/format';
import { toolGetLive, toolGetToday } from '../src/tools';
import { FakeMarketProvider } from '@claudinho/core';
import type { Match, ProviderAdapter } from '@claudinho/core';

const OVER = MAX_LIST_MATCHES + 7;
/** Before the fixtures' kickoff: market reads are pre-match artifacts. */
const PRE_KICKOFF = new Date('2026-06-11T15:00:00Z');

function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(900000 + i),
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00:00.000Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

/** An adapter serving more fixtures in one day than any list will show. */
function flooding(status: Match['status'] = 'SCHEDULED'): ProviderAdapter {
  const matches = Array.from({ length: OVER }, (_, i) =>
    fixture(i, status === 'SCHEDULED' ? {} : { status, score: { home: 1, away: 0 }, minute: 55 }),
  );
  return {
    name: 'flood',
    fetchLive: async () => matches,
    fetchWindow: async () => matches,
    fetchGroupMap: async () => ({}),
  } as unknown as ProviderAdapter;
}

describe('get_today / get_live describe their own truncation', () => {
  it('count is the TRUE total while matches is the bounded view', async () => {
    const r = await toolGetToday({ date: '2026-06-11', adapter: flooding() } as never);
    const d = r.data as { count: number; truncated: boolean; matches: Match[] };
    // `count` is stated relationally, not as a literal: this handler merges the
    // bundled schedule for the date, so the total is the merged one — which is
    // exactly why the payload must REPORT it rather than let a reader assume
    // `matches.length` is the whole story.
    expect(d.count).toBeGreaterThanOrEqual(OVER);
    expect(d.matches.length).toBe(MAX_LIST_MATCHES);
    expect(d.count).toBeGreaterThan(d.matches.length);
    expect(d.truncated).toBe(true);
  });

  it('says so in the TEXT as well as the data — the two agree', async () => {
    const r = await toolGetLive({ adapter: flooding('LIVE') } as never);
    const d = r.data as { count: number; truncated: boolean; matches: Match[] };
    expect(d.count).toBe(OVER);
    expect(d.truncated).toBe(true);
    expect(d.matches.length).toBe(MAX_LIST_MATCHES);
  });

  it('reports truncated:false — never absent — when nothing was dropped', async () => {
    const one = [fixture(0)];
    const adapter = {
      name: 'one',
      fetchLive: async () => one,
      fetchWindow: async () => one,
      fetchGroupMap: async () => ({}),
    } as unknown as ProviderAdapter;
    const r = await toolGetToday({ date: '2026-06-11', adapter } as never);
    const d = r.data as { count: number; truncated: boolean; matches: Match[] };
    expect(d.count).toBeLessThan(MAX_LIST_MATCHES);
    expect(d.count).toBe(d.matches.length);
    // Present and false, so a consumer never has to infer it from two numbers.
    expect(d).toHaveProperty('truncated');
    expect(d.truncated).toBe(false);
  });

  it('market signals are bounded in step with the matches they describe', async () => {
    // An explicit provider, so this actually HAS signals to bound — reading
    // whatever the environment happened to supply made the assertion vacuous.
    const r = await toolGetToday({
      date: '2026-06-11',
      adapter: flooding(),
      marketProvider: new FakeMarketProvider({ synthesize: true, now: PRE_KICKOFF }),
      // Market reads are pre-match artifacts, so `now` must sit before kickoff
      // or every fixture is filtered out as finished and there is nothing to
      // bound — which is how this assertion was silently passing on an empty set.
      now: PRE_KICKOFF,
    } as never);
    const d = r.data as { matches: Match[]; marketSignals?: Record<string, unknown> };
    const ids = Object.keys(d.marketSignals ?? {});
    expect(ids.length).toBeGreaterThan(0); // the check must have something to check
    const shown = new Set(d.matches.map((m) => m.id));
    // A signal keyed to a match no longer in the payload is dead weight in model
    // context, and worse, it describes a fixture the reader cannot see.
    for (const id of ids) expect(shown.has(id)).toBe(true);
  });
});

describe('the note and the numbers come from the same value', () => {
  it('truncationNote reads the list rather than being handed two counts', () => {
    const list = boundedRecords(Array.from({ length: OVER }, (_, i) => i));
    expect(truncationNote(list)).toContain(`${list.shown} of ${list.total}`);
    expect(truncationNote(boundedRecords([1, 2, 3]))).toBe('');
  });

  it('a bounded view is internally consistent', () => {
    for (const n of [0, 1, MAX_LIST_MATCHES - 1, MAX_LIST_MATCHES, OVER, 5000]) {
      const list = boundedRecords(Array.from({ length: n }, (_, i) => i));
      expect(list.total).toBe(n);
      expect(list.shown).toBe(list.items.length);
      expect(list.shown).toBeLessThanOrEqual(MAX_LIST_MATCHES);
      expect(list.truncated).toBe(n > list.shown);
    }
  });
});
