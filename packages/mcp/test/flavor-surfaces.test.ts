/**
 * The commentary bank on the MCP server (0.11 · 2.7b): get_today's list
 * carries a different phrase on every row, the new moments reach the rows,
 * and a team's rally cry takes the flair slot of its match line (the CLI
 * alone printed Mexico's until now).
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolGetLive, toolGetToday } from '../src/tools';

const NOW = new Date('2026-10-10T15:00:00Z');
function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(800000500 + i),
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
function phrasesIn(out: string, lang: string, moment: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const p of FLAVOR_BANKS[lang]?.[moment] ?? []) {
    const n = out.split(p).length - 1;
    if (n > 0) found.set(p, n);
  }
  return found;
}

const ORIG = process.env.CLAUDINHO_COMPETITION;
const ORIG_FLAVOR = process.env.CLAUDINHO_FLAVOR;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
  process.env.CLAUDINHO_FLAVOR = 'full';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
  if (ORIG_FLAVOR === undefined) delete process.env.CLAUDINHO_FLAVOR;
  else process.env.CLAUDINHO_FLAVOR = ORIG_FLAVOR;
});

describe('get_today: a different phrase on every row', () => {
  it('eight fixtures, eight distinct scheduled phrases, none twice; the same on a second call', async () => {
    const list = Array.from({ length: 8 }, (_, i) => fixture(i));
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, flavor: 'full' });
    const found = phrasesIn(r.text, 'en', 'scheduled');
    expect(found.size).toBe(8);
    for (const [p, n] of found) expect(n, p).toBe(1);
    const again = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, flavor: 'full' });
    expect(again.text).toBe(r.text);
  });

  it('the new moments reach the rows, in Portuguese', async () => {
    const list = [
      fixture(1, { status: 'HT', score: { home: 1, away: 0 }, minute: 45 }),
      fixture(2, { status: 'LIVE', score: { home: 2, away: 2 }, minute: 87 }),
      fixture(3, { status: 'FT', score: { home: 1, away: 1 } }),
    ];
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, flavor: 'full', lang: 'pt' });
    expect(phrasesIn(r.text, 'pt', 'ht').size).toBe(1);
    expect(phrasesIn(r.text, 'pt', 'late').size).toBe(1);
    expect(phrasesIn(r.text, 'pt', 'draw').size).toBe(1);
  });
});

describe('the team rally cries on the MCP lines', () => {
  const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
  const toluca = { code: 'TOL', name: 'Toluca', id: 'espn:223' };
  const america = { code: 'AME', name: 'América', id: 'espn:227' };

  it("get_today under Liga MX: Pumas' line carries '¡Goya!' and no moment phrase; the clásico the home side's cry", async () => {
    process.env.CLAUDINHO_COMPETITION = 'mex.1';
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('mex.1', [fixture(1, { home: pumas, away: toluca })]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('¡Goya!');
    expect(phrasesIn(r.text, 'en', 'scheduled').size).toBe(0);
    const clasico = await toolGetToday({ date: '2026-10-10', adapter: adapter('mex.1', [fixture(1, { home: america, away: pumas })]), now: NOW, flavor: 'full' });
    expect(clasico.text).toContain('¡Ódiame más!');
    expect(clasico.text).not.toContain('¡Goya!');
  });

  it("get_live: Mexico's '¿Y si sí?' by id under a nations competition; nothing with flavor off", async () => {
    process.env.CLAUDINHO_COMPETITION = 'uefa.nations';
    const mex = { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' };
    const live = fixture(1, { home: mex, away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨', id: 'espn:209' }, status: 'LIVE', minute: 20, score: { home: 0, away: 0 } });
    const r = await toolGetLive({ adapter: adapter('uefa.nations', [live]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('¿Y si sí?');
    const off = await toolGetLive({ adapter: adapter('uefa.nations', [live]), now: NOW, flavor: 'off' });
    expect(off.text).not.toContain('¿Y si sí?');
  });
});
