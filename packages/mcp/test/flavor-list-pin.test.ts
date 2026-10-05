/**
 * The MCP lines take their flairs from the same rules as the CLI: one rule
 * for a list (core `matchFlairs`: a row with a cry reserves no phrase), the
 * saved pin deciding between two cries on every line (`get_today`,
 * `get_live`, `get_match`, `get_next_fixture`; `CLAUDINHO_TEAM` is the
 * team-taking tools' query, not the cry's tiebreak), and no cry on a cancelled
 * match.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FLAVOR_BANKS, matchFlavor, RALLY_CRIES } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolGetLive, toolGetMatch, toolGetNextFixture, toolGetToday } from '../src/tools';

const NOW = new Date('2026-10-10T12:00:00Z');
const plainClub = (i: number) => ({ code: `P${i}`, name: `Plain ${i}`, id: `espn:${97000 + i}` });
const pumas = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' };
const america = { code: 'AME', name: 'América', id: 'espn:227' };

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
const scheduledIn = (out: string) => (FLAVOR_BANKS.en?.scheduled ?? []).filter((p) => out.includes(p));

const ORIG = {
  competition: process.env.CLAUDINHO_COMPETITION,
  team: process.env.CLAUDINHO_TEAM,
  config: process.env.XDG_CONFIG_HOME,
};
const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
beforeEach(() => {
  delete process.env.CLAUDINHO_TEAM;
});
afterEach(() => {
  restore('CLAUDINHO_COMPETITION', ORIG.competition);
  restore('CLAUDINHO_TEAM', ORIG.team);
  restore('XDG_CONFIG_HOME', ORIG.config);
});

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

describe('get_today: a cry row reserves no phrase', () => {
  it('fourteen cries and four rows without: the four print four different phrases', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const clubs = RALLY_CRIES.filter((c) => c.kind === 'club').slice(0, 14);
    const cries = clubs.map((c, i) => fixture(String(800002400 + i), { home: { code: c.code, name: c.name, id: c.id }, away: plainClub(200 + i) }));
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', [...cries, ...sharingOnePhrase()]), now: NOW, flavor: 'full' });
    for (const c of clubs) expect(r.text, c.name).toContain(`— ${c.cry}`);
    expect(scheduledIn(r.text)).toHaveLength(4);
  });
});

describe('the saved pin decides the clásico on the MCP lines', () => {
  let dir = '';
  beforeEach(() => {
    delete process.env.CLAUDINHO_COMPETITION;
    dir = mkdtempSync(join(tmpdir(), 'claudinho-mcp-pin-'));
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(join(dir, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'liga-mx', team: pumas }));
    process.env.XDG_CONFIG_HOME = dir;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const clasico = () => fixture('800002700', { home: america, away: pumas });

  it("get_today: an América-home match prints Pumas' cry", async () => {
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('mex.1', [clasico()]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('— ¡Goya!');
    expect(r.text).not.toContain('¡Ódiame más!');
  });

  it('get_match and get_next_fixture too', async () => {
    const m = await toolGetMatch({ id: '800002700', adapter: adapter('mex.1', [clasico()]), now: NOW, flavor: 'full' });
    expect(m.text).toContain('— ¡Goya!');
    const n = await toolGetNextFixture({ team: 'América', adapter: adapter('mex.1', [clasico()]), now: NOW, flavor: 'full' });
    expect(n.text).toContain('— ¡Goya!');
    expect(n.text).not.toContain('¡Ódiame más!');
  });

  it("get_live: a clásico in play, served by the live read, prints Pumas' cry", async () => {
    const live = fixture('800002701', { home: america, away: pumas, status: 'LIVE', minute: 30, score: { home: 0, away: 0 } });
    const r = await toolGetLive({ adapter: adapter('mex.1', [live]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('América 0–0 Pumas UNAM');
    expect(r.text).toContain('— ¡Goya!');
    expect(r.text).not.toContain('¡Ódiame más!');
  });

  it("CLAUDINHO_TEAM is a team-taking tool's query, not the cry's tiebreak: the pin still decides", async () => {
    process.env.CLAUDINHO_TEAM = 'AME';
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('mex.1', [clasico()]), now: NOW, flavor: 'full' });
    expect(r.text).toContain('— ¡Goya!');
  });
});

describe('a sober line carries no cry', () => {
  it('get_today: a cancelled Arsenal match prints no cry', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const r = await toolGetToday({
      date: '2026-10-10',
      adapter: adapter('eng.1', [fixture('800002500', { home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' }, status: 'CANCELLED' })]),
      now: NOW,
      flavor: 'full',
    });
    expect(r.text).toContain('Arsenal');
    expect(r.text).not.toContain('COYG!');
  });
});
