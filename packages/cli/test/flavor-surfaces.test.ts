/**
 * The commentary bank on the CLI (0.11 · 2.7b): a day's list prints a
 * different phrase on every row (`flavorsFor`), the three new moments reach
 * the rows (half-time, the late minutes, a draw), `--flavor subtle` stays
 * silent at the break, and a team's rally cry takes the slot for its match
 * (the generalized "¿Y si sí?": Pumas' "¡Goya!" under Liga MX, the pinned
 * side's cry when both sides have one, none with `--flavor off`).
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const NOW = new Date('2026-10-10T15:00:00Z');

function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(800000400 + i),
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: `Ground ${i}`,
    home: { code: `H${i}`, name: `Home ${i}`, id: `espn:${9000 + i}` },
    away: { code: `A${i}`, name: `Away ${i}`, id: `espn:${9100 + i}` },
    status: 'SCHEDULED',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}
function adapter(competition: string, matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return matches.filter((m) => m.status === 'LIVE' || m.status === 'HT');
    },
    async fetchWindow() {
      return matches;
    },
  };
}
function cfg(competition: string, over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition, flavor: 'full', markets: false, ...over });
}
const ctx = (competition: string, matches: Match[], over: Partial<CliConfig> = {}) => ({
  cfg: cfg(competition, over),
  t: makeT(over.lang ?? 'en'),
  adapter: adapter(competition, matches),
  marketProvider: undefined,
  now: NOW,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');
/** The bank phrases the text carries, with how many times each appears. */
function phrasesIn(out: string, lang: string, moment: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const p of FLAVOR_BANKS[lang]?.[moment] ?? []) {
    const n = out.split(p).length - 1;
    if (n > 0) found.set(p, n);
  }
  return found;
}

describe('today: a different phrase on every row', () => {
  it('eight Premier League fixtures print eight distinct scheduled phrases, none twice', async () => {
    const list = Array.from({ length: 8 }, (_, i) => fixture(i));
    await cmdToday('2026-10-10', ctx('eng.1', list));
    const found = phrasesIn(text(), 'en', 'scheduled');
    expect(found.size).toBe(8);
    for (const [p, n] of found) expect(n, p).toBe(1);
  });

  it('in Spanish too, and the same list prints the same phrases on a second run', async () => {
    const list = Array.from({ length: 8 }, (_, i) => fixture(i));
    await cmdToday('2026-10-10', ctx('esp.1', list, { lang: 'es' }));
    const first = text();
    expect(phrasesIn(first, 'es', 'scheduled').size).toBe(8);
    writes = [];
    await cmdToday('2026-10-10', ctx('esp.1', list, { lang: 'es' }));
    expect(text()).toBe(first);
  });
});

describe('the new moments reach the rows', () => {
  it('half-time, the late minutes and a draw each print a phrase of their moment', async () => {
    const list = [
      fixture(1, { status: 'HT', score: { home: 1, away: 0 }, minute: 45 }),
      fixture(2, { status: 'LIVE', score: { home: 2, away: 2 }, minute: 87 }),
      fixture(3, { status: 'FT', score: { home: 1, away: 1 } }),
      fixture(4, { status: 'FT', score: { home: 3, away: 0 } }),
    ];
    await cmdToday('2026-10-10', ctx('eng.1', list));
    const out = text();
    expect(phrasesIn(out, 'en', 'ht').size).toBe(1);
    expect(phrasesIn(out, 'en', 'late').size).toBe(1);
    expect(phrasesIn(out, 'en', 'draw').size).toBe(1);
    expect(phrasesIn(out, 'en', 'ft').size).toBe(1);
  });

  it('live: a match at the break and one in its last minutes, with --flavor subtle silent at the break', async () => {
    const list = [fixture(1, { status: 'HT', score: { home: 0, away: 0 }, minute: 45 }), fixture(2, { status: 'LIVE', score: { home: 0, away: 1 }, minute: 83 })];
    await cmdLive(ctx('eng.1', list));
    expect(phrasesIn(text(), 'en', 'ht').size).toBe(1);
    expect(phrasesIn(text(), 'en', 'late').size).toBe(1);
    writes = [];
    await cmdLive(ctx('eng.1', list, { flavor: 'subtle' }));
    expect(phrasesIn(text(), 'en', 'ht').size).toBe(0);
    expect(phrasesIn(text(), 'en', 'late').size).toBe(0);
  });
});

describe('the team rally cries', () => {
  const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
  const toluca = { code: 'TOL', name: 'Toluca', id: 'espn:223' };
  const america = { code: 'AME', name: 'América', id: 'espn:227' };

  it("Pumas' match under Liga MX carries '¡Goya!' in the flair slot, in every language, and no moment phrase", async () => {
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      writes = [];
      await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: pumas, away: toluca })], { lang }));
      expect(text(), lang).toContain('¡Goya!');
      expect(phrasesIn(text(), lang, 'scheduled').size, lang).toBe(0);
    }
  });

  it("the clásico: the home side's cry, unless the pin is the other side", async () => {
    await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: america, away: pumas })]));
    expect(text()).toContain('¡Ódiame más!');
    expect(text()).not.toContain('¡Goya!');
    writes = [];
    await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: america, away: pumas })], { pin: { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM' } }));
    expect(text()).toContain('¡Goya!');
    expect(text()).not.toContain('¡Ódiame más!');
  });

  it('--flavor off silences the cry; a side with no cry keeps its moment phrase; a club coded MEX is not Mexico', async () => {
    await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: pumas, away: toluca })], { flavor: 'off' }));
    expect(text()).not.toContain('¡Goya!');
    writes = [];
    await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: toluca, away: { code: 'PUE', name: 'Puebla', id: 'espn:231' } })]));
    expect(phrasesIn(text(), 'en', 'scheduled').size).toBe(1);
    writes = [];
    await cmdToday('2026-10-10', ctx('mex.1', [fixture(1, { home: { code: 'MEX', name: 'Mexico FC', id: 'espn:99999' }, away: toluca })]));
    expect(text()).not.toContain('¿Y si sí?');
  });
});
