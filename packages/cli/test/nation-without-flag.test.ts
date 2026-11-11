import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheState, writeState } from '../src/cache';

// `prompt` and `hook` may start a detached refresher; the spawn is someone else's test.
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { ambientView } from '../src/ambient';
import { cmdHook, cmdLive, cmdPrompt, cmdShare, cmdToday, cmdVibe } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';
import { described } from './config-of';

/**
 * A NATION whose flag Unicode does not recommend (Northern Ireland: the tag
 * sequence `gbnir` is drawn as a plain black flag everywhere) renders by its
 * name, with nothing in the flag's place, on every surface that prints a flag
 * beside a name, and by its CODE in the ambient tokens, where a flag stands for
 * the team on its own. Hungary, beside it, keeps its flag: the competition is a
 * nations competition (`uefa.nations`), and only the flagless nation changes.
 *
 * Seen on the published CLI on Nov 10, 2026:
 * `claudinho --competition nations-league today 2026-11-17` printed U+1F3F4
 * U+E0067 U+E0062 U+E006E U+E0069 U+E0072 U+E007F beside Northern Ireland.
 */
const NOW = new Date('2026-11-17T20:30:00.000Z');
type Side = { id: string; abbr: string; name: string };
const HUN: Side = { id: '2611', abbr: 'HUN', name: 'Hungary' };
const NIR: Side = { id: '2617', abbr: 'NIR', name: 'Northern Ireland' };
const SEASON = { year: 2026, displayName: '2026-27 UEFA Nations League', startDate: '2026-09-01T04:00Z', endDate: '2027-06-30T03:59Z' };
function event(state: 'pre' | 'in') {
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, ...(state === 'pre' ? {} : { score }), team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return {
    id: '401800001',
    date: '2026-11-17T19:45Z',
    season: { slug: 'league-phase' },
    status: { type, displayClock: state === 'in' ? "50'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [{ venue: { fullName: 'Puskás Aréna', address: { city: 'Budapest' } }, competitors: [side(HUN, 'home', '2'), side(NIR, 'away', '1')] }],
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The real adapter over a fake feed: the one fixture, filed under its US/Eastern day (Nov 17). */
function feed(state: 'pre' | 'in'): ProviderAdapter {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ code: 404 }, 404);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const hit = asked === '20261117' || asked === '202611';
    return json({ leagues: [{ season: SEASON }], events: hit ? [event(state)] : [] });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'uefa.nations', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter;
}
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'Europe/London', json: false, color: false, source: 'espn', competition: 'uefa.nations', flavor: 'off', markets: false, ...over });
}
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT(over.lang ?? 'en'),
  adapter,
  now: NOW,
  marketProvider: new FakeMarketProvider(),
});

