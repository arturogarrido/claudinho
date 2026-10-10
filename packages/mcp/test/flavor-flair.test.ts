/**
 * The flair slot on MCP: `get_today` and `get_live` choose their rows'
 * phrases once over the list (rows whose own phrase is the same still print
 * different ones); `get_match` and `get_next_fixture` print the team's rally
 * cry where the moment's phrase was (the home side's when both carry one: no
 * pin is applied here); the `fixtures://` list, which states no competition's
 * team kind, prints none.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS, matchFlavor } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchList } from '../src/format';
import { toolGetLive, toolGetMatch, toolGetNextFixture, toolGetToday } from '../src/tools';

const NOW = new Date('2026-10-10T12:00:00Z');
const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
const america = { code: 'AME', name: 'América', id: 'espn:227' };
const necaxa = { code: 'NEC', name: 'Necaxa', id: 'espn:229' };

function fixture(over: Partial<Match> = {}): Match {
  return {
    id: '800000960',
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: 'Estadio Azteca',
    home: america,
    away: pumas,
    status: 'SCHEDULED',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}
function adapter(matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'mex.1',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return matches.filter((m) => m.status === 'LIVE');
    },
    async fetchWindow() {
      return matches;
    },
  };
}
const scheduledPhrases = (out: string) => (FLAVOR_BANKS.en?.scheduled ?? []).filter((p) => out.includes(p));

const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'mex.1';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

/** Eight cry-less fixtures whose OWN phrase is the same (found by asking matchFlavor). */
function sharingOnePhrase(over: Partial<Match> = {}): Match[] {
  const mk = (k: number, i: number) =>
    fixture({ id: String(k), home: { code: `H${i}`, name: `Home ${i}`, id: `espn:${9300 + i}` }, away: { code: `A${i}`, name: `Away ${i}`, id: `espn:${9400 + i}` }, ...over });
  const first = mk(800000700, 0);
  const own = matchFlavor(first, { level: 'full', locale: 'en' });
  const out = [first];
  for (let k = 800000701; out.length < 8; k++) {
    const m = mk(k, out.length);
    if (matchFlavor(m, { level: 'full', locale: 'en' }) === own) out.push(m);
  }
  return out;
}
const phrasesOf = (out: string, moment: string) => (FLAVOR_BANKS.en?.[moment] ?? []).filter((p) => out.includes(p));

describe('get_today and get_live: one phrase per row, even for rows that share their own', () => {
  it('get_today prints eight different scheduled phrases', async () => {
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter(sharingOnePhrase()), now: NOW, flavor: 'full' });
    expect(phrasesOf(r.text, 'scheduled')).toHaveLength(8);
  });

  it('get_live prints eight different phrases of the moment', async () => {
    const r = await toolGetLive({ adapter: adapter(sharingOnePhrase({ status: 'LIVE', minute: 30, score: { home: 0, away: 0 } })), now: NOW, flavor: 'full' });
    expect(phrasesOf(r.text, 'live')).toHaveLength(8);
  });
});

describe('get_match and get_next_fixture: the cry where the phrase was', () => {
  it("get_match: the home side's cry; nothing with flavor off", async () => {
    const r = await toolGetMatch({ id: '800000960', adapter: adapter([fixture()]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('— ¡Ódiame más!');
    expect(scheduledPhrases(r.text)).toEqual([]);
    const off = await toolGetMatch({ id: '800000960', adapter: adapter([fixture()]), now: NOW, flavor: 'off' });
    expect(off.text).not.toContain('¡Ódiame más!');
  });

  it("get_next_fixture: Pumas' cry against a side with none", async () => {
    const r = await toolGetNextFixture({ team: 'Pumas UNAM', adapter: adapter([fixture({ home: necaxa })]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('— ¡Goya!');
  });
});

describe('the static list states no team kind', () => {
  it('fixtures:// (matchList with no options) prints the phrase, never a cry', () => {
    const out = matchList([fixture()], 'none', { now: NOW });
    expect(out).not.toContain('¡Ódiame más!');
    expect(scheduledPhrases(out)).toHaveLength(1);
  });
});
