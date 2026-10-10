/**
 * The countdown in a tool's text is relative to the REQUEST's clock (`now`),
 * the one every other read of the request takes, never the wall clock.
 *
 * Measured on Oct 10, 2026: `get_next_fixture` with `now` six days before a
 * kickoff said "(now)" once the wall clock passed the kickoff, while the dated
 * read, discovery's span and the fixture's state all answered for `now`. The
 * kickoff below has passed on every wall clock that runs this file; the phrase
 * is pinned to the request's clock: five days, twenty hours and forty minutes.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMatch, toolGetNextFixture, toolGetToday } from '../src/tools';

const REQUEST_CLOCK = new Date('2026-10-04T14:50:00.000Z');
const KICKOFF = '2026-10-10T11:30:00.000Z';
const fixture: Match = {
  id: '800000730',
  stage: 'REGULAR',
  kickoff: KICKOFF,
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'LEE', name: 'Leeds United', id: 'espn:357' },
  status: 'SCHEDULED',
  updatedAt: REQUEST_CLOCK.toISOString(),
};
function adapter(matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'eng.1',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return matches;
    },
  };
}
const EXPECTED = '(in 5d20h)';

describe("a tool's countdown is relative to the request's clock, not the wall clock", () => {
  it('get_next_fixture: the next fixture says "in 5d20h" for a kickoff the wall clock has passed', async () => {
    const r = await toolGetNextFixture({ team: 'Arsenal', competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });

  it('get_match: the one match says "in 5d20h" for a kickoff the wall clock has passed', async () => {
    const r = await toolGetMatch({ id: fixture.id, competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });

  it("get_today: the day's list says \"in 5d20h\" for a kickoff the wall clock has passed", async () => {
    const r = await toolGetToday({ date: '2026-10-10', tz: 'UTC', competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });
});
