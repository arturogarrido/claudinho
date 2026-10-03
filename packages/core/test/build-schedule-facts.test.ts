/**
 * 0.11 PR 2.1d — `gen:schedule` checks its named facts, not only the windows'
 * accounts. The group-stage size implies a count of matches, not a count of
 * letters: a whole feed with the right number of matches in every stage whose
 * groups collapse to fewer letters is still refused, naming the groups, and
 * nothing is written.
 */
import { describe, expect, it } from 'vitest';
import { attachFetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { allFixtures } from '../src/schedule';
import { buildSchedule, GROUPS } from '../scripts/build-schedule';

const SEASON = { year: 2026, label: '2026 FIFA World Cup' };
const dayOf = (iso: string) => iso.slice(0, 10).replace(/-/g, '');

describe('gen:schedule checks the groups as distinct letters (0.11 2.1d)', () => {
  it('every stage count right, one group letter folded into another: refused, naming the groups; nothing written', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() { return []; },
      async fetchLive() { return []; },
      async fetchWindow(start: string, end: string) {
        const inWindow = allFixtures()
          .filter((m) => dayOf(m.kickoff) >= start && dayOf(m.kickoff) <= end)
          .map((m) => (m.group === 'L' ? { ...m, group: 'K' } : m));
        return attachFetchMeta(inWindow, { complete: true, season: SEASON });
      },
    };
    const written: string[] = [];
    const errors: string[] = [];
    const run = buildSchedule({ adapter, write: (path) => void written.push(path), log: () => {}, error: (l) => void errors.push(l) });
    await expect(run).rejects.toThrow(/validation failed/);
    expect(written).toEqual([]);
    expect(errors.join('\n')).toMatch(new RegExp(`expected ${GROUPS} groups, got ${GROUPS - 1}`));
  });
});