/** No tag character, no black flag, no placeholder, nowhere. */
const NO_FLAG_SHAPE = /[\u{E0000}-\u{E007F}]|\u{1F3F4}|🏳️|🇬🇧|undefined/u;
// Nothing in the flag's place, not even its space: the away flag's gap would be a double space before a separator.
const GAP = /Northern Ireland {2}\S|Northern Ireland {2,}[·(—]|NIR {2}/;
const clean = (t: string, label: string) => {
  expect(t, label).not.toMatch(NO_FLAG_SHAPE);
  expect(t, label).not.toMatch(GAP);
};

const ORIG = process.env.CLAUDINHO_COMPETITION;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'uefa.nations';
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
const text = () => writes.join('');
type Rec = Record<string, unknown>;

describe('Northern Ireland renders by name on the CLI\'s interactive surfaces', () => {
  it('`today`: Hungary keeps its flag, Northern Ireland is its name alone; `--json` has no flag key on it', async () => {
    await cmdToday('2026-11-17', ctx(feed('pre')));
    const t = text();
    expect(t).toContain('🇭🇺 Hungary');
    expect(t).toContain('Northern Ireland');
    clean(t, 'today');
    writes = [];
    await cmdToday('2026-11-17', ctx(feed('pre'), { json: true }));
    const m = ((JSON.parse(text()) as Rec).matches as Rec[])[0];
    expect((m as Rec).home).toHaveProperty('flag', '🇭🇺');
    expect(m?.away).toEqual({ code: 'NIR', name: 'Northern Ireland', id: 'espn:2617' });
  });

  it('`live`: the score line by names', async () => {
    await cmdLive(ctx(feed('in')));
    const t = text();
    expect(t).toContain('Northern Ireland');
    expect(t).toContain('2–1');
    clean(t, 'live');
  });

  it('`share <date>` and `share live`: the social card by names, the compact one by codes, no flag shape for Northern Ireland', async () => {
    for (const [target, state] of [['2026-11-17', 'pre'], ['live', 'in']] as const) {
      for (const style of ['social', 'compact'] as const) {
        writes = [];
        await cmdShare(target, undefined, { style }, ctx(feed(state)));
        const t = text();
        const label = `share ${target} --style ${style}`;
        expect(t, label).toContain(style === 'social' ? '🇭🇺 Hungary' : '🇭🇺 HUN');
        expect(t, label).toMatch(style === 'social' ? /Northern Ireland/ : /\bNIR\b/);
        clean(t, label);
      }
    }
  });
});

describe('Northern Ireland on the ambient surfaces: its code where a flag stands alone', () => {
  const live = (): Match => ({
    id: '401800001',
    stage: 'LEAGUE',
    kickoff: new Date(NOW.getTime() - 50 * 60_000).toISOString(),
    venue: 'Puskás Aréna',
    home: { code: 'HUN', name: 'Hungary', id: 'espn:2611' },
    away: { code: 'NIR', name: 'Northern Ireland', id: 'espn:2617' },
    status: 'LIVE',
    minute: 50,
    score: { home: 2, away: 1 },
    updatedAt: NOW.toISOString(),
  });
  const snapshot = (matches: Match[], at = NOW): CacheState => ({
    updatedAt: at.toISOString(),
    live: matches,
    degraded: false,
    source: 'espn',
    competition: 'uefa.nations',
  });

  it('the statusline: Hungary\'s flag, Northern Ireland\'s code, in every mode', () => {
    const opts = { defaultCompetition: false, teamKind: 'nation' as const, now: NOW };
    const s = snapshot([live()]);
    expect(renderPrompt(s, opts)).toBe("⚽ 🇭🇺 2–1 NIR 50'");
    expect(renderPrompt(s, { ...opts, compact: false })).toBe("⚽ 🇭🇺 HUN 2–1 NIR 50'");
    expect(renderPrompt(s, { ...opts, flags: false })).toBe("⚽ HUN 2–1 NIR 50'");
  });

  it('`ambient --json`: the line by code, the record with no flag key, the context by name', () => {
    const v = ambientView(snapshot([live()]), { defaultCompetition: false, teamKind: 'nation', flags: true, now: NOW });
    expect(v.line).toBe("⚽ 🇭🇺 2–1 NIR 50'");
    expect(v.live.items[0]?.away).toEqual({ code: 'NIR', name: 'Northern Ireland', id: 'espn:2617' });
    expect(v.context).toContain('Northern Ireland');
    clean(JSON.stringify(v), 'ambient');
  });

  describe('through the commands, from a cache file', () => {
    const ENV = ['XDG_CACHE_HOME', 'CLAUDINHO_TEAM', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_FLAGS'] as const;
    const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
    let dir: string;
    beforeEach(() => {
      for (const k of ENV) saved[k] = process.env[k];
      dir = mkdtempSync(join(tmpdir(), 'claudinho-nir-'));
      process.env.XDG_CACHE_HOME = dir;
      delete process.env.CLAUDINHO_TEAM;
      delete process.env.CLAUDINHO_FLAGS;
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
    // `prompt`, `hook` and `vibe` read the clock themselves: the snapshot is stamped now.
    const seed = () => {
      const at = new Date();
      writeState(snapshot([{ ...live(), kickoff: new Date(at.getTime() - 50 * 60_000).toISOString(), updatedAt: at.toISOString() }], at));
    };
    const ctxOf = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en') });

    it('`hook`: Hungary\'s flag beside its name, Northern Ireland by its name alone', () => {
      seed();
      cmdHook(ctxOf());
      expect(text()).toContain("🇭🇺 Hungary 2–1 Northern Ireland (50')");
      clean(text(), 'hook');
    });

    it('`prompt`: the code in the flag\'s token', () => {
      seed();
      cmdPrompt(ctxOf(), { cursor: undefined });
      expect(text()).toContain("⚽ 🇭🇺 2–1 NIR 50'");
      clean(text(), 'prompt');
    });

    it('`vibe`: the code in text and `--json`', () => {
      seed();
      cmdVibe(ctxOf());
      expect(text()).toContain("🇭🇺 2–1 NIR 50'");
      clean(text(), 'vibe');
      writes = [];
      cmdVibe(ctxOf({ json: true }));
      expect((JSON.parse(text()) as Rec).live).toBe("🇭🇺 2–1 NIR 50'");
    });
  });
});
