import {
  allFixtures,
  type GroupStandings,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
} from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdShare, InputError } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/** Offline match adapter → commands fall back to the bundled static schedule. */
const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

// Fixed in-tournament clock. Pins BOTH the share command's fixture resolution
// (via ctx.now) AND the synthesized signal's freshness, so the suite stays
// deterministic after these fixtures fall into the real past.
const TEST_NOW = new Date('2026-06-13T12:00:00Z');

/** A fresh, cleanly-mapped, reliable signal for a given match. */
const freshSig = (m: Match): MarketSignal => ({
  matchId: m.id,
  source: 'polymarket',
  asOf: TEST_NOW.toISOString(),
  fetchedAt: TEST_NOW.toISOString(),
  outcomes: [
    { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
    { kind: 'draw', label: 'Draw', probability: 0.25 },
    { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
  ],
  favorite: { kind: 'home', teamCode: m.home.code, probability: 0.56, strength: 'slight' },
  stale: false,
  ambiguous: false,
});

/** A market provider that returns whatever the builder makes for each match. */
function provider(make?: (m: Match) => MarketSignal | undefined): MarketProvider {
  return {
    name: 'fixed',
    findSignal: async (m) => make?.(m),
    findSignals: async (matches) => {
      const signals = new Map<string, MarketSignal>();
      for (const m of matches) {
        const s = make?.(m);
        if (s) signals.set(m.id, s);
      }
      return { signals, checked: new Set(matches.map((m) => m.id)) };
    },
  };
}

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
type Over = Partial<CliConfig>;
const ctx = (over: Over = {}, marketProvider: MarketProvider = provider(), copy?: (t: string) => boolean) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter: fakeAdapter,
  marketProvider,
  copy,
  now: TEST_NOW,
});

const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');
let writes: string[] = [];
let errs: string[] = [];
beforeEach(() => {
  writes = [];
  errs = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  errSpy.mockImplementation((c: unknown) => {
    errs.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
});

const text = () => writes.join('');
const json = () => JSON.parse(writes.join(''));
const HASHTAG = '#VibingLaVidaLoca';
const DISCLAIMER = 'not affiliated with FIFA or Anthropic';
const BANNED = /\b(bet|betting|wager|gambling|edge|lock|value pick)\b/i;
const aTeam = () => allFixtures()[0]!.home.code;

describe('cmdShare — routing & JSON', () => {
  it('share next <team> --json carries the structured shape', async () => {
    const code = aTeam();
    await cmdShare('next', code, {}, ctx({ json: true }, provider(freshSig)));
    const d = json() as {
      kind: string;
      team: string;
      informationalOnly: boolean;
      style: string;
      snippet: string;
    };
    expect(d.kind).toBe('next');
    expect(d.team).toBe(code);
    expect(d.informationalOnly).toBe(true);
    expect(d.style).toBe('social');
    expect(typeof d.snippet).toBe('string');
    expect(d.snippet.length).toBeGreaterThan(0);
  });

  it('share next <team> text carries hashtag, disclaimer, and install cue', async () => {
    const code = aTeam();
    await cmdShare('next', code, {}, ctx({}, provider()));
    const o = text();
    expect(o).toContain(HASHTAG);
    expect(o).toContain(DISCLAIMER);
    expect(o).toContain(`Try it: npx @claudinho/cli next ${code}`);
    expect(o).not.toMatch(BANNED);
  });

  it('share next without a team throws InputError', async () => {
    await expect(cmdShare('next', undefined, {}, ctx())).rejects.toBeInstanceOf(InputError);
  });

  it('renders a clear empty state for an unknown team (not a void card)', async () => {
    await cmdShare('next', 'ZZZ', {}, ctx());
    const o = text();
    expect(o).toContain('No upcoming fixture found for ZZZ.');
    expect(o).toContain(DISCLAIMER);
  });

  it('share <date> renders a titled card with the disclaimer', async () => {
    await cmdShare('2026-06-13', undefined, {}, ctx());
    const o = text();
    expect(o).toContain('Jun 13');
    expect(o).toContain(DISCLAIMER);
    expect(o).not.toMatch(BANNED);
  });
});

describe('cmdShare — toggles & styles', () => {
  it('--no-hashtag drops the tag but keeps the disclaimer', async () => {
    await cmdShare('next', aTeam(), { hashtag: false }, ctx());
    const o = text();
    expect(o).not.toContain(HASHTAG);
    expect(o).toContain(DISCLAIMER);
  });

  it('--no-install-line drops the run cue', async () => {
    await cmdShare('next', aTeam(), { installLine: false }, ctx());
    expect(text()).not.toContain('Try it:');
  });

  it('--style compact uses 3-letter codes and no venue', async () => {
    await cmdShare('2026-06-13', undefined, { style: 'compact' }, ctx());
    const o = text();
    expect(o).toMatch(/[A-Z]{3} vs [A-Z]{3}/);
    expect(o).not.toContain('Estadio');
    expect(o).not.toContain('Prediction markets');
  });
});

describe('cmdShare — market gating (fail closed)', () => {
  it('includes a reliable market block', async () => {
    await cmdShare('next', aTeam(), {}, ctx({}, provider(freshSig)));
    expect(text()).toContain('informational only');
  });

  it('omits a STALE signal (reliability gate)', async () => {
    const stale = (m: Match): MarketSignal => ({ ...freshSig(m), stale: true });
    await cmdShare('next', aTeam(), {}, ctx({}, provider(stale)));
    expect(text()).not.toContain('informational only');
  });

  it('omits markets entirely when markets are off (--no-markets)', async () => {
    await cmdShare('next', aTeam(), {}, ctx({ markets: false }, provider(freshSig)));
    expect(text()).not.toContain('informational only');
  });

  it('still emits a snippet when the market provider throws', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    await cmdShare('next', aTeam(), {}, ctx({}, boom));
    expect(text()).toContain(HASHTAG); // degraded gracefully — card still renders
  });
});

describe('cmdShare — clipboard', () => {
  it('--copy calls the injected copier with the snippet and reports success on stderr', async () => {
    const copy = vi.fn((_text: string) => true);
    await cmdShare('next', aTeam(), { copy: true }, ctx({}, provider(), copy));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0]![0]).toContain('Next up for');
    expect(errs.join('')).toContain('Copied share snippet to clipboard.');
  });

  it('reports a clean fallback message when the clipboard is unavailable', async () => {
    const copy = vi.fn((_text: string) => false);
    await cmdShare('next', aTeam(), { copy: true }, ctx({}, provider(), copy));
    expect(errs.join('')).toContain('Clipboard unavailable; printed snippet instead.');
    // The snippet still reached stdout, so nothing is lost.
    expect(text()).toContain(HASHTAG);
  });
});

