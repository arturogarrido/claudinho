/**
 * The middle column with colour on (0.11 · 2.7c, round 1): the middle cell
 * (`vs`, a score, a shootout score) is padded UNPAINTED to the list's widest
 * one and painted after, so a list mixing them prints its time and status
 * tokens in one column, as the terminal shows it (measured on the lines with
 * their colour codes removed). Picocolors is forced on in this file: it
 * detects no colour in a test run.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

vi.mock('picocolors', async () => {
  // A CommonJS module: its namespace carries the colours object as `default`.
  const actual = (await vi.importActual('picocolors')) as { default: { createColors: (enabled?: boolean) => unknown } };
  return { default: actual.default.createColors(true) };
});

const ESC = String.fromCharCode(27);
/** The text as the terminal shows it: every SGR sequence (ESC, `[`, digits and `;`, `m`) removed. */
const visible = (s: string) =>
  s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
    .join('');

const NOW = new Date('2026-10-10T15:00:00Z');
const team = (code: string, name: string, id: number) => ({ code, name, id: `espn:${id}` });
function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(800000800 + i),
    stage: 'LEAGUE',
    kickoff: '2026-10-10T16:00:00.000Z',
    venue: `Ground ${i}`,
    home: team(`H${i}`, `Home ${i}`, 9800 + i),
    away: team(`A${i}`, `Away ${i}`, 9900 + i),
    status: 'SCHEDULED',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}
function adapter(matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'uefa.nations',
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
const cfg = (): CliConfig =>
  described({ lang: 'en', tz: 'UTC', json: false, color: true, source: 'espn', competition: 'uefa.nations', flavor: 'off', markets: false });
const ctx = (matches: Match[]) => ({ cfg: cfg(), t: makeT('en'), adapter: adapter(matches), marketProvider: undefined, now: NOW });

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
const rowsOf = (names: RegExp) =>
  visible(writes.join(''))
    .split('\n')
    .filter((l) => names.test(l));

/** Where a row's time or status token starts: a kickoff (`Sat 16:00`), a minute (`41'`), `HT` or `FT`. */
const TOKEN = /\b[A-Z][a-z]{2} \d\d:\d\d|\b\d+'|\bHT\b|\bFT\b/;

describe('the middle column, with colour on', () => {
  it('today: a list mixing vs, a score and a shootout score prints its tokens in one column', async () => {
    const list = [
      fixture(1, { home: team('ROU', 'Romania', 1), away: team('SWE', 'Sweden', 2) }),
      fixture(2, { home: team('UKR', 'Ukraine', 3), away: team('HUN', 'Hungary', 4), status: 'LIVE', minute: 41, score: { home: 2, away: 1 } }),
      fixture(3, {
        home: team('ITA', 'Italy', 5),
        away: team('TUR', 'Türkiye', 6),
        status: 'FT',
        score: { home: 1, away: 1 },
        shootout: { home: 4, away: 3 },
      }),
    ];
    await cmdToday('2026-10-10', ctx(list));
    // The painter is on: the raw text carries colour codes.
    expect(writes.join('')).toContain(ESC);
    const rows = rowsOf(/Sweden|Hungary|Türkiye/);
    expect(rows.length).toBe(3);
    const cols = rows.map((l) => l.search(TOKEN));
    expect(cols.every((c) => c > 0), rows.join('\n')).toBe(true);
    expect(new Set(cols).size, rows.join('\n')).toBe(1);
    // And the away names start in one column too: the middle cell is padded, not just the right side.
    const away = rows.map((l, i) => l.indexOf(['Sweden', 'Hungary', 'Türkiye'][i] as string));
    expect(new Set(away).size, rows.join('\n')).toBe(1);
  });

  it('live: a score and a half-time score line up', async () => {
    const list = [
      fixture(4, { home: team('ESP', 'Spain', 7), away: team('SUI', 'Switzerland', 8), status: 'LIVE', minute: 12, score: { home: 0, away: 0 } }),
      fixture(5, { home: team('POR', 'Portugal', 9), away: team('CRO', 'Croatia', 10), status: 'HT', score: { home: 10, away: 1 } }),
    ];
    await cmdLive(ctx(list));
    const rows = rowsOf(/Switzerland|Croatia/);
    expect(rows.length).toBe(2);
    const cols = rows.map((l) => l.search(TOKEN));
    expect(new Set(cols).size, rows.join('\n')).toBe(1);
  });
});
