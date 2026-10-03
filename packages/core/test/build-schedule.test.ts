/**
 * 0.11 PR 2.1d — `gen:schedule` fails loud.
 *
 * The generator fetched its windows through the real adapter, logged a FAILED
 * window and went on, merged by id, and checked the result against literals
 * (104 fixtures, 12 groups, the stage counts). A missing fixture failed those
 * checks; a window served but NOT WHOLE whose merged output still passed them
 * (a refused duplicate), a window with no account, and a window stating
 * another season (or none) wrote the file. Now a window that failed, has no
 * account, is not whole, or states a season other than the script's own is
 * refused at once, naming the window and the reason, and nothing is written;
 * the expected numbers are named facts beside the windows and core's
 * canonical knockout counts, never read off this run or off the file being
 * replaced.
 *
 * The fake adapter serves the bundled fixtures by window (the bundle is what a
 * whole feed of the right shape looks like), with the account each test wants.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachFetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { allFixtures } from '../src/schedule';
import type { Match } from '../src/types';
import { buildSchedule, WINDOWS } from '../scripts/build-schedule';

const SEASON = { year: 2026, label: '2026 FIFA World Cup', startDate: '2026-06-11T04:00:00.000Z', endDate: '2026-12-31T04:59:00.000Z' };
const dayOf = (iso: string) => iso.slice(0, 10).replace(/-/g, '');

type Account = { complete?: boolean; omitted?: number; season?: typeof SEASON | undefined } | 'silent' | 'throw';
/** An adapter that answers each window from the bundle, with the account the test chooses per window. */
function feed(account: (start: string, end: string) => Account) {
  const asked: string[] = [];
  const adapter: ProviderAdapter = {
    name: 'espn',
    competition: 'fifa.world',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() { return []; },
    async fetchLive() { return []; },
    async fetchWindow(start: string, end: string) {
      asked.push(`${start}-${end}`);
      const a = account(start, end);
      if (a === 'throw') throw new Error('HTTP 503');
      const inWindow = allFixtures().filter((m) => dayOf(m.kickoff) >= start && dayOf(m.kickoff) <= end);
      if (a === 'silent') return inWindow;
      const { season, ...meta } = a;
      return attachFetchMeta(inWindow, { complete: true, ...(season === undefined && !('season' in a) ? { season: SEASON } : season ? { season } : {}), ...meta });
    },
  };
  return { adapter, asked };
}
function run(account: (start: string, end: string) => Account) {
  const written: Array<{ path: string; body: string }> = [];
  const log: string[] = [];
  const f = feed(account);
  return buildSchedule({
    adapter: f.adapter,
    write: (path: string, body: string) => void written.push({ path, body }),
    log: (line: string) => void log.push(line),
    error: (line: string) => void log.push(line),
  }).then(
    () => ({ ok: true as const, written, log, asked: f.asked }),
    (err: unknown) => ({ ok: false as const, written, log, asked: f.asked, message: String((err as Error).message ?? err) }),
  );
}
const whole = () => ({ complete: true });

describe('gen:schedule fails loud (0.11 2.1d)', () => {
  it('a whole feed of the right shape writes both files', async () => {
    const r = await run(whole);
    expect(r.ok).toBe(true);
    expect(r.written.map((w) => w.path.split('/').pop())).toEqual(['schedule.2026.json', 'bracket.2026.json']);
    expect((JSON.parse(r.written[0]?.body ?? '[]') as Match[]).length).toBe(104);
    expect(r.asked).toHaveLength(WINDOWS.length);
  });

  it('a window served but not whole whose merged output still passes every shape check (a refused duplicate): refused, naming the window and the count, nothing written', async () => {
    const r = await run((start) => (start === '20260618' ? { complete: false, omitted: 1 } : whole()));
    expect(r.ok).toBe(false);
    expect(r.written).toEqual([]);
    expect(r.ok === false && r.message).toMatch(/20260618/);
    expect(r.ok === false && r.message).toMatch(/\b1\b/);
    expect(r.ok === false && r.message).toMatch(/not whole|omitted|left out/i);
  });

  it('a window that FAILED stops the run at once: no further window is asked, nothing written', async () => {
    const r = await run((start) => (start === '20260611' ? 'throw' : whole()));
    expect(r.ok).toBe(false);
    expect(r.written).toEqual([]);
    expect(r.asked).toEqual(['20260611-20260617']);
    expect(r.ok === false && r.message).toMatch(/20260611/);
  });

  it('a window with no account (an adapter that says nothing) is refused: a schedule is built only from reads that said they were whole', async () => {
    const r = await run((start) => (start === '20260625' ? 'silent' : whole()));
    expect(r.ok).toBe(false);
    expect(r.written).toEqual([]);
    expect(r.ok === false && r.message).toMatch(/20260625/);
  });

  it('a window stating another season, or none, is refused naming the season', async () => {
    const other = await run((start) => (start === '20260702' ? { complete: true, season: { ...SEASON, year: 2030 } } : whole()));
    expect(other.ok).toBe(false);
    expect(other.written).toEqual([]);
    expect(other.ok === false && other.message).toMatch(/2030/);
    const none = await run((start) => (start === '20260702' ? { complete: true, season: undefined } : whole()));
    expect(none.ok).toBe(false);
    expect(none.written).toEqual([]);
    expect(none.ok === false && none.message).toMatch(/20260702/);
  });

  it('a fixture served by two windows is refused, naming it and both windows: the windows partition the calendar, and a second copy is never silently the one kept', async () => {
    // The adapter's own duplicate rule covers a fixture twice in ONE window; across windows the
    // generator merged by id and the later copy won without a word.
    const { adapter, asked } = feed(whole);
    const inner = adapter.fetchWindow;
    if (!inner) throw new Error('the fake has a window');
    const stray = allFixtures().find((m) => dayOf(m.kickoff) === '20260611');
    if (!stray) throw new Error('the bundle has an opening day');
    adapter.fetchWindow = async (start: string, end: string) => {
      const matches = await inner(start, end);
      if (start !== '20260618') return matches;
      return attachFetchMeta([...matches, stray], { complete: true, season: SEASON });
    };
    const written: Array<{ path: string }> = [];
    const r = await buildSchedule({ adapter, write: (path: string) => void written.push({ path }), log: () => undefined, error: () => undefined }).then(
      () => ({ ok: true as const, message: '' }),
      (err: unknown) => ({ ok: false as const, message: String((err as Error).message ?? err) }),
    );
    expect(r.ok).toBe(false);
    expect(written).toEqual([]);
    expect(r.message).toMatch(/20260611-20260617/);
    expect(r.message).toMatch(/20260618-20260624/);
    expect(r.message).toContain(stray.id);
    expect(asked.length).toBeGreaterThanOrEqual(2);
  });

  it('the expected numbers are named facts and the canonical knockout counts: the literals 104 and 12 are in no check', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'scripts', 'build-schedule.ts'), 'utf8');
    const checks = src.split('\n').filter((l) => /expected|problems\.push|!==|length/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    expect(checks.some((l) => /\b104\b/.test(l)), checks.join('\n')).toBe(false);
    expect(checks.some((l) => /\b12\b/.test(l) && !/GROUPS/.test(l)), checks.join('\n')).toBe(false);
    expect(src).toMatch(/EXPECTED_KNOCKOUT_COUNTS/);
    expect(src).toMatch(/SEASON_YEAR/);
    expect(src).toMatch(/GROUPS\b/);
    expect(src).toMatch(/TEAMS_PER_GROUP/);
  });
});
