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
import { cmdMatch, cmdNext } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { renderHook } from '../src/hook';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';

const NOW = new Date('2026-10-04T14:50:00.000Z');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');

/**
 * The real adapter over a fake cup feed: one fixture with NO venue, under
 * `slug`: on Saturday, or (`live`) in play now, 2–1 at 50'.
 */
function feed(slug: string | null, live = false) {
  const date = live ? '2026-10-04T14:00Z' : '2026-10-10T11:30Z';
  const side = (homeAway: string, id: string, abbreviation: string, displayName: string, score: string) => ({
    homeAway,
    ...(live ? { score } : {}),
    team: { id, abbreviation, displayName },
  });
  const event = {
    id: '800000030',
    date,
    season: { slug },
    status: live
      ? { type: { name: 'STATUS_IN_PROGRESS', state: 'in' }, displayClock: "50'", period: 2 }
      : { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [side('home', '359', 'ARS', 'Arsenal', '2'), side('away', '363', 'CHE', 'Chelsea', '1')],
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
const cfg = (over: Partial<CliConfig> = {}): CliConfig => described({
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
    const header = lines().indexOf('Arsenal vs Chelsea');
    expect(header).toBeGreaterThanOrEqual(0);
    // The mode line right after the header (0.11 · 2.5a), then the stage.
    expect(lines()[header + 1]).toBe('  Champions League');
    expect(lines()[header + 2]).toBe('  Qualifying final');
    expect(writes.join('')).not.toMatch(/·\s*(\n|$)|(^|\n)\s*·/);
  });

  it('a venue-less record with no phase stated: no line for them at all', async () => {
    await cmdMatch('800000030', ctx(feed(null)));
    const all = lines();
    const header = all.indexOf('Arsenal vs Chelsea');
    expect(header).toBeGreaterThanOrEqual(0);
    // The mode line (0.11 · 2.5a), then straight to the kickoff line: no
    // empty indented line, no separator.
    expect(all[header + 1]).toBe('  Champions League');
    expect(all[header + 2]).toMatch(/^ {2}Sat 11:30/);
    expect(all.some((l) => /^\s+$/.test(l))).toBe(false);
    expect(writes.join('')).not.toContain('·');
  });
});

describe('`next`: a stage with no words is no segment, in either branch', () => {
  it('a fixture still to come: the time and the countdown from the CONTEXT clock, no leading separator', async () => {
    await cmdNext('Arsenal', ctx(feed(null)));
    // The context's clock is Oct 4, 14:50Z and the kickoff Oct 10, 11:30Z: five days, twenty hours and forty
    // minutes, "in 5d20h", whatever the wall clock says. On Oct 10, 2026, after 11:30Z, the line said "now": the
    // countdown read the wall clock while every other read of the command took the context's (CI red on `main`
    // at the 0.11.2 release commit, green on the same tree an hour before).
    expect(lines()).toContain('  Sat 11:30 · in 5d20h');
  });

  it('a match in play: the time alone', async () => {
    await cmdNext('Arsenal', ctx(feed(null, true)));
    const all = lines();
    const at = all.findIndex((l) => /2–1/.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(all[at + 1]).toBe('  Sun 14:00');
  });

  it('with words, they lead the line', async () => {
    await cmdNext('Arsenal', ctx(feed('qualifying-final', true)));
    expect(lines()).toContain('  Qualifying final · Sun 14:00');
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
