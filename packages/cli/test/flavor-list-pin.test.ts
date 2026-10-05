/**
 * The CLI lists take their flairs from ONE rule (core `matchFlairs`): a row
 * with a cry reserves no phrase, so the rows without one keep distinct
 * phrases; a cancelled match prints no cry; the cry is green and a phrase is
 * not, on a list and on `match <id>` (picocolors forced on in this file: it
 * detects no colour in a test run). The pin decides between two cries at
 * every CLI call site (`today`, `live`, `next`, `match`), and the ambient
 * pick prefers an id-less saved pin by its code whatever the feed names it.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS, matchFlavor, RALLY_CRIES } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdMatch, cmdNext, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { pickAmbientMatch } from '../src/statusline';
import { described } from './config-of';

vi.mock('picocolors', async () => {
  // A CommonJS module: its namespace carries the colours object as `default`.
  const actual = (await vi.importActual('picocolors')) as { default: { createColors: (enabled?: boolean) => unknown } };
  return { default: actual.default.createColors(true) };
});

const ESC = String.fromCharCode(27);
const GREEN = `${ESC}[32m`;
const NOW = new Date('2026-10-10T12:00:00Z');
const plainClub = (i: number) => ({ code: `P${i}`, name: `Plain ${i}`, id: `espn:${97000 + i}` });

function fixture(id: string, over: Partial<Match> = {}): Match {
  return {
    id,
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: 'Stadium',
    home: plainClub(0),
    away: plainClub(1),
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
const ctx = (competition: string, matches: Match[], over: Partial<CliConfig> = {}) => ({
  cfg: described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition, flavor: 'full', markets: false, ...over }),
  t: makeT('en'),
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
const scheduledIn = (out: string) => (FLAVOR_BANKS.en?.scheduled ?? []).filter((p) => out.includes(p));

/** Four cry-less fixtures whose OWN phrase is the same (found by asking matchFlavor). */
function sharingOnePhrase(): Match[] {
  const mk = (k: number, i: number) => fixture(String(k), { home: plainClub(10 + 2 * i), away: plainClub(11 + 2 * i) });
  const first = mk(800002300, 0);
  const own = matchFlavor(first, { level: 'full', locale: 'en' });
  const out = [first];
  for (let k = 800002301; out.length < 4; k++) {
    const m = mk(k, out.length);
    if (matchFlavor(m, { level: 'full', locale: 'en' }) === own) out.push(m);
  }
  return out;
}

describe('today: a cry row reserves no phrase', () => {
  it('fourteen cries and four rows without: the four print four different phrases', async () => {
    const clubs = RALLY_CRIES.filter((c) => c.kind === 'club').slice(0, 14);
    const cries = clubs.map((c, i) => fixture(String(800002400 + i), { home: { code: c.code, name: c.name, id: c.id }, away: plainClub(200 + i) }));
    await cmdToday('2026-10-10', ctx('eng.1', [...cries, ...sharingOnePhrase()]));
    const out = text();
    for (const c of clubs) expect(out, c.name).toContain(c.cry);
    expect(scheduledIn(out)).toHaveLength(4);
  });
});

describe('a sober line carries no cry', () => {
  it('a cancelled Arsenal match prints no cry', async () => {
    await cmdToday('2026-10-10', ctx('eng.1', [fixture('800002500', { home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' }, status: 'CANCELLED' })]));
    expect(text()).toContain('Arsenal');
    expect(text()).not.toContain('COYG!');
  });
});

describe('the cry is green, a phrase is not', () => {
  it('with colour on: the ANSI green around the cry, none around the phrase', async () => {
    const pumasRow = fixture('800002600', { home: { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' } });
    const plainRow = fixture('800002601');
    await cmdToday('2026-10-10', ctx('mex.1', [pumasRow, plainRow], { color: true }));
    const lines = text().split('\n');
    const pumasLine = lines.find((l) => l.includes('Pumas UNAM')) ?? '';
    expect(pumasLine).toContain(`${GREEN}¡Goya!`);
    const phrase = scheduledIn(text())[0] ?? '';
    expect(phrase).not.toBe('');
    const plainLine = lines.find((l) => l.includes(phrase)) ?? '';
    expect(plainLine).not.toContain(`${GREEN}${phrase}`);
    expect(plainLine).not.toContain(GREEN);
  });
});

describe('the cry is green on `match <id>` too', () => {
  it('with colour on: the ANSI green around the cry; no green at all for a match with no cry', async () => {
    const pumasRow = fixture('800002610', { home: { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' } });
    await cmdMatch('800002610', ctx('mex.1', [pumasRow], { color: true }));
    expect(text()).toContain(`${GREEN}¡Goya!`);
    writes = [];
    await cmdMatch('800002611', ctx('mex.1', [fixture('800002611')], { color: true }));
    expect(scheduledIn(text())).toHaveLength(1);
    expect(text()).not.toContain(GREEN);
  });
});

describe('the pin decides between two cries at every CLI call site', () => {
  const america = { code: 'AME', name: 'América', id: 'espn:227' };
  const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
  const pinned = { pin: { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM' } };

  it("live: a clásico in play prints the pinned side's cry, not the home side's", async () => {
    const clasico = fixture('800002620', { home: america, away: pumas, status: 'LIVE', minute: 30, score: { home: 0, away: 0 } });
    await cmdLive(ctx('mex.1', [clasico], pinned));
    expect(text()).toContain('¡Goya!');
    expect(text()).not.toContain('¡Ódiame más!');
  });

  it("next América: the line prints the pinned side's cry, the query being América", async () => {
    await cmdNext('América', ctx('mex.1', [fixture('800002621', { home: america, away: pumas })], pinned));
    expect(text()).toContain('¡Goya!');
    expect(text()).not.toContain('¡Ódiame más!');
  });
});

describe('the ambient pick: an id-less saved pin by its code', () => {
  it("the saved United States picks the feed's United States of America", () => {
    const mexCan = fixture('800002630', { home: { code: 'MEX', name: 'Mexico', id: 'espn:203' }, away: { code: 'CAN', name: 'Canada', id: 'espn:206' } });
    const usaJam = fixture('800002631', { home: { code: 'USA', name: 'United States of America', id: 'espn:660' }, away: { code: 'JAM', name: 'Jamaica', id: 'espn:1038' } });
    const picked = pickAmbientMatch([mexCan, usaJam], { team: { code: 'USA', name: 'United States' } });
    expect(picked.map((m) => m.id)).toEqual(['800002631', '800002630']);
  });
});
