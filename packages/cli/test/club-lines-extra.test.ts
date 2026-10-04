/**
 * 0.11 · 2.2 + 2.4 — CLI rules the red tests do not reach.
 *
 *   - `match`: the stage and the location are joined with the empty ones
 *     dropped; a record with neither prints no line for them (never a lone
 *     separator, never an empty indented line).
 *   - The hot-path readers state a kind when their caller states none: the
 *     bundle fields nations; anything else is read as clubs (no flag is ever
 *     generated from a name nobody vouched for).
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheState } from '../src/cache';
import { cmdMatch } from '../src/commands';
import type { CliConfig } from '../src/config';
import { renderHook } from '../src/hook';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';

const NOW = new Date('2026-10-04T14:50:00.000Z');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');

/** The real adapter over a fake cup feed: one Saturday fixture with NO venue, under `slug`. */
function feed(slug: string | null) {
  const date = '2026-10-10T11:30Z';
  const event = {
    id: '800000030',
    date,
    season: { slug },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
          { homeAway: 'away', team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
        ],
      },
    ],
  };
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 } });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const day = easternDay(date);
    const held = asked.length === 8 ? day === asked : asked.length === 6 ? day.startsWith(asked) : false;
    return json({ leagues: [{ season: { year: 2026 } }], events: held ? [event] : [] });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'uefa.champions', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter;
}
const cfg = (over: Partial<CliConfig> = {}): CliConfig => ({
  lang: 'en',
  tz: 'UTC',
  json: false,
  color: false,
  source: 'espn',
  competition: 'uefa.champions',
  flavor: 'off',
  markets: false,
  ...over,
});
const ctx = (adapter: ProviderAdapter) => ({ cfg: cfg(), t: makeT('en'), adapter, now: NOW, marketProvider: new FakeMarketProvider() });

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
const lines = () => writes.join('').split('\n');

describe('`match`: the stage and the location, joined with the empty ones dropped', () => {
  it('a venue-less record with words: the stage alone, no dangling separator', async () => {
    await cmdMatch('800000030', ctx(feed('qualifying-final')));
    const header = lines().findIndex((l) => l === 'Arsenal vs Chelsea');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(lines()[header + 1]).toBe('  Qualifying final');
    expect(writes.join('')).not.toMatch(/·\s*(\n|$)|(^|\n)\s*·/);
  });

  it('a venue-less record with no phase stated: no line for them at all', async () => {
    await cmdMatch('800000030', ctx(feed(null)));
    const all = lines();
    const header = all.findIndex((l) => l === 'Arsenal vs Chelsea');
    expect(header).toBeGreaterThanOrEqual(0);
    // Straight to the kickoff line: no empty indented line, no separator.
    expect(all[header + 1]).toMatch(/^ {2}Sat 11:30/);
    expect(all.some((l) => /^\s+$/.test(l))).toBe(false);
    expect(writes.join('')).not.toContain('·');
  });
});

describe('the hot-path readers state a kind when their caller states none', () => {
  const live: Match = {
    id: '800000040',
    stage: 'LEAGUE',
    kickoff: new Date(NOW.getTime() - 50 * 60_000).toISOString(),
    venue: 'Air Albania Stadium',
    home: { code: 'ALB', name: 'Albania', flag: '\u{1F1E6}\u{1F1F1}', id: 'espn:2654' },
    away: { code: 'LVA', name: 'Latvia', flag: '\u{1F1F1}\u{1F1FB}', id: 'espn:2578' },
    status: 'LIVE',
    minute: 50,
    score: { home: 2, away: 1 },
    updatedAt: NOW.toISOString(),
  };
  const snapshot: CacheState = { updatedAt: NOW.toISOString(), live: [live], degraded: false, source: 'espn', competition: 'uefa.nations' };

  it('off the bundle, unstated: clubs (the file\'s flags are not believed, none is generated)', () => {
    expect(renderPrompt(snapshot, { defaultCompetition: false, now: NOW })).toBe("⚽ ALB 2–1 LVA 50'");
    expect(renderHook(snapshot, { defaultCompetition: false, now: NOW })).toContain("Albania 2–1 Latvia (50')");
    expect(renderHook(snapshot, { defaultCompetition: false, now: NOW })).not.toContain('\u{1F1E6}');
  });

  it('stated: the competition\'s kind decides, whatever the bundle question says', () => {
    expect(renderPrompt(snapshot, { defaultCompetition: false, teamKind: 'nation', now: NOW })).toBe("⚽ \u{1F1E6}\u{1F1F1} 2–1 \u{1F1F1}\u{1F1FB} 50'");
    expect(renderHook(snapshot, { defaultCompetition: false, teamKind: 'nation', now: NOW })).toContain(
      "\u{1F1E6}\u{1F1F1} Albania 2–1 Latvia \u{1F1F1}\u{1F1FB} (50')",
    );
  });

  it('on the bundle, unstated: nations (the World Cup fields nations, by the written table)', () => {
    const wc: CacheState = { ...snapshot, competition: 'fifa.world' };
    expect(renderPrompt(wc, { now: NOW })).toBe("⚽ \u{1F1E6}\u{1F1F1} 2–1 \u{1F1F1}\u{1F1FB} 50'");
  });
});
