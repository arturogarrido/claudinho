/**
 * The flair slot on the CLI: `today` and `live` choose their rows' phrases
 * once over the list (rows whose own phrase is the same still print different
 * ones); `match <id>` prints the team's rally cry where the moment's phrase
 * was (core `matchFlair`, as `get_match` does on MCP), `next` the same through
 * `matchLine`, the pinned side's when both carry one; `--flavor off` neither.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS, matchFlavor } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdMatch, cmdNext, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const NOW = new Date('2026-10-10T12:00:00Z');
const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
const america = { code: 'AME', name: 'América', id: 'espn:227' };
const necaxa = { code: 'NEC', name: 'Necaxa', id: 'espn:229' };

function fixture(over: Partial<Match> = {}): Match {
  return {
    id: '800000950',
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
const ctx = (matches: Match[], over: Partial<CliConfig> = {}) => ({
  cfg: described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'mex.1', flavor: 'full', markets: false, ...over }),
  t: makeT('en'),
  adapter: adapter(matches),
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
const scheduledPhrases = (out: string) => (FLAVOR_BANKS.en?.scheduled ?? []).filter((p) => out.includes(p));

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

describe('today and live: one phrase per row, even for rows that share their own', () => {
  it('today prints eight different scheduled phrases', async () => {
    await cmdToday('2026-10-10', ctx(sharingOnePhrase()));
    expect(phrasesOf(text(), 'scheduled')).toHaveLength(8);
  });

  it('live prints eight different phrases of the moment', async () => {
    await cmdLive(ctx(sharingOnePhrase({ status: 'LIVE', minute: 30, score: { home: 0, away: 0 } })));
    expect(phrasesOf(text(), 'live')).toHaveLength(8);
  });
});

describe('match <id>: the cry where the phrase was', () => {
  it("the home side's cry, the pinned side's when the pin is the other, none with --flavor off", async () => {
    await cmdMatch('800000950', ctx([fixture()]));
    expect(text()).toContain('¡Ódiame más!');
    expect(scheduledPhrases(text())).toEqual([]);
    writes = [];
    await cmdMatch('800000950', ctx([fixture()], { pin: { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM' } }));
    expect(text()).toContain('¡Goya!');
    expect(text()).not.toContain('¡Ódiame más!');
    writes = [];
    await cmdMatch('800000950', ctx([fixture()], { flavor: 'off' }));
    expect(text()).not.toContain('¡Ódiame más!');
    expect(scheduledPhrases(text())).toEqual([]);
  });

  it("a match with no cry keeps the moment's phrase", async () => {
    await cmdMatch('800000950', ctx([fixture({ home: necaxa, away: { code: 'PUE', name: 'Puebla', id: 'espn:231' } })]));
    expect(scheduledPhrases(text())).toHaveLength(1);
  });
});

describe('next: the cry on its one row', () => {
  it("next Pumas prints Pumas' cry against a side with none", async () => {
    await cmdNext('Pumas UNAM', ctx([fixture({ home: necaxa })]));
    expect(text()).toContain('¡Goya!');
  });
});