describe('cmdShare table — standings card', () => {
  const standingsAdapter: ProviderAdapter = {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return [];
    },
    async fetchLive() {
      return [];
    },
    async fetchStandings(): Promise<GroupStandings[]> {
      return [
        {
          group: 'A',
          rows: [
            { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
            { team: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' }, played: 1, won: 0, drawn: 0, lost: 1, goalsFor: 0, goalsAgainst: 2, goalDiff: -2, points: 0 },
          ],
        },
      ];
    },
  };
  const tableCtx = (adapter: ProviderAdapter) => ({
    cfg: cfg(),
    t: makeT('en'),
    adapter,
    marketProvider: provider(),
    now: TEST_NOW,
  });

  it('renders a standings card with disclaimer + install line, no market lines', async () => {
    await cmdShare('table', 'A', {}, tableCtx(standingsAdapter));
    const o = text();
    expect(o).toContain('Group A · standings');
    expect(o).toContain('1. 🇲🇽 MEX  3 pts · 1-0-0 · +2');
    expect(o).toContain('Live data: ESPN');
    expect(o).toContain(HASHTAG);
    expect(o).toContain(DISCLAIMER);
    expect(o).toContain('Try it: npx @claudinho/cli table A');
    expect(o).not.toContain('informational only');
  });

  it('JSON payload carries kind=table + standings rows', async () => {
    await cmdShare('table', 'A', {}, { ...tableCtx(standingsAdapter), cfg: cfg({ json: true }) });
    const d = json() as { kind: string; group: string; degraded: boolean; tables: Array<{ group: string; standings: unknown[] }> };
    expect(d.kind).toBe('table');
    expect(d.group).toBe('A');
    expect(d.degraded).toBe(false);
    expect(d.tables[0]?.standings).toHaveLength(2);
  });

  it('fails closed to a degraded roster (no fetchStandings), with a not-live notice', async () => {
    await cmdShare('table', 'A', {}, tableCtx(fakeAdapter));
    const o = text();
    expect(o).toContain('Group A · standings');
    expect(o).not.toContain('Live data:');
    expect(o).toContain('Live standings unavailable — group roster, not live results.');
    expect(o).toContain(DISCLAIMER);
  });

  it('unknown group renders a clear empty state', async () => {
    await cmdShare('table', 'Z', {}, tableCtx(standingsAdapter));
    expect(text()).toContain('No group Z.');
    expect(text()).toContain(DISCLAIMER);
  });
});
