/**
 * PR #177 round 1 (a reader's P2): `get_match`'s text is cut at a length from the end, keeping only the footer. A
 * timeline printed BEFORE the market block let a long timeline push the market's attribution and its "informational
 * only" caveat (the block's last line) past the cut while its percentages stayed. The market block now comes first and
 * the timeline after it, so a cut drops timeline rows, never the market's qualification. The twins: no signal, and a
 * signal with no timeline, keep their order.
 */
import { FakeMarketProvider, type Match, type MatchEvent, type ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toContent } from '../src/server';
import { toolGetMatch } from '../src/tools';

const NOW = new Date('2026-06-11T20:00:00Z');
/** A 220-character label of 66 display columns (combining marks), as the reader built it: a human label the parser keeps. */
const LONG_NAME = `${'x\u0302\u0303\u0304'.repeat(50)}abcdefghijklmnopqrst`;
const cards = (n: number, player?: string): MatchEvent[] =>
  Array.from({ length: n }, (_, i) => ({ type: 'YELLOW', minute: i % 90, side: i % 2 ? 'away' : 'home', teamCode: i % 2 ? 'RSA' : 'MEX', ...(player ? { player } : {}) }) as MatchEvent);
const live = (events?: MatchEvent[]): Match => ({
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z',
  venue: 'Estadio Azteca',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦', id: 'espn:467' },
  score: { home: 1, away: 0 },
  minute: 60,
  status: 'LIVE',
  ...(events ? { events } : {}),
  updatedAt: NOW.toISOString(),
});
const adapter = (m: Match): ProviderAdapter => ({
  name: 'espn',
  competition: 'fifa.world',
  capabilities: { push: false, latencyHintSec: 0 },
  fetchByDate: async () => [m],
  fetchLive: async () => [m],
  fetchWindow: async () => [m],
});
const synth = () => new FakeMarketProvider({ synthesize: true, now: NOW });
const count = (text: string, needle: string) => text.split(needle).length - 1;
const firstTimelineRow = (text: string) => text.search(/\n {2}\d+'\s+(Yellow card|Goal)/);

describe('get_match: the market block before the timeline', () => {
  it('a timeline long enough to be cut keeps the market attribution and its caveat whole', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: adapter(live(cards(128, LONG_NAME))), marketProvider: synth(), now: NOW } as never);
    expect(r.text.length).toBeGreaterThan(32_000);
    const cut = toContent(r).content[0]?.text ?? '';
    expect(count(cut, '(truncated)')).toBe(1);
    expect(count(cut, 'informational only')).toBe(1);
    expect(cut).toMatch(/Source: Polymarket/);
  });
  it('uncut: the first market row precedes the first timeline row', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: adapter(live(cards(3, 'A Player'))), marketProvider: synth(), now: NOW } as never);
    const market = r.text.indexOf('Prediction markets');
    expect(market).toBeGreaterThan(0);
    expect(firstTimelineRow(r.text)).toBeGreaterThan(market);
  });
  it('no signal: the timeline right after the match line', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: adapter(live(cards(3, 'A Player'))), marketProvider: new FakeMarketProvider(), now: NOW } as never);
    expect(r.text).not.toContain('Prediction markets');
    const rows = r.text.split('\n');
    const head = rows.findIndex((l) => l.includes('Mexico 1–0 South Africa'));
    expect(rows[head + 1]).toMatch(/^ {2}\d+'\s+Yellow card/);
  });
  it('a signal and no timeline: the market block as before', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: adapter(live()), marketProvider: synth(), now: NOW } as never);
    expect(count(r.text, 'informational only')).toBe(1);
    expect(firstTimelineRow(r.text)).toBe(-1);
  });
  it('a nation side carries its flag in the timeline rows (MCP prints flags)', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: adapter(live(cards(2, 'A Player'))), marketProvider: new FakeMarketProvider(), now: NOW } as never);
    expect(r.text).toMatch(/ {2}0' +Yellow card +\u{1F1F2}\u{1F1FD} MEX/u);
  });
});
